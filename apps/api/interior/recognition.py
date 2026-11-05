"""户型识别后端。

支持三种后端：
- dashscope：百炼视觉模型（云端，默认）
- yolov8：本地 YOLOv8 GPU 推理，检测框映射为毫米坐标
- controlnet：约束生成（见 controlnet.py）

所有后端统一返回 RecognitionResult（毫米坐标）。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

WALL_CLASSES = {"wall", "walls", "wall_line", "墙体", "墙"}
DOOR_CLASSES = {"door", "doors", "门"}
WINDOW_CLASSES = {"window", "windows", "窗"}
ROOM_CLASSES = {"room", "rooms", "space", "房间"}


@dataclass
class RecognitionResult:
    """统一的户型识别输出。"""

    success: bool
    walls: list[dict] = field(default_factory=list)
    openings: list[dict] = field(default_factory=list)
    rooms: list[dict] = field(default_factory=list)
    confidence: float = 0
    notes: str = ""


class RecognitionBackend(ABC):
    """识别后端抽象基类。"""

    name: str = "base"

    @abstractmethod
    def recognize(
        self, image_bytes: bytes, total_width_mm: int, floor_height_mm: int
    ) -> RecognitionResult:
        ...


class DashScopeBackend(RecognitionBackend):
    """百炼视觉模型识别（云端）。"""

    name = "dashscope"

    def recognize(
        self, image_bytes: bytes, total_width_mm: int, floor_height_mm: int
    ) -> RecognitionResult:
        from .plan_recognition import recognize_plan

        try:
            raw, meta = recognize_plan(
                image_bytes, total_width_mm=total_width_mm, floor_height_mm=floor_height_mm
            )
        except Exception as exc:
            return RecognitionResult(success=False, notes=f"云端识别失败：{exc}")
        return RecognitionResult(
            success=True,
            walls=raw.get("walls", []),
            openings=raw.get("openings", []),
            rooms=raw.get("rooms", []),
            confidence=float(meta.get("confidence") or 0),
            notes="云端视觉模型识别完成。",
        )


def _class_name(model_names, index) -> str:
    if isinstance(model_names, dict):
        return str(model_names.get(int(index), "")).lower()
    if isinstance(model_names, (list, tuple)) and 0 <= int(index) < len(model_names):
        return str(model_names[int(index)]).lower()
    return ""


def _nearest_wall(walls: list[dict], x_mm: int, y_mm: int) -> tuple[int, int]:
    """返回 (墙索引, 在墙上的偏移 mm)。"""
    best = (0, 0)
    best_dist = float("inf")
    for index, wall in enumerate(walls):
        start = wall["startMm"]
        end = wall["endMm"]
        horizontal = abs(end[1] - start[1]) <= abs(end[0] - start[0])
        if horizontal:
            lo, hi = sorted((start[0], end[0]))
            if lo - 200 <= x_mm <= hi + 200:
                dist = abs(y_mm - start[1])
                offset = min(max(x_mm - min(start[0], end[0]), 0), abs(end[0] - start[0]))
            else:
                continue
        else:
            lo, hi = sorted((start[1], end[1]))
            if lo - 200 <= y_mm <= hi + 200:
                dist = abs(x_mm - start[0])
                offset = min(max(y_mm - min(start[1], end[1]), 0), abs(end[1] - start[1]))
            else:
                continue
        if dist < best_dist:
            best_dist = dist
            best = (index, int(offset))
    return best


class YOLOv8Backend(RecognitionBackend):
    """本地 YOLOv8 推理，把检测框映射为项目的毫米坐标系。"""

    name = "yolov8"

    def __init__(self, weights: str | None = None, device: str | None = None):
        from .config import settings

        self.weights = weights or settings.yolov8_weights
        self.device = device or settings.local_inference_device
        self._model = None
        self._load_error = ""

    def _load(self):
        if self._model is not None:
            return self._model
        try:
            from ultralytics import YOLO
        except ImportError:
            self._load_error = (
                "未安装 ultralytics。安装命令：pip install ultralytics "
                "（需配套 CUDA 版 PyTorch）。"
            )
            return None
        try:
            self._model = YOLO(self.weights)
        except Exception as exc:
            self._load_error = f"权重加载失败（{self.weights}）：{exc}"
            return None
        return self._model

    def recognize(
        self, image_bytes: bytes, total_width_mm: int, floor_height_mm: int
    ) -> RecognitionResult:
        model = self._load()
        if model is None:
            return RecognitionResult(
                success=False,
                notes=self._load_error
                or "YOLOv8 不可用，请设置 LOCAL_RECOGNITION_BACKEND=dashscope。",
            )

        try:
            from PIL import Image
            import io as _io

            image = Image.open(_io.BytesIO(image_bytes)).convert("RGB")
            width_px, height_px = image.size
            results = model.predict(
                image, device=self.device, verbose=False, conf=0.25
            )
        except Exception as exc:
            return RecognitionResult(success=False, notes=f"YOLOv8 推理异常：{exc}")

        if not results:
            return RecognitionResult(success=False, notes="模型未返回结果。")

        boxes = getattr(results[0], "boxes", None)
        if boxes is None or len(boxes) == 0:
            return RecognitionResult(
                success=False, notes="未检测到墙/门/窗，请确认模型为户型专用权重。"
            )

        names = getattr(results[0], "names", getattr(model, "names", {}))
        scale = total_width_mm / float(width_px)

        walls: list[dict] = []
        openings: list[dict] = []
        rooms: list[dict] = []
        confidences: list[float] = []

        for box in boxes:
            coords = box.xyxy[0].tolist()
            x1, y1, x2, y2 = (float(v) for v in coords)
            score = float(box.conf[0]) if box.conf is not None else 0.0
            label = _class_name(names, box.cls[0]) if box.cls is not None else ""
            confidences.append(score)

            left = int(x1 * scale)
            right = int(x2 * scale)
            top = int(y1 * scale)
            bottom = int(y2 * scale)
            box_width = right - left
            box_height = bottom - top

            if label in WALL_CLASSES:
                if box_width >= box_height:
                    center_y = (top + bottom) // 2
                    walls.append(
                        {
                            "startMm": [left, center_y],
                            "endMm": [right, center_y],
                            "thicknessMm": max(60, box_height),
                            "confidence": round(score, 3),
                        }
                    )
                else:
                    center_x = (left + right) // 2
                    walls.append(
                        {
                            "startMm": [center_x, top],
                            "endMm": [center_x, bottom],
                            "thicknessMm": max(60, box_width),
                            "confidence": round(score, 3),
                        }
                    )
            elif label in ROOM_CLASSES:
                rooms.append(
                    {
                        "name": f"房间 {len(rooms) + 1}",
                        "type": "room",
                        "boundaryMm": [
                            [left, top],
                            [right, top],
                            [right, bottom],
                            [left, bottom],
                        ],
                        "confidence": round(score, 3),
                    }
                )

        # 洞口需要依附到已有墙体，必须在墙识别之后处理
        for box in boxes:
            coords = box.xyxy[0].tolist()
            x1, y1, x2, y2 = (float(v) for v in coords)
            score = float(box.conf[0]) if box.conf is not None else 0.0
            label = _class_name(names, box.cls[0]) if box.cls is not None else ""
            if label not in DOOR_CLASSES and label not in WINDOW_CLASSES:
                continue
            left = int(x1 * scale)
            right = int(x2 * scale)
            top = int(y1 * scale)
            bottom = int(y2 * scale)
            center_x = (left + right) // 2
            center_y = (top + bottom) // 2
            wall_index, offset = _nearest_wall(walls, center_x, center_y)
            opening_width = right - left if (right - left) >= (bottom - top) else bottom - top
            openings.append(
                {
                    "wallRef": f"wall-{wall_index}",
                    "offsetMm": offset,
                    "widthMm": max(300, opening_width),
                    "heightMm": 2100 if label in DOOR_CLASSES else 1500,
                    "type": "door" if label in DOOR_CLASSES else "window",
                    "confidence": round(score, 3),
                }
            )

        if not walls:
            return RecognitionResult(
                success=False,
                rooms=rooms,
                notes="检测到房间但没有墙体类别，请检查权重文件的类别名称。",
            )

        confidence = sum(confidences) / len(confidences) if confidences else 0
        for index, wall in enumerate(walls):
            wall["id"] = f"wall-{index}"
        return RecognitionResult(
            success=True,
            walls=walls,
            openings=openings,
            rooms=rooms,
            confidence=confidence,
            notes=(
                f"YOLOv8 识别完成：墙 {len(walls)} 段、洞口 {len(openings)} 个、"
                f"房间 {len(rooms)} 个，比例 {scale:.3f} mm/px。"
            ),
        )


def create_backend(backend_name: str = "dashscope") -> RecognitionBackend:
    """根据配置创建识别后端实例。"""
    if backend_name == "yolov8":
        return YOLOv8Backend()
    return DashScopeBackend()
