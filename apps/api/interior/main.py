import hmac, uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Body
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .config import settings
from .database import Base, engine
from . import models  # noqa: F401 — registers all tables before development initialization
from .security import DomainError, DB, CurrentUser, digest
from .models import CreditAccount, CreditLedger, UserSession
from .catalog import CATALOG, STYLES
from .templates import list_templates
from .routes import auth, projects, assets, jobs, collaboration, account
from .routes import assistant as assistant_routes


@asynccontextmanager
async def lifespan(app):
    if settings.production:
        if not settings.cookie_secure:
            raise RuntimeError("Production requires COOKIE_SECURE=true and TLS")
        if settings.database_url.startswith("sqlite"):
            raise RuntimeError("Production requires PostgreSQL + migrations")
        if settings.task_backend != "celery":
            raise RuntimeError("Production requires Celery/Redis")
    else:
        Base.metadata.create_all(engine)
    from .worker import start_dispatcher

    stop, thread = start_dispatcher()
    yield
    stop.set()
    thread.join(timeout=2)


app = FastAPI(title="筑见 · 实测空间设计 API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.app_origins.split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
)


@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    return JSONResponse(
        {
            "error": {
                "code": "CONCURRENT_WRITE",
                "message": "数据已被另一请求更新，请刷新后重试。",
            },
            "requestId": getattr(request.state, "request_id", ""),
        },
        status_code=409,
    )


@app.exception_handler(DomainError)
async def domain_error(request, exc):
    return JSONResponse(
        {
            "error": {"code": exc.code, "message": exc.message, "details": exc.details},
            "requestId": getattr(request.state, "request_id", ""),
        },
        status_code=exc.status,
    )


@app.middleware("http")
async def guard(request: Request, call_next):
    rid = str(uuid.uuid4())
    request.state.request_id = rid
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin not in settings.app_origins.split(","):
            return JSONResponse(
                {
                    "error": {
                        "code": "ORIGIN_FORBIDDEN",
                        "message": "请求来源未被允许。",
                    }
                },
                status_code=403,
            )
        try:
            size = int(request.headers.get("content-length", "0"))
        except ValueError:
            size = 0
        if size > 17 * 1024 * 1024:
            return JSONResponse(
                {
                    "error": {
                        "code": "PAYLOAD_TOO_LARGE",
                        "message": "请求体超过大小限制。",
                    }
                },
                status_code=413,
            )
        raw = request.cookies.get("interior_session")
        if raw:
            from .database import SessionLocal

            with SessionLocal() as db:
                session = db.scalar(
                    select(UserSession).where(UserSession.token_hash == digest(raw))
                )
                csrf = request.headers.get("x-csrf-token", "")
                if session and not hmac.compare_digest(session.csrf_hash, digest(csrf)):
                    return JSONResponse(
                        {
                            "error": {
                                "code": "CSRF_INVALID",
                                "message": "会话校验失效，请刷新页面。",
                            }
                        },
                        status_code=403,
                    )
    response = await call_next(request)
    response.headers["X-Request-Id"] = rid
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if (
        "/public/shares/" in request.url.path
        or request.url.path.startswith("/api/account")
        or request.url.path in ("/api/me", "/api/credits")
    ):
        response.headers["Cache-Control"] = "no-store"
    return response


for r in (
    auth.router,
    projects.router,
    assets.router,
    jobs.router,
    collaboration.router,
    account.router,
    assistant_routes.router,
):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.1.0", "environment": settings.app_env}


@app.get("/api/capabilities")
def capabilities():
    from .providers import validate_provider_configuration

    config = validate_provider_configuration()
    return {
        "aiImage": settings.ai_ready and config["configurationError"] is None,
        "aiInpaint": settings.ai_ready and config["configurationError"] is None,
        "aiInpaintCredits": settings.ai_inpaint_credits,
        "aiPlan": settings.ai_ready,
        "aiPlanCredits": settings.ai_plan_credits,
        "aiModels": config["models"],
        "aiConfigurationError": config["configurationError"],
        "structuralAuditEnabled": settings.ai_structure_review_enabled,
        "structuralAuditModel": settings.dashscope_vision_model
        if settings.ai_structure_review_enabled
        else None,
        "aiCreditsPerImage": settings.ai_image_credits,
        "payment": False,
        "registration": settings.allow_self_register,
        "demo": not settings.production,
        "taskBackend": settings.task_backend,
        "storage": settings.storage_backend,
        "email": bool(settings.smtp_host),
        "constraintsVersion": "1.0",
        "features": {
            "measurement": True,
            "editor2d": True,
            "homeTemplates": True,
            "maxFloors": 2,
            "preview3d": True,
            "layout": True,
            "photoUpload": True,
            "recognition": True,
            "inpaint": False,
            "exports": ["pdf", "json", "csv"],
        },
    }


@app.get("/api/catalog")
def catalog():
    return {
        "items": CATALOG,
        "styles": STYLES,
        "note": "尺寸化通用家具模型；价格需另行询价。",
    }


@app.post("/api/review/analyze")
def review_analyze(payload: dict = Body(...)):
    """装修避坑审查：上传文本（合同/报价单内容）进行关键词匹配分析。"""
    text = payload.get("content", "")
    from .review import match_findings, summarize_findings
    findings = match_findings(text)
    report = summarize_findings(findings)
    return {
        "summary": report.summary,
        "totalFindings": report.total_findings,
        "bySeverity": report.by_severity,
        "byCategory": report.by_category,
        "findings": [
            {
                "id": f.id,
                "category": f.category,
                "severity": f.severity,
                "title": f.title,
                "description": f.description,
                "advice": f.advice,
                "estimatedAmountMinor": f.estimated_amount_minor,
            }
            for f in report.findings
        ],
        "contractReliabilityScore": report.contract_reliability_score,
        "predictedExtraCostMinor": report.predicted_extra_cost_minor,
    }


@app.get("/api/review/budget-tiers")
def review_budget_tiers():
    """返回装修材料三档预算表。"""
    from .review import BUDGET_TIERS
    return {"tiers": BUDGET_TIERS}


@app.post("/api/materials/estimate")
def materials_estimate(payload: dict = Body(...)):
    """根据场景 + 风格生成材料清单 + 三档预算。"""
    scene = payload.get("scene", {})
    style_id = payload.get("styleId")
    from .review import estimate_materials
    return estimate_materials(scene, style_id)


@app.get("/api/recognition/backend")
def recognition_backend():
    """返回当前户型识别后端配置。"""
    return {
        "current": settings.local_recognition_backend,
        "available": ["dashscope", "yolov8"],
        "note": "将 LOCAL_RECOGNITION_BACKEND=yolov8 并安装 ultralytics+PyTorch CUDA 启用本地 GPU 推理。",
    }


@app.get("/api/home-templates")
def home_templates():
    return {
        "items": list_templates(),
        "note": "示例净面积，非建筑面积；所有尺寸均需实测替换。",
    }


@app.get("/api/credits")
def credits(user: CurrentUser, db: DB):
    a = db.get(CreditAccount, user.id)
    return {
        "available": a.available if a else 0,
        "reserved": a.reserved if a else 0,
        "paymentEnabled": False,
        "developmentGrant": user.is_demo,
        "ledger": [
            {
                "id": l.id,
                "type": l.event_type,
                "deltaAvailable": l.delta_available,
                "deltaReserved": l.delta_reserved,
                "createdAt": l.created_at,
            }
            for l in db.scalars(
                select(CreditLedger)
                .where(CreditLedger.user_id == user.id)
                .order_by(CreditLedger.created_at.desc())
                .limit(50)
            )
        ],
    }
