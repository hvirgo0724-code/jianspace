"""Explicit opt-in provider. Generated images never become measured geometry."""

import base64, ipaddress, socket, time
from urllib.parse import urlparse
import httpx
from .config import settings
from .security import DomainError
from .storage import read, normalize_image


def provider_base():
    base = settings.dashscope_api_base.rstrip("/")
    try:
        parsed = urlparse(base)
        valid = (
            parsed.scheme == "https"
            and (parsed.hostname or "").endswith(".aliyuncs.com")
            and not any(
                (
                    parsed.username,
                    parsed.password,
                    parsed.query,
                    parsed.fragment,
                    parsed.path,
                )
            )
            and parsed.port in (None, 443)
        )
    except ValueError:
        valid = False
    if not valid:
        raise DomainError(
            "PROVIDER_CONFIG_INVALID",
            "DASHSCOPE_API_BASE 须填写百炼 HTTPS API Host，不含接口路径或查询参数。",
            503,
        )
    return base


def error_body(response):
    try:
        body = response.json()
        return body if isinstance(body, dict) else {}
    except ValueError:
        return {}


def validate_provider_configuration():
    """Safe preflight for capabilities and task admission; never exposes keys."""
    try:
        models = settings.image_model_chain
        provider_base()
        if (
            settings.ai_structure_review_enabled
            and not settings.dashscope_vision_model.strip()
        ):
            raise ValueError("启用结构辅助审核时须填写 DASHSCOPE_VISION_MODEL。")
        if settings.ai_structure_review_enabled:
            from .structure_review import validate_structure_review_model

            if not validate_structure_review_model(settings.dashscope_vision_model):
                raise ValueError(
                    "结构审核模型须使用支持 JSON 输出的千问视觉模型，例如 qwen3-vl-plus。"
                )
        return {"models": models, "configurationError": None}
    except (ValueError, DomainError) as exc:
        return {
            "models": [],
            "configurationError": exc.message
            if isinstance(exc, DomainError)
            else str(exc),
        }


def validate_generation_request(scene, assets, request):
    if request.get("parameters", {}).get("geometryGuide"):
        from .ai_context import measured_context, constrained_instruction
        from .catalog import STYLES

        context = measured_context(scene, request["roomIds"][0])
        _apply_scene_reference(context, assets)
        style = next(
            (s["name"] for s in STYLES if s["id"] in request.get("styleIds", [])),
            "现代自然",
        )
        constrained_instruction(context, style, request.get("instruction", ""))


def _apply_scene_reference(context, assets):
    for a in assets:
        snapshot = getattr(a, "metadata_json", {}).get("sceneReference")
        if snapshot:
            if (
                snapshot.get("structureHash") != context["structureHash"]
                or snapshot.get("layoutHash") != context["layoutHash"]
            ):
                raise DomainError(
                    "STALE_SCENE_REFERENCE",
                    "3D参考创建后场景已变化，请重新取景，避免使用旧布局。",
                )
    # The last image alone defines the output camera. Other photos are context.
    if assets:
        snapshot = getattr(assets[-1], "metadata_json", {}).get("sceneReference")
        if snapshot:
            context["camera"] = snapshot.get("camera")
            context["sameViewReference"] = True


def rejected_model(response, body):
    # Only explicit rejections can advance to another model. Never retry an
    # accepted/ambiguous request (timeouts, 5xx, malformed output or download failure).
    code = body.get("code") if isinstance(body.get("code"), str) else ""
    return (response.status_code == 403 and code == "AllocationQuota.FreeTierOnly") or (
        response.status_code == 429
        and code in {"Throttling.RateQuota", "Throttling.AllocationQuota"}
    )


def provider_error(response, body, attempts):
    code = body.get("code") if isinstance(body.get("code"), str) else ""
    details = {"modelAttempts": attempts}
    if response.status_code == 403 and code == "AllocationQuota.FreeTierOnly":
        return DomainError(
            "PROVIDER_QUOTA_EXHAUSTED",
            "候选图像模型额度不可用，请检查百炼免费额度与用完即停设置。",
            503,
            details,
        )
    if response.status_code == 429:
        return DomainError(
            "PROVIDER_RATE_LIMITED",
            "候选图像模型暂时受限，请稍后再试或检查模型限流配置。",
            503,
            details,
        )
    if code in {"Arrearage", "AccessDenied.Unpurchased"}:
        return DomainError(
            "PROVIDER_ACCOUNT_UNAVAILABLE",
            "百炼账户欠费或服务未开通，已停止切换，请检查账户状态。",
            503,
            details,
        )
    if response.status_code == 401:
        return DomainError(
            "PROVIDER_AUTH_ERROR",
            "百炼鉴权失败，请检查密钥与 API Host 是否属于同一地域。",
            503,
            details,
        )
    return DomainError(
        "PROVIDER_ERROR",
        f"生图服务返回 HTTP {response.status_code}，已停止切换，请检查百炼调用记录与模型配置。",
        502,
        details,
    )


def request_image(client, content):
    try:
        models = settings.image_model_chain
    except ValueError as exc:
        raise DomainError("PROVIDER_CONFIG_INVALID", str(exc), 503) from None
    base = provider_base()
    attempts = []
    # Leave time inside the 300-second worker lease for image download and saving.
    deadline = time.monotonic() + 230
    for index, model in enumerate(models):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DomainError(
                "PROVIDER_TIME_BUDGET", "模型尝试已达到时限，已停止调用。", 503
            )
        try:
            response = client.post(
                base + "/api/v1/services/aigc/multimodal-generation/generation",
                headers={"Authorization": f"Bearer {settings.dashscope_api_key}"},
                json={
                    "model": model,
                    "input": {"messages": [{"role": "user", "content": content}]},
                    "parameters": {
                        "n": 1,
                        "watermark": True,
                        "prompt_extend": False,
                        "negative_prompt": "新增门洞，新开窗户，移动门窗，改变墙体轮廓，扩大房间，改变拍摄视角，平面图，界面按钮，尺寸文字",
                    },
                },
                timeout=min(180, remaining),
            )
        except httpx.TransportError:
            raise DomainError(
                "PROVIDER_REQUEST_UNCERTAIN",
                "请求结果未确认，未自动切换模型；请先核对百炼调用记录，避免重复生成和计费。",
                502,
            ) from None
        body = error_body(response)
        request_id = body.get("request_id")
        attempt = {"model": model, "httpStatus": response.status_code}
        if isinstance(request_id, str):
            attempt["requestId"] = request_id[:200]
        if response.status_code >= 400:
            # Store only known error codes, never provider messages or secrets.
            known_codes = {
                "AllocationQuota.FreeTierOnly",
                "Throttling.RateQuota",
                "Throttling.AllocationQuota",
            }
            code = body.get("code") if isinstance(body.get("code"), str) else ""
            attempt.update(
                status="rejected", code=code if code in known_codes else "other"
            )
            attempts.append(attempt)
            if rejected_model(response, body) and index + 1 < len(models):
                continue
            raise provider_error(response, body, attempts)
        attempt["status"] = "succeeded"
        attempts.append(attempt)
        return body, model, attempts, deadline


def _result_image(client, body, deadline):
    try:
        items = body["output"]["choices"][0]["message"]["content"]
        url = next(
            (
                i["image"]
                for i in items
                if isinstance(i, dict) and isinstance(i.get("image"), str)
            ),
            None,
        )
    except (KeyError, IndexError, TypeError):
        url = None
    if not url:
        raise DomainError("PROVIDER_INVALID_RESPONSE", "服务未返回可用图片。", 502)
    if url.startswith("data:image/"):
        return base64.b64decode(url.split(",", 1)[1], validate=True)
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if parsed.scheme != "https" or not (
        host.endswith(".aliyuncs.com") or host.endswith(".aliyun.com")
    ):
        raise DomainError(
            "PROVIDER_URL_REJECTED", "服务返回的图片地址不在允许域名内。", 502
        )
    for info in socket.getaddrinfo(host, 443):
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise DomainError(
                "PROVIDER_URL_REJECTED", "服务返回的地址无法安全访问。", 502
            )
    raw = b""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise DomainError(
            "PROVIDER_DOWNLOAD_FAILED",
            "模型已返回结果，但下载时限已到；未重新生图，请核对百炼调用记录。",
            502,
        )
    try:
        with client.stream(
            "GET", url, follow_redirects=False, timeout=min(60, remaining)
        ) as img:
            img.raise_for_status()
            for chunk in img.iter_bytes():
                raw += chunk
                if time.monotonic() > deadline:
                    raise DomainError(
                        "PROVIDER_DOWNLOAD_FAILED",
                        "图片下载超时，未重新生图；请核对百炼调用记录。",
                        502,
                    )
                if len(raw) > 15 * 1024 * 1024:
                    raise DomainError(
                        "PROVIDER_IMAGE_TOO_LARGE",
                        "生成图片超出文件大小限制。",
                        502,
                    )
    except httpx.HTTPError:
        raise DomainError(
            "PROVIDER_DOWNLOAD_FAILED",
            "模型已返回结果，但图片下载失败；未重新生图，请核对百炼调用记录。",
            502,
        ) from None
    return raw


def generate_image(assets, style, instruction, geometry=None):
    if not settings.ai_ready:
        raise DomainError(
            "PROVIDER_NOT_CONFIGURED",
            "AI 服务未启用，请在服务端配置密钥并允许付费调用。",
            503,
        )
    source_images = [read(a.object_key) for a in assets]
    content = [
        {"image": "data:image/jpeg;base64," + base64.b64encode(raw).decode()}
        for raw in source_images
    ]
    prompt = f"将提供的住宅室内照片设计为{style}装修风格。保留原照片的墙、门窗位置和透视。只生成概念效果，不添加尺寸文字。用户要求：{instruction}。"
    if geometry:
        from .ai_context import reference_image
        from .ai_context import constrained_instruction

        if len(assets) > 2:
            raise DomainError("TOO_MANY_REFERENCE_IMAGES", "实测引导最多使用两张照片。")
        _apply_scene_reference(geometry, assets)
        # The first image is a plan; the last photo preserves the requested output aspect ratio.
        content.insert(
            0,
            {
                "image": "data:image/png;base64,"
                + base64.b64encode(reference_image(geometry)).decode()
            },
        )
        prompt = constrained_instruction(geometry, style, instruction)
    content.append({"text": prompt})
    with httpx.Client(timeout=180) as client:
        body, model, attempts, deadline = request_image(client, content)
        raw = _result_image(client, body, deadline)
        data, meta = normalize_image(raw)
        metadata = {
            **meta,
            "provider": "dashscope",
            "model": model,
            "requestedModel": settings.image_model_chain[0],
            "fallbackUsed": len(attempts) > 1,
            "modelAttempts": attempts,
            "requestId": body.get("request_id"),
            "conceptOnly": True,
            "usage": body.get("usage", {}),
            "constraintPolicyVersion": "2.0",
            "promptBytes": len(prompt.encode("utf-8")),
            "sameViewReference": bool(geometry and geometry.get("sameViewReference")),
        }
        if geometry:
            from .structure_review import review_structure

            metadata["structuralAudit"] = review_structure(
                geometry,
                source_images,
                data,
                enabled=settings.ai_structure_review_enabled,
            )
        return data, metadata


def chat_text(messages):
    """Narrate an assistant answer; the caller falls back to rules on any failure."""
    model = settings.dashscope_text_model.strip()
    if not model:
        raise DomainError(
            "ASSISTANT_NOT_CONFIGURED",
            "未配置文本模型，小筑当前使用规则知识库回答。",
            503,
        )
    base = provider_base()
    response = httpx.post(
        base + "/compatible-mode/v1/chat/completions",
        headers={"Authorization": f"Bearer {settings.dashscope_api_key}"},
        json={
            "model": model,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 900,
        },
        timeout=60,
    )
    if response.status_code >= 400:
        raise DomainError(
            "ASSISTANT_PROVIDER_ERROR",
            f"助手文本模型返回 HTTP {response.status_code}，已退回规则回答。",
            502,
        )
    body = error_body(response)
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        content = None
    if not isinstance(content, str) or not content.strip():
        raise DomainError(
            "ASSISTANT_INVALID_RESPONSE", "助手文本模型未返回内容。", 502
        )
    return content


def edit_image_masked(source_bytes, mask_bytes, instruction):
    """Send the source and a white-on-black mask; the caller composites the result."""
    if not settings.ai_ready:
        raise DomainError(
            "PROVIDER_NOT_CONFIGURED",
            "AI 服务未启用，请在服务端配置密钥并允许付费调用。",
            503,
        )
    instruction = instruction.strip()
    if not instruction:
        raise DomainError("INPAINT_INSTRUCTION_REQUIRED", "请写明只修改什么内容。")
    prompt = (
        "这是一次局部改图。第一张是原房间图，第二张是蒙版：白色区域允许重绘，"
        "黑色区域必须保持原样。只修改白色区域内的内容，保持墙体、门窗、家具位置"
        "和拍摄视角不变，不要添加尺寸文字或界面元素，输出完整画面。"
        f"用户要求：{instruction}。"
    )
    content = [
        {
            "image": "data:image/jpeg;base64,"
            + base64.b64encode(source_bytes).decode()
        },
        {"image": "data:image/png;base64," + base64.b64encode(mask_bytes).decode()},
        {"text": prompt},
    ]
    with httpx.Client(timeout=180) as client:
        body, model, attempts, deadline = request_image(client, content)
        raw = _result_image(client, body, deadline)
    return raw, {
        "provider": "dashscope",
        "model": model,
        "requestedModel": settings.image_model_chain[0],
        "fallbackUsed": len(attempts) > 1,
        "modelAttempts": attempts,
        "requestId": body.get("request_id"),
        "usage": body.get("usage", {}),
        "maskProvided": True,
        "constraintPolicyVersion": "inpaint-1.0",
        "promptBytes": len(prompt.encode("utf-8")),
    }
