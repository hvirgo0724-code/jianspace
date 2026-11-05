"""ControlNet 约束生成适配器。

保持原图轮廓 / 深度结构不变，只按提示词改变材质与风格。
依赖可选：未安装时抛出可读的安装指引，不影响其余功能。
"""
from __future__ import annotations

import io
from threading import Lock

_pipeline = None
_pipeline_key = ""
_lock = Lock()


def _missing_dependencies() -> list[str]:
    import importlib.util as util

    required = {
        "torch": "torch",
        "diffusers": "diffusers",
        "transformers": "transformers",
        "accelerate": "accelerate",
    }
    return [pkg for module, pkg in required.items() if util.find_spec(module) is None]


def _load_pipeline(controlnet_kind: str, device: str):
    """按需加载并缓存 SDXL + ControlNet 管线。"""
    global _pipeline, _pipeline_key

    from .config import settings

    key = f"{settings.controlnet_model}|{controlnet_kind}|{device}"
    with _lock:
        if _pipeline is not None and _pipeline_key == key:
            return _pipeline

        import torch
        from diffusers import (
            ControlNetModel,
            StableDiffusionXLControlNetImg2ImgPipeline,
        )

        dtype = torch.float16 if device.startswith("cuda") else torch.float32
        controlnet = ControlNetModel.from_pretrained(
            settings.controlnet_model,
            torch_dtype=dtype,
        )
        pipeline = StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained(
            settings.controlnet_base_model,
            controlnet=controlnet,
            torch_dtype=dtype,
        )
        pipeline.to(device)
        if device.startswith("cuda"):
            pipeline.enable_model_cpu_offload()
        _pipeline = pipeline
        _pipeline_key = key
        return pipeline


def _condition_image(image, kind: str):
    """生成 ControlNet 条件图（canny 边缘 / 深度）。"""
    if kind == "depth":
        try:
            from transformers import pipeline as hf_pipeline

            depth = hf_pipeline(
                "depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf"
            )
            return depth(image)["depth"].convert("RGB")
        except Exception:
            pass

    import numpy as np
    from PIL import Image, ImageFilter

    gray = image.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    array = np.array(edges)
    array = (array > 40).astype(np.uint8) * 255
    return Image.fromarray(array).convert("RGB")


def generate_with_controlnet(
    image_bytes: bytes,
    prompt: str,
    *,
    kind: str = "canny",
    steps: int | None = None,
    strength: float = 0.65,
) -> tuple[bytes, str]:
    """运行约束生成，返回 (PNG 字节, 说明)。"""
    from .config import settings
    from .security import DomainError

    missing = _missing_dependencies()
    if missing:
        raise DomainError(
            "CONTROLNET_UNAVAILABLE",
            "ControlNet 依赖未安装："
            + "、".join(missing)
            + "。安装命令：pip install torch diffusers transformers accelerate "
            "（GPU 环境使用 CUDA 版 torch）。",
            503,
        )

    from PIL import Image

    device = settings.local_inference_device
    kind = kind if kind in ("canny", "depth") else "canny"
    try:
        pipeline = _load_pipeline(kind, device)
    except Exception as exc:
        raise DomainError(
            "CONTROLNET_LOAD_FAILED", f"ControlNet 管线加载失败：{exc}", 502
        ) from exc

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    condition = _condition_image(image, kind)
    run_steps = steps or settings.controlnet_steps
    generator = None
    try:
        import torch

        if device.startswith("cuda"):
            generator = torch.Generator(device=device).manual_seed(settings.controlnet_seed)
    except Exception:
        generator = None

    try:
        result = pipeline(
            prompt=prompt,
            image=image,
            control_image=condition,
            controlnet_conditioning_scale=0.85,
            strength=strength,
            num_inference_steps=run_steps,
            guidance_scale=6.0,
            generator=generator,
        ).images[0]
    except Exception as exc:
        raise DomainError(
            "CONTROLNET_GENERATE_FAILED", f"ControlNet 生成失败：{exc}", 502
        ) from exc

    buffer = io.BytesIO()
    result.save(buffer, format="PNG")
    note = (
        f"ControlNet({kind}) 约束生成完成：{run_steps} 步，"
        f"强度 {strength}，设备 {device}。"
    )
    return buffer.getvalue(), note
