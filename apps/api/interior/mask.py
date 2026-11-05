"""Mask decoding, coverage checks and deterministic local compositing.

The provider may repaint far outside the mask; the stored result always keeps
the original pixels outside the white mask area, so the promise is enforced by
this module instead of being trusted to the model.
"""

import base64
import binascii
import io

from PIL import Image, ImageChops, ImageOps

from .security import DomainError

MIN_COVERAGE = 0.002
MAX_COVERAGE = 0.85
PREFIX = "data:image/png;base64,"
MAX_MASK_BYTES = 6 * 1024 * 1024


def _open(raw, error_code, message):
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
        return im
    except Exception as exc:
        raise DomainError(error_code, message) from exc


def decode_mask(data_url, source_bytes):
    """Return a normalised black/white PNG mask plus size and coverage stats."""
    if not isinstance(data_url, str) or not data_url.startswith(PREFIX):
        raise DomainError(
            "MASK_REQUIRED", "请用画笔涂抹需要修改的区域后再提交。"
        )
    try:
        raw = base64.b64decode(data_url[len(PREFIX) :], validate=True)
    except (ValueError, binascii.Error):
        raise DomainError("MASK_INVALID", "蒙版图片编码无效，请重新涂抹。") from None
    if not raw or len(raw) > MAX_MASK_BYTES:
        raise DomainError("MASK_INVALID", "蒙版图片过大，请缩小涂抹范围后重试。")
    mask = _open(raw, "MASK_INVALID", "蒙版图片无法读取，请重新涂抹。")
    if mask.format != "PNG":
        raise DomainError("MASK_INVALID", "蒙版必须是 PNG 图片。")
    source = _open(source_bytes, "SOURCE_INVALID", "底图无法读取，请重新选择。")
    if mask.size != source.size:
        raise DomainError(
            "MASK_DIMENSIONS",
            "蒙版尺寸必须与底图一致，请重新载入图片后涂抹。",
        )
    mask = mask.convert("L").point(lambda value: 255 if value >= 128 else 0, "L")
    white = mask.histogram()[255]
    total = mask.width * mask.height
    coverage = round(white / total, 6) if total else 0.0
    if coverage < MIN_COVERAGE:
        raise DomainError(
            "MASK_TOO_SMALL",
            "涂抹区域太小，请至少覆盖底图的 0.2%，便于模型识别修改范围。",
        )
    if coverage > MAX_COVERAGE:
        raise DomainError(
            "MASK_TOO_LARGE",
            "涂抹区域超过 85%，已接近整图重绘；请缩小局部范围或改用效果图生成。",
        )
    out = io.BytesIO()
    mask.save(out, "PNG")
    return out.getvalue(), {
        "width": mask.width,
        "height": mask.height,
        "maskCoverage": coverage,
        "exifRemoved": True,
    }


def composite_masked(source_bytes, generated_bytes, mask_bytes):
    """Keep source pixels outside the mask and provider pixels inside it."""
    source = _open(source_bytes, "SOURCE_INVALID", "底图无法读取。").convert("RGB")
    generated = _open(
        generated_bytes, "PROVIDER_INVALID_RESPONSE", "生成结果无法读取。"
    ).convert("RGB")
    mask = _open(mask_bytes, "MASK_INVALID", "蒙版无法读取。").convert("L")
    if mask.size != source.size:
        raise DomainError("MASK_DIMENSIONS", "蒙版尺寸与底图不一致。")
    mask = mask.point(lambda value: 255 if value >= 128 else 0, "L")
    resized = generated.size != source.size
    if resized:
        generated = generated.resize(source.size, Image.Resampling.LANCZOS)
    result = Image.composite(generated, source, mask)
    diff = ImageChops.difference(result, source).convert("L")
    outside = ImageChops.multiply(diff, ImageOps.invert(mask))
    outside_changed = outside.point(lambda value: 255 if value else 0).histogram()[255]
    inside_changed = ImageChops.multiply(diff, mask).point(
        lambda value: 255 if value else 0
    ).histogram()[255]
    if outside_changed:
        # Deterministic compositing must make this impossible; fail loudly if not.
        raise DomainError("MASK_COMPOSITE_FAILED", "局部结果校验失败，请重试。", 500)
    out = io.BytesIO()
    result.save(out, "PNG")
    return out.getvalue(), {
        "width": source.width,
        "height": source.height,
        "maskCoverage": round(mask.histogram()[255] / (mask.width * mask.height), 6),
        "outsideChangedPixels": 0,
        "insideChangedPixels": inside_changed,
        "compositePolicy": "mask-outside-source-pixels",
        "generatedResized": resized,
        "maskFeatherPx": 0,
    }
