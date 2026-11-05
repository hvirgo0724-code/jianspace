"""户型识别后端抽象层。

支持多种识别后端：
- dashscope（默认，百炼视觉 API，云端推理）
- yolov8（可选，本地 YOLOv8 + CUDA GPU 推理，无需外部 API）
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class RecognitionResult:
    """统一的户型识别输出。"""

    success: bool
    walls: list[dict]        # [{"startMm": [...], "endMm": [...], "thicknessMm": int}]
    openings: list[dict]    # [{"wallRef": str, "offsetMm": int, "widthMm": int, "heightMm": int, "type": str}]
    rooms: list[dict]        # [{"name": str, "type": str, "boundaryMm": [[x,y],...]}]
    confidence: float
    notes: str = ""


class RecognitionBackend(ABC):
    """识别后端抽象基类。"""

    name: str = "base"

    @abstractmethod
    def recognize(self, image_bytes: bytes, total_width_mm: int, floor_height_mm: int) -> RecognitionResult:
        """从户型图识别墙、门、窗、房间。"""
        ...


class DashScopeBackend(RecognitionBackend):
    """百炼视觉 API 识别（现有方案）。"""

    name = "dashscope"

    def recognize(self, image_bytes: bytes, total_width_mm: int, floor_height_mm: int) -> RecognitionResult:
        from .plan_recognition import recognize_floorplan  # 延迟导入避免循环依赖
        return recognize_floorplan(image_bytes, total_width_mm, floor_height_mm)


class YOLOv8Backend(RecognitionBackend):
    """本地 YOLOv8 + SD XL 识别（可选，有 CUDA GPU 时启用）。"""

    name = "yolov8"

    def __init__(self):
        self._model = None
        self._ready = False

    def _ensure_loaded(self) -> bool:
        if self._ready:
            return True
        try:
            from ultralytics import YOLO  # type: ignore
            self._model = YOLO("yolov8n-floorplan.pt")  # 需用户自行提供权重
            self._ready = True
            return True
        except ImportError:
            return False
        except Exception:
            return False

    def recognize(self, image_bytes: bytes, total_width_mm: int, floor_height_mm: int) -> RecognitionResult:
        if not self._ensure_loaded():
            return RecognitionResult(
                success=False,
                walls=[], openings=[], rooms=[],
                confidence=0,
                notes="YOLOv8 未就绪：安装 ultralytics + PyTorch CUDA，并提供 yolov8n-floorplan.pt 权重。",
            )
        try:
            import io, numpy as np
            from PIL import Image  # type: ignore
            img = Image.open(io.BytesIO(image_bytes))
            arr = np.array(img.convert("RGB"))
            results = self._model(arr)
            # TODO: 将 YOLOv8 检测框映射到项目的 mm 坐标
            # 这里是骨架实现，实际映射需要根据训练的 model 调整
            return RecognitionResult(
                success=True,
                walls=[], openings=[], rooms=[],
                confidence=float(getattr(results[0], "boxes", None).conf[0]) if results else 0,
                notes="YOLOv8 骨架实现——检测结果到 mm 坐标的映射待完善。",
            )
        except Exception as exc:
            return RecognitionResult(
                success=False,
                walls=[], openings=[], rooms=[],
                confidence=0,
                notes=f"YOLOv8 推理异常：{exc}",
            )


def create_backend(backend_name: str = "dashscope") -> RecognitionBackend:
    """根据配置创建识别后端实例。"""
    if backend_name == "yolov8":
        return YOLOv8Backend()
    return DashScopeBackend()
