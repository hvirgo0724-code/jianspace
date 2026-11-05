import copy, time
from fastapi import APIRouter, Header
from sqlalchemy import select, update, func
from sqlalchemy.exc import IntegrityError
from ..security import DB, CurrentUser, authorize, DomainError
from ..models import (
    Job,
    Outbox,
    WorkingCopy,
    GeometryVersion,
    DesignVersion,
    Asset,
    Idempotency,
    CreditAccount,
    CreditLedger,
    uid,
    now,
)
from ..requests import JobCreate
from ..geometry import structure_hash, content_hash, validate_scene
from ..config import settings
from .projects import assert_owned

router = APIRouter()


def jview(j):
    active = j.status in {"queued", "running", "cancel_requested"}
    credit_state = (
        "none"
        if not j.reserved_credits
        else "reserved"
        if active
        else "charged"
        if j.charged_credits
        else "released"
    )
    return {
        "id": j.id,
        "projectId": j.project_id,
        "type": j.type,
        "status": j.status,
        "stage": j.stage,
        "progress": j.progress,
        "createdAt": j.created_at,
        "finishedAt": j.finished_at,
        "output": j.output_json,
        "error": {"code": j.error_code, "message": j.error_message}
        if j.error_code
        else None,
        "reservedCredits": j.reserved_credits,
        "chargedCredits": j.charged_credits,
        "currentlyReservedCredits": j.reserved_credits if active else 0,
        "creditState": credit_state,
        "providerBillingUncertain": bool(j.output_json.get("providerBillingUncertain")),
    }


@router.post("/projects/{project_id}/jobs", status_code=202)
def create_job(
    project_id: str,
    body: JobCreate,
    user: CurrentUser,
    db: DB,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    authorize(db, user, project_id, write=True)
    if not 8 <= len(idempotency_key) <= 128:
        raise DomainError("INVALID_IDEMPOTENCY_KEY", "任务请求必须携带有效幂等键。")
    route = f"{project_id}/jobs"
    hashed = content_hash(body.model_dump())
    old = db.get(Idempotency, (user.id, route, idempotency_key))
    if old:
        if old.request_hash != hashed:
            raise DomainError(
                "IDEMPOTENCY_CONFLICT", "同一幂等键不能提交不同内容。", 409
            )
        previous = db.get(Job, old.response_json.get("id"))
        if (
            not previous
            or previous.project_id != project_id
            or previous.user_id != user.id
        ):
            raise DomainError("JOB_NOT_FOUND", "原任务不存在，无法重复提交。", 404)
        return jview(previous)
    if body.type not in ("layout", "export", "style", "render", "recognize", "inpaint"):
        raise DomainError(
            "FEATURE_NOT_READY", "该功能尚未启用，当前可用布局、效果图和局部改图。", 501
        )
    if body.inputDesignId:
        s = copy.deepcopy(
            assert_owned(DesignVersion, db, body.inputDesignId, project_id).scene_json
        )
    else:
        w = db.get(WorkingCopy, (project_id, user.id))
        if not w:
            raise DomainError("DRAFT_MISSING", "请先创建并保存草稿。")
        s = copy.deepcopy(w.scene_json)
    g = db.get(GeometryVersion, s["geometryVersionId"])
    if body.type not in ("export", "recognize") and (
        not g
        or g.project_id != project_id
        or g.status != "confirmed"
        or g.structure_hash != structure_hash(s)
    ):
        raise DomainError("MEASUREMENT_UNCONFIRMED", "请先校验并确认实测户型。")
    report = validate_scene(s, check_layout=body.type != "layout")
    if not report["valid"] and body.type != "recognize":
        raise DomainError("GEOMETRY_INVALID", "当前场景有冲突，请先修正。", 422, report)
    if body.type == "export" and body.parameters.get("format", "pdf") not in (
        "pdf",
        "json",
        "csv",
    ):
        raise DomainError("INVALID_EXPORT_FORMAT", "支持 PDF、JSON 和 CSV 导出。")
    cost = 0
    request_payload = body.model_dump()
    if body.type != "inpaint" and body.maskDataUrl:
        raise DomainError("MASK_NOT_APPLICABLE", "只有局部改图任务可以携带蒙版。")
    if body.type == "inpaint":
        from ..mask import decode_mask
        from ..providers import validate_provider_configuration
        from ..storage import read, save_asset

        if len(body.assetIds) != 1:
            raise DomainError(
                "INPAINT_SOURCE_REQUIRED", "请只选择一张要局部修改的照片或效果图。"
            )
        source = assert_owned(Asset, db, body.assetIds[0], project_id)
        if source.state != "ready" or source.kind not in ("photo", "generated"):
            raise DomainError(
                "INVALID_INPAINT_SOURCE",
                "只能对当前项目中可用的房间照片或效果图做局部修改。",
            )
        if not body.instruction.strip():
            raise DomainError("INPAINT_INSTRUCTION_REQUIRED", "请写明要修改的内容。")
        if not settings.ai_ready:
            raise DomainError(
                "PROVIDER_NOT_CONFIGURED", "AI 服务未启用，请先配置服务端密钥。", 503
            )
        provider_configuration = validate_provider_configuration()
        if provider_configuration.get("configurationError"):
            raise DomainError(
                "PROVIDER_CONFIG_INVALID",
                provider_configuration["configurationError"],
                503,
            )
        mask_bytes, mask_meta = decode_mask(
            body.maskDataUrl, read(source.object_key)
        )
        daily = db.scalar(
            select(func.count())
            .select_from(Job)
            .where(
                Job.user_id == user.id,
                Job.type.in_(["style", "render", "recognize", "inpaint"]),
                Job.created_at >= time.strftime("%Y-%m-%d", time.gmtime()),
            )
        )
        from ..plans import entitlements

        if daily >= entitlements(db, user)["aiDailyLimit"]:
            raise DomainError("DAILY_LIMIT", "今日局部改图次数已达到限额。", 429)
        cost = settings.ai_inpaint_credits
        if body.maxCredits < cost:
            raise DomainError(
                "CREDIT_CONFIRMATION_REQUIRED",
                f"局部改图最多消耗 {cost} 应用积分，请确认费用。",
            )
        changed = db.execute(
            update(CreditAccount)
            .where(CreditAccount.user_id == user.id, CreditAccount.available >= cost)
            .values(
                available=CreditAccount.available - cost,
                reserved=CreditAccount.reserved + cost,
            )
        )
        if changed.rowcount != 1:
            raise DomainError(
                "INSUFFICIENT_CREDITS", "可用积分不足。当前版本尚未接通在线充值。", 402
            )
        mask_asset = save_asset(
            db,
            project_id,
            user.id,
            mask_bytes,
            "局部改图蒙版.png",
            kind="mask",
            media="image/png",
            metadata={**mask_meta, "sourceAssetId": source.id, "maskPurpose": "inpaint"},
            room_id=source.room_id,
        )
        request_payload = body.model_dump(exclude={"maskDataUrl"})
        request_payload["parameters"] = {
            **request_payload.get("parameters", {}),
            "maskAssetId": mask_asset.id,
            "maskCoverage": mask_meta["maskCoverage"],
        }
    if body.type == "recognize":
        from ..plan_recognition import validate_plan_parameters
        from ..providers import provider_base

        validate_plan_parameters(body.parameters)
        provider_base()
        if len(body.assetIds) != 1:
            raise DomainError("PLAN_IMAGE_REQUIRED", "请只选择一张清晰的单层平面图。")
        source = assert_owned(Asset, db, body.assetIds[0], project_id)
        if source.state != "ready" or source.kind != "floorplan":
            raise DomainError("PLAN_IMAGE_REQUIRED", "请选择通过平面图入口上传的文件。")
        daily = db.scalar(
            select(func.count())
            .select_from(Job)
            .where(
                Job.user_id == user.id,
                Job.type.in_(["style", "render", "recognize"]),
                Job.created_at >= time.strftime("%Y-%m-%d", time.gmtime()),
            )
        )
        from ..plans import entitlements

        if daily >= entitlements(db, user)["aiDailyLimit"]:
            raise DomainError("DAILY_LIMIT", "今日 AI 调用次数已达到限额。", 429)
        cost = settings.ai_plan_credits
        if body.maxCredits < cost:
            raise DomainError(
                "CREDIT_CONFIRMATION_REQUIRED",
                f"识别最多消耗 {cost} 应用积分，请先确认。",
            )
        changed = db.execute(
            update(CreditAccount)
            .where(CreditAccount.user_id == user.id, CreditAccount.available >= cost)
            .values(
                available=CreditAccount.available - cost,
                reserved=CreditAccount.reserved + cost,
            )
        )
        if changed.rowcount != 1:
            raise DomainError("INSUFFICIENT_CREDITS", "可用积分不足。", 402)
    if body.type in ("style", "render"):
        if body.parameters.get("geometryGuide"):
            if len(body.roomIds) != 1 or len(body.assetIds) > 2:
                raise DomainError(
                    "AI_ROOM_REQUIRED",
                    "实测引导生成需选择一个房间，最多两张该房间照片。",
                )
            if body.roomIds[0] not in [
                r["id"] for f in s["floors"] for r in f["rooms"]
            ]:
                raise DomainError("ROOM_MISSING", "所选房间不存在。")
        if not settings.ai_ready:
            raise DomainError(
                "PROVIDER_NOT_CONFIGURED", "AI 服务未启用，请先配置服务端密钥。", 503
            )
        from ..providers import validate_provider_configuration

        provider_configuration = validate_provider_configuration()
        if provider_configuration.get("configurationError"):
            raise DomainError(
                "PROVIDER_CONFIG_INVALID",
                provider_configuration["configurationError"],
                503,
            )
        if not body.assetIds:
            raise DomainError("PHOTO_REQUIRED", "请上传并选择至少一张房间照片。")
        selected_assets = []
        for aid in body.assetIds:
            a = assert_owned(Asset, db, aid, project_id)
            if a.state != "ready" or a.kind != "photo":
                raise DomainError(
                    "INVALID_REFERENCE_IMAGE", "只能使用当前项目中可用的房间照片。"
                )
            if body.parameters.get("geometryGuide") and a.room_id != body.roomIds[0]:
                raise DomainError(
                    "PHOTO_ROOM_MISMATCH", "照片必须关联到所选房间，请重新上传并关联。"
                )
            selected_assets.append(a)
        from ..providers import validate_generation_request

        validate_generation_request(s, selected_assets, body.model_dump())
        daily = db.scalar(
            select(func.count())
            .select_from(Job)
            .where(
                Job.user_id == user.id,
                Job.type.in_(["style", "render", "recognize"]),
                Job.created_at >= time.strftime("%Y-%m-%d", time.gmtime()),
            )
        )
        from ..plans import entitlements

        if daily >= entitlements(db, user)["aiDailyLimit"]:
            raise DomainError("DAILY_LIMIT", "今日生成次数已达到限额。", 429)
        cost = settings.ai_image_credits
        if body.maxCredits < cost:
            raise DomainError(
                "CREDIT_CONFIRMATION_REQUIRED",
                f"该任务最多消耗 {cost} 积分，请确认费用。",
            )
        result = db.execute(
            update(CreditAccount)
            .where(CreditAccount.user_id == user.id, CreditAccount.available >= cost)
            .values(
                available=CreditAccount.available - cost,
                reserved=CreditAccount.reserved + cost,
            )
        )
        if result.rowcount != 1:
            raise DomainError(
                "INSUFFICIENT_CREDITS", "可用积分不足。当前版本尚未接通在线充值。", 402
            )
    j = Job(
        id=uid(),
        project_id=project_id,
        user_id=user.id,
        type=body.type,
        input_json={
            "scene": s,
            "structureHash": structure_hash(s),
            "request": request_payload,
        },
        input_hash=hashed,
        reserved_credits=cost,
    )
    db.add(j)
    db.flush()
    db.add(Outbox(job_id=j.id))
    if cost:
        db.add(
            CreditLedger(
                user_id=user.id,
                job_id=j.id,
                event_key=f"{j.id}:reserve",
                event_type="reserve",
                delta_available=-cost,
                delta_reserved=cost,
            )
        )
    result = jview(j)
    db.add(
        Idempotency(
            user_id=user.id,
            route=route,
            key=idempotency_key,
            request_hash=hashed,
            response_json=result,
        )
    )
    try:
        # Flush here, before the dependency commits, so a concurrent identical
        # submission can roll back its reservation and return the winning task.
        db.flush()
    except IntegrityError:
        db.rollback()
        previous_request = db.get(Idempotency, (user.id, route, idempotency_key))
        if not previous_request:
            raise DomainError(
                "JOB_SUBMISSION_CONFLICT", "任务提交发生冲突，请使用原请求重试。", 409
            ) from None
        if previous_request.request_hash != hashed:
            raise DomainError(
                "IDEMPOTENCY_CONFLICT", "同一幂等键不能提交不同内容。", 409
            ) from None
        previous = db.get(Job, previous_request.response_json.get("id"))
        if (
            not previous
            or previous.project_id != project_id
            or previous.user_id != user.id
        ):
            raise DomainError(
                "JOB_NOT_FOUND", "原任务不存在，无法重复提交。", 404
            ) from None
        return jview(previous)
    return result


@router.get("/projects/{project_id}/jobs")
def jobs(project_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return {
        "items": [
            jview(j)
            for j in db.scalars(
                select(Job)
                .where(Job.project_id == project_id)
                .order_by(Job.created_at.desc())
                .limit(100)
            )
        ]
    }


@router.get("/jobs/{job_id}")
def job(job_id: str, user: CurrentUser, db: DB):
    j = db.get(Job, job_id)
    if not j:
        raise DomainError("JOB_NOT_FOUND", "任务不存在。", 404)
    authorize(db, user, j.project_id)
    return jview(j)


@router.post("/jobs/{job_id}/cancel")
def cancel(job_id: str, user: CurrentUser, db: DB):
    j = db.get(Job, job_id)
    if not j:
        raise DomainError("JOB_NOT_FOUND", "任务不存在。", 404)
    authorize(db, user, j.project_id, write=True)
    # The conditional updates make cancel linearizable with a worker claiming or
    # finishing the same task. Never overwrite a completed task from a stale read.
    cancelled = db.execute(
        update(Job)
        .where(Job.id == job_id, Job.status == "queued")
        .values(
            status="cancelled", stage="cancelled", finished_at=now(), lease_until=None
        )
    )
    if cancelled.rowcount == 1:
        from ..worker import settle

        db.refresh(j)
        j.output_json = {
            "providerResultState": "not_sent",
            "providerBillingUncertain": False,
            "cancelledBeforeProviderRequest": True,
        }
        settle(db, j, False)
        db.execute(update(Outbox).where(Outbox.job_id == job_id).values(published=True))
    else:
        db.execute(
            update(Job)
            .where(Job.id == job_id, Job.status == "running")
            .values(status="cancel_requested", stage="cancelling")
        )
        db.refresh(j)
    return jview(j)
