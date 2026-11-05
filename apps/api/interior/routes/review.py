"""装修避坑审查、材料清单与户型识别路由。"""
from __future__ import annotations

import base64

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..config import settings
from ..recognition import create_backend
from ..review import (
    BUDGET_TIERS,
    Finding,
    ReviewReport,
    analyze_documents,
    estimate_materials,
    link_budget_findings,
    materials_from_image,
    parse_document,
    review_report_pdf,
    report_to_dict,
)
from ..security import CurrentUser, DomainError, rate_limit

router = APIRouter()

MAX_BYTES = 12 * 1024 * 1024
TEXT_FIELDS = ("contract", "quote", "drawing")


class ReviewJsonIn(BaseModel):
    contract: str = ""
    quote: str = ""
    drawing: str = ""
    styleHint: str = ""
    useLlm: bool = True
    budgetLines: list[dict] = Field(default_factory=list)


class EstimateIn(BaseModel):
    scene: dict = Field(default_factory=dict)
    styleId: str | None = None


async def _read(upload: UploadFile | None, label: str) -> tuple[str, str]:
    if upload is None:
        return "", ""
    if upload.size and upload.size > MAX_BYTES:
        raise DomainError("FILE_TOO_LARGE", f"{label} 超过 12MB 上限。", 413)
    raw = await upload.read()
    if not raw:
        return "", ""
    text, note = parse_document(raw, upload.filename or "")
    return text, (f"{label}: {note}" if note else "")


@router.post("/review/analyze")
async def review_analyze(
    request: Request,
    user: CurrentUser,
    contract: UploadFile | None = File(default=None),
    quote: UploadFile | None = File(default=None),
    drawing: UploadFile | None = File(default=None),
    contractText: str = Form(default=""),
    quoteText: str = Form(default=""),
    drawingText: str = Form(default=""),
    styleHint: str = Form(default=""),
    useLlm: bool = Form(default=True),
):
    """上传合同 / 报价单 / 设计说明，输出批判性审查报告。"""
    rate_limit("review:" + request.client.host, 10, 300)
    documents: dict[str, str] = {}
    notes: list[str] = []
    for key, upload, inline in (
        ("contract", contract, contractText),
        ("quote", quote, quoteText),
        ("drawing", drawing, drawingText),
    ):
        text, note = await _read(upload, key)
        if note:
            notes.append(note)
        if not text and inline.strip():
            text = inline.strip()
        if text:
            documents[key] = text

    if not documents:
        raise DomainError(
            "REVIEW_NO_DOCUMENT",
            "请至少上传一份合同、报价单或设计说明（PDF/TXT/MD/CSV），或粘贴文本。",
            400,
        )

    report = analyze_documents(documents, use_llm=useLlm, style_hint=styleHint.strip())
    payload = report_to_dict(report)
    payload["notes"] = notes
    payload["author"] = user.display_name or user.email
    return payload


@router.post("/review/analyze-text")
def review_analyze_text(body: ReviewJsonIn, user: CurrentUser):
    """纯文本审查（与上传接口等价，供脚本或前端粘贴调用）。"""
    documents = {
        key: getattr(body, key).strip()
        for key in TEXT_FIELDS
        if getattr(body, key).strip()
    }
    if not documents:
        raise DomainError("REVIEW_NO_DOCUMENT", "请至少填写一份文档内容。", 400)
    report = analyze_documents(documents, use_llm=body.useLlm, style_hint=body.styleHint.strip())
    if body.budgetLines:
        findings = link_budget_findings(list(report.findings), body.budgetLines)
        for original, updated in zip(report.findings, findings):
            original.budget_item_ids = updated.budget_item_ids
    return report_to_dict(report)


@router.get("/review/budget-tiers")
def review_budget_tiers():
    """三档装修材料预算单价表。"""
    return {"tiers": BUDGET_TIERS}


class ReportPdfIn(BaseModel):
    report: dict


@router.post("/review/report-pdf")
def review_report(report: ReportPdfIn, user: CurrentUser):
    """把已生成的审查结果渲染成 PDF（不重复调用模型）。"""
    raw = report.report or {}
    if not raw.get("findings") and not raw.get("summary"):
        raise DomainError("REVIEW_REPORT_EMPTY", "审查结果为空，无法生成报告。", 400)

    findings: list[Finding] = []
    for item in raw.get("findings") or []:
        if not isinstance(item, dict):
            continue
        findings.append(
            Finding(
                id=str(item.get("id") or ""),
                category=item.get("category") or "contract_trap",
                severity=item.get("severity") or "medium",
                title=str(item.get("title") or ""),
                description=str(item.get("description") or ""),
                advice=str(item.get("advice") or ""),
                evidence=item.get("evidence"),
                estimated_amount_minor=item.get("estimatedAmountMinor"),
                source=str(item.get("source") or "rule"),
                budget_item_ids=list(item.get("budgetItemIds") or []),
            )
        )
    report_obj = ReviewReport(
        summary=str(raw.get("summary") or ""),
        total_findings=int(raw.get("totalFindings") or len(findings)),
        by_severity=raw.get("bySeverity") or {"high": 0, "medium": 0, "low": 0},
        by_category=raw.get("byCategory") or {},
        findings=findings,
        contract_reliability_score=int(raw.get("contractReliabilityScore") or 0),
        predicted_extra_cost_minor=int(raw.get("predictedExtraCostMinor") or 0),
        llm_used=bool(raw.get("llmUsed")),
        llm_note=str(raw.get("llmNote") or ""),
    )
    pdf = review_report_pdf(report_obj)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="jianspace-review-report.pdf"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/materials/estimate")
def materials_estimate(body: EstimateIn):
    """按场景面积与风格输出材料清单与三档预算。"""
    return estimate_materials(body.scene or {}, body.styleId)


@router.post("/materials/from-image")
async def materials_from_effect_image(
    request: Request,
    user: CurrentUser,
    image: UploadFile = File(...),
    styleHint: str = Form(default=""),
):
    """上传 AI 效果图，反推墙面 / 地面 / 柜体 / 灯具材料建议。"""
    rate_limit("materials:" + request.client.host, 10, 300)
    if image.size and image.size > MAX_BYTES:
        raise DomainError("FILE_TOO_LARGE", "图片超过 12MB 上限。", 413)
    raw = await image.read()
    if not raw:
        raise DomainError("IMAGE_EMPTY", "图片内容为空。", 400)
    result = materials_from_image(raw, styleHint.strip())
    if not result.get("ok"):
        raise DomainError("MATERIAL_RECOGNITION_FAILED", result.get("reason", "材料识别失败。"), 502)
    return result


@router.get("/recognition/backend")
def recognition_backend():
    """当前户型识别后端配置。"""
    return {
        "current": settings.local_recognition_backend,
        "available": ["dashscope", "yolov8", "controlnet"],
        "device": settings.local_inference_device,
        "note": "LOCAL_RECOGNITION_BACKEND=yolov8 可切换到本地 GPU 推理。",
    }


@router.post("/recognition/recognize")
async def recognition_recognize(
    request: Request,
    user: CurrentUser,
    image: UploadFile = File(...),
    totalWidthMm: int = Form(default=8000),
    floorHeightMm: int = Form(default=2800),
    backend: str = Form(default=""),
):
    """用指定后端识别户型图，返回墙 / 洞口 / 房间的毫米坐标。"""
    rate_limit("recognition:" + request.client.host, 10, 300)
    if not 2000 <= totalWidthMm <= 30000:
        raise DomainError("PARAM_INVALID", "户型总宽需在 2000-30000mm 之间。", 400)
    if not 1500 <= floorHeightMm <= 6000:
        raise DomainError("PARAM_INVALID", "层高需在 1500-6000mm 之间。", 400)
    raw = await image.read()
    if not raw:
        raise DomainError("IMAGE_EMPTY", "图片内容为空。", 400)

    chosen = (backend or settings.local_recognition_backend).strip()
    if chosen not in ("dashscope", "yolov8"):
        raise DomainError("BACKEND_INVALID", f"未知识别后端 {chosen}。", 400)

    result = create_backend(chosen).recognize(raw, totalWidthMm, floorHeightMm)
    return {
        "backend": chosen,
        "success": result.success,
        "confidence": round(result.confidence, 3),
        "walls": result.walls,
        "openings": result.openings,
        "rooms": result.rooms,
        "notes": result.notes,
    }


@router.post("/recognition/render-constrained")
async def recognition_render_constrained(
    request: Request,
    user: CurrentUser,
    image: UploadFile = File(...),
    prompt: str = Form(default="现代简约风格客厅"),
):
    """ControlNet 约束生成：保持户型轮廓不变，只改风格。"""
    rate_limit("controlnet:" + request.client.host, 5, 300)
    raw = await image.read()
    if not raw:
        raise DomainError("IMAGE_EMPTY", "图片内容为空。", 400)
    from ..controlnet import generate_with_controlnet

    png, note = generate_with_controlnet(raw, prompt)
    return {
        "ok": True,
        "imageBase64": base64.b64encode(png).decode("ascii"),
        "mimeType": "image/png",
        "note": note,
    }
