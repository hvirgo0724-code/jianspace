import copy, re, time, threading, logging
from sqlalchemy import select, update
from .database import session_scope
from .models import (
    Job,
    Outbox,
    CreditAccount,
    CreditLedger,
    DesignVersion,
    Asset,
    Project,
    uid,
    now,
)
from .geometry import generate_layouts, content_hash
from .catalog import STYLES
from .storage import save_asset, asset_view
from .exports import export_scene
from .security import DomainError
from .config import settings

log = logging.getLogger(__name__)
LEASE_SECONDS = 180
HEARTBEAT_SECONDS = 30
MAX_HEARTBEAT_SECONDS = 420
ACTIVE = ("running", "cancel_requested")


def settle(db, j, success):
    """Settle inside the transaction that atomically owns the terminal transition."""
    if not j.reserved_credits:
        return
    cost = j.reserved_credits
    event = f"{j.id}:settle"
    if db.scalar(select(CreditLedger).where(CreditLedger.event_key == event)):
        return
    values = {"reserved": CreditAccount.reserved - cost}
    if not success:
        values["available"] = CreditAccount.available + cost
    changed = db.execute(
        update(CreditAccount)
        .where(CreditAccount.user_id == j.user_id, CreditAccount.reserved >= cost)
        .values(**values)
    )
    if changed.rowcount != 1:
        raise DomainError(
            "CREDIT_SETTLEMENT_FAILED", "积分结算异常，请联系管理员核对。", 500
        )
    db.add(
        CreditLedger(
            user_id=j.user_id,
            job_id=j.id,
            event_key=event,
            event_type="charge" if success else "release",
            delta_available=0 if success else cost,
            delta_reserved=-cost,
        )
    )
    j.charged_credits = cost if success else 0


def _safe_attempts(items):
    """Only public model identifiers and known rejection codes leave provider code."""
    if not isinstance(items, list):
        return []
    result = []
    codes = {
        "AllocationQuota.FreeTierOnly",
        "Throttling.RateQuota",
        "Throttling.AllocationQuota",
    }
    for item in items[:3]:
        if not isinstance(item, dict):
            continue
        model = item.get("model")
        if not isinstance(model, str) or not re.fullmatch(
            r"qwen-image-[0-9][A-Za-z0-9.-]{0,90}", model
        ):
            continue
        attempt = {"model": model}
        if isinstance(item.get("status"), str) and item["status"] in {
            "rejected",
            "succeeded",
        }:
            attempt["status"] = item["status"]
        status = item.get("httpStatus")
        if isinstance(status, int) and 100 <= status <= 599:
            attempt["httpStatus"] = status
        if isinstance(item.get("code"), str) and item["code"] in codes:
            attempt["code"] = item["code"]
        request_id = item.get("requestId")
        if isinstance(request_id, str) and re.fullmatch(
            r"[a-fA-F0-9-]{16,64}", request_id
        ):
            attempt["requestId"] = request_id
        result.append(attempt)
    return result


def _provider_summary(metadata):
    result = {"name": "dashscope"}
    for key in ("model", "requestedModel"):
        value = metadata.get(key)
        if isinstance(value, str) and re.fullmatch(
            r"qwen-image-[0-9][A-Za-z0-9.-]{0,90}", value
        ):
            result[key] = value
    result["fallbackUsed"] = metadata.get("fallbackUsed") is True
    result["modelAttempts"] = _safe_attempts(metadata.get("modelAttempts"))
    request_id = metadata.get("requestId")
    if isinstance(request_id, str) and re.fullmatch(r"[a-fA-F0-9-]{16,64}", request_id):
        result["requestId"] = request_id
    return result


def _renew_lease(jid, attempt):
    stamp = time.time()
    with session_scope() as db:
        changed = db.execute(
            update(Job)
            .where(
                Job.id == jid,
                Job.attempts == attempt,
                Job.status.in_(ACTIVE),
                Job.lease_until > stamp,
            )
            .values(lease_until=stamp + LEASE_SECONDS)
        )
        return changed.rowcount == 1


def _start_heartbeat(jid, attempt):
    stop = threading.Event()
    started = time.monotonic()

    def loop():
        while not stop.wait(HEARTBEAT_SECONDS):
            if time.monotonic() - started >= MAX_HEARTBEAT_SECONDS:
                return
            try:
                if not _renew_lease(jid, attempt):
                    return
            except Exception:
                log.warning("Lease renewal failed for job %s", jid)

    thread = threading.Thread(target=loop, name=f"job-heartbeat-{jid[:8]}", daemon=True)
    thread.start()
    return stop, thread


def _mark_provider_started(jid, attempt):
    with session_scope() as db:
        changed = db.execute(
            update(Job)
            .where(
                Job.id == jid,
                Job.attempts == attempt,
                Job.status == "running",
                Job.lease_until > time.time(),
                Job.project_id.in_(select(Project.id).where(Project.deleted == False)),
            )
            .values(
                stage="generating",
                progress=30,
                output_json={
                    "providerRequestStarted": True,
                    "providerResultState": "unknown",
                    "providerBillingUncertain": True,
                    "automaticRetryAllowed": False,
                },
            )
        )
        return changed.rowcount == 1


def _failure_output(exc, provider_started):
    rejected = isinstance(exc, DomainError) and exc.code in {
        "PROVIDER_NOT_CONFIGURED",
        "PROVIDER_CONFIG_INVALID",
        "PROVIDER_QUOTA_EXHAUSTED",
        "PROVIDER_RATE_LIMITED",
        "PROVIDER_AUTH_ERROR",
        "PROVIDER_ACCOUNT_UNAVAILABLE",
    }
    uncertain = provider_started and not rejected
    output = {
        "providerRequestStarted": provider_started,
        "providerResultState": "unknown"
        if uncertain
        else "rejected"
        if provider_started
        else "not_sent",
        "providerBillingUncertain": uncertain,
        "automaticRetryAllowed": False,
    }
    if isinstance(exc, DomainError):
        attempts = _safe_attempts(exc.details.get("modelAttempts"))
        if attempts:
            output["provider"] = {"name": "dashscope", "modelAttempts": attempts}
    return output


def _finish_once(jid, attempt, result=None, exc=None, provider_started=False):
    """A late worker can never overwrite cancellation or lease recovery results."""
    with session_scope() as db:
        j = db.get(Job, jid)
        if not j or j.status not in ACTIVE or j.attempts != attempt:
            return False
        p = db.get(Project, j.project_id)
        cancelled = j.status == "cancel_requested" or not p or p.deleted
        status = "cancelled" if cancelled else "failed" if exc else "succeeded"
        stamp = time.time()
        conditions = [
            Job.id == jid,
            Job.attempts == attempt,
            Job.status == j.status,
            Job.lease_until > stamp,
        ]
        if status == "succeeded":
            conditions.append(
                Job.project_id.in_(select(Project.id).where(Project.deleted == False))
            )
        changed = db.execute(
            update(Job)
            .where(*conditions)
            .values(
                status=status,
                stage="complete" if status == "succeeded" else status,
                finished_at=now(),
                lease_until=None,
            )
        )
        if changed.rowcount != 1:
            return False
        db.refresh(j)
        output = result["output"] if result else _failure_output(exc, provider_started)
        if exc and result and result["kind"] in ("generated", "recognized_plan"):
            output = {
                **output,
                "providerBillingUncertain": True,
                "outputPublicationFailed": True,
                "automaticRetryAllowed": False,
            }
        if cancelled:
            j.output_json = {
                **{k: v for k, v in output.items() if k not in {"assets", "designIds"}},
                "cancelledBeforeProviderRequest": not provider_started,
                "providerUsageMayApply": provider_started,
            }
            j.error_code = j.error_message = None
        elif exc:
            j.output_json = output
            j.error_code = exc.code if isinstance(exc, DomainError) else "TASK_FAILED"
            j.error_message = (
                exc.message
                if isinstance(exc, DomainError)
                else "任务处理失败，请稍后重试。"
            )
        else:
            if result["kind"] == "layout":
                ids = []
                for s in result["scenes"]:
                    d = DesignVersion(
                        id=uid(),
                        project_id=j.project_id,
                        geometry_version_id=s["geometryVersionId"],
                        parent_id=result.get("parentId"),
                        title=s["layout"]["name"],
                        scene_json=s,
                        scene_hash=content_hash(s),
                        creator_id=j.user_id,
                    )
                    db.add(d)
                    ids.append(d.id)
                output = {**output, "designIds": ids}
            else:
                asset = save_asset(
                    db,
                    j.project_id,
                    j.user_id,
                    result["data"],
                    result["name"],
                    result["kind"],
                    result["media"],
                    result.get("metadata"),
                    result.get("roomId"),
                )
                output = {**output, "assets": [asset_view(asset)]}
            j.output_json = output
            j.progress = 100
            j.error_code = j.error_message = None
        settle(db, j, status == "succeeded")
        return True


def _finish(jid, attempt, result=None, exc=None, provider_started=False):
    # A cancel can win after the first status read but before the compare-and-set.
    # Re-read once more to finish cancellation immediately, without a provider retry.
    for _ in range(3):
        if _finish_once(jid, attempt, result, exc, provider_started):
            return True
        with session_scope() as db:
            j = db.get(Job, jid)
            if (
                not j
                or j.status not in ACTIVE
                or j.attempts != attempt
                or not j.lease_until
                or j.lease_until <= time.time()
            ):
                return False
    return False


def process_job(jid):
    # Never hold a DB transaction during provider HTTP calls. Cancellation and
    # lease recovery stay usable while generation or structural audit is running.
    with session_scope() as db:
        claimed = db.execute(
            update(Job)
            .where(Job.id == jid, Job.status == "queued")
            .values(
                status="running",
                stage="processing",
                progress=10,
                lease_until=time.time() + LEASE_SECONDS,
                attempts=Job.attempts + 1,
            )
        )
        if claimed.rowcount != 1:
            return
        j = db.get(Job, jid)
        attempt = j.attempts
        scene = copy.deepcopy(j.input_json["scene"])
        params = copy.deepcopy(j.input_json["request"])
        task_type = j.type
        structure = j.input_json["structureHash"]
        assets = [db.get(Asset, aid) for aid in params.get("assetIds", [])]
        db.execute(update(Outbox).where(Outbox.job_id == jid).values(published=True))
    stop, heartbeat = _start_heartbeat(jid, attempt)
    provider_started = False
    result = None
    try:
        if task_type == "layout":
            candidates = generate_layouts(scene, count=3)
            if not candidates:
                raise DomainError(
                    "NO_VALID_LAYOUT",
                    "在当前尺寸和锁定条件下未找到可行方案；请调整家具或解除部分锁定。",
                )
            result = {
                "kind": "layout",
                "scenes": candidates,
                "parentId": params.get("inputDesignId"),
                "output": {
                    "candidateCount": len(candidates),
                    "method": "deterministic-constraints",
                    "constraints": [
                        "固定户型",
                        "锁定家具",
                        "净边界",
                        "家具碰撞",
                        "门扇区域",
                        "固定障碍物",
                    ],
                    "limitations": [
                        "未计算完整人体通行及无障碍规范",
                        "布局结果为概念建议",
                    ],
                },
            }
        elif task_type == "export":
            data, media, name = export_scene(
                scene, params.get("parameters", {}).get("format", "pdf")
            )
            result = {
                "kind": "export",
                "data": data,
                "media": media,
                "name": name,
                "output": {},
            }
        elif task_type == "recognize":
            from .plan_recognition import recognize_plan
            from .storage import read

            if (
                len(assets) != 1
                or not assets[0]
                or assets[0].state != "ready"
                or assets[0].kind != "floorplan"
            ):
                raise DomainError(
                    "REFERENCE_UNAVAILABLE", "平面图已不可用，请重新上传。"
                )
            if not _mark_provider_started(jid, attempt):
                _finish(jid, attempt, provider_started=False)
                return
            provider_started = True
            data, metadata = recognize_plan(
                read(assets[0].object_key),
                scene,
                assets[0].id,
                params.get("parameters", {}),
            )
            result = {
                "kind": "recognized_plan",
                "data": data,
                "media": "application/json",
                "name": "平面图识别草稿.json",
                "metadata": metadata,
                "output": {
                    "note": "识别结果尚未载入项目。请在平面图导入中预览、校对后载入为未确认草稿。",
                    "provider": {"name": "dashscope", "model": metadata.get("model")},
                    "providerRequestStarted": True,
                    "providerResultState": "received",
                    "providerBillingUncertain": False,
                    "requiresMeasurementConfirmation": True,
                },
            }
        elif task_type in ("style", "render"):
            from .providers import generate_image

            if any(not a or a.state != "ready" or a.kind != "photo" for a in assets):
                raise DomainError(
                    "REFERENCE_UNAVAILABLE",
                    "生成所用照片已被移除，请重新选择参考照片。",
                )
            style = next(
                (s["name"] for s in STYLES if s["id"] in params["styleIds"]), "现代自然"
            )
            if not _mark_provider_started(jid, attempt):
                _finish(jid, attempt, provider_started=False)
                return
            provider_started = True
            context = None
            if params.get("parameters", {}).get("geometryGuide"):
                from .ai_context import measured_context

                context = measured_context(scene, params["roomIds"][0])
                data, metadata = generate_image(
                    assets, style, params["instruction"], geometry=context
                )
            else:
                data, metadata = generate_image(assets, style, params["instruction"])
            if context:
                metadata = {
                    **metadata,
                    "geometryReference": context,
                    "referenceAssetIds": params["assetIds"],
                    "review": {
                        "checks": {
                            k: "uncertain"
                            for k in (
                                "walls",
                                "doors",
                                "windows",
                                "furniture",
                                "proportions",
                            )
                        },
                        "notes": "",
                        "status": "needs_revision"
                        if metadata.get("structuralAudit", {}).get("decision")
                        == "needs_revision"
                        else "pending",
                    },
                }
            output = {
                "conceptOnly": True,
                "structureHash": structure,
                "note": "效果图可能偏离几何结构，不用于推断尺寸或施工。",
                "provider": _provider_summary(metadata),
                "providerRequestStarted": True,
                "providerResultState": "received",
                "providerBillingUncertain": False,
                "providerUsageMayApply": True,
            }
            if isinstance(metadata.get("structuralAudit"), dict):
                output["structuralAudit"] = metadata["structuralAudit"]
            result = {
                "kind": "generated",
                "data": data,
                "media": "image/jpeg",
                "name": style + "概念效果.jpg",
                "metadata": metadata,
                "roomId": params["roomIds"][0] if context else None,
                "output": output,
            }
        elif task_type == "inpaint":
            from .mask import composite_masked
            from .providers import edit_image_masked
            from .storage import read

            if (
                len(assets) != 1
                or not assets[0]
                or assets[0].state != "ready"
                or assets[0].kind not in ("photo", "generated")
            ):
                raise DomainError(
                    "REFERENCE_UNAVAILABLE", "局部改图的底图已不可用，请重新选择。"
                )
            mask_id = params.get("parameters", {}).get("maskAssetId")
            mask_asset = db.get(Asset, mask_id) if mask_id else None
            if (
                not mask_asset
                or mask_asset.state != "ready"
                or mask_asset.kind != "mask"
            ):
                raise DomainError(
                    "MASK_UNAVAILABLE", "蒙版已不可用，请重新涂抹后提交。"
                )
            if not _mark_provider_started(jid, attempt):
                _finish(jid, attempt, provider_started=False)
                return
            provider_started = True
            source_bytes = read(assets[0].object_key)
            mask_bytes = read(mask_asset.object_key)
            generated, metadata = edit_image_masked(
                source_bytes, mask_bytes, params["instruction"]
            )
            composed, stats = composite_masked(source_bytes, generated, mask_bytes)
            metadata = {
                **metadata,
                **stats,
                "sourceAssetId": assets[0].id,
                "maskAssetId": mask_asset.id,
                "conceptOnly": True,
            }
            output = {
                "conceptOnly": True,
                "structureHash": structure,
                "note": "局部改图只改变蒙版内像素；蒙版外保持原图，不用于推断尺寸或施工。",
                "provider": _provider_summary(metadata),
                "providerRequestStarted": True,
                "providerResultState": "received",
                "providerBillingUncertain": False,
                "providerUsageMayApply": True,
                "mask": {
                    "assetId": mask_asset.id,
                    "coverage": stats["maskCoverage"],
                    "outsideChangedPixels": stats["outsideChangedPixels"],
                    "policy": stats["compositePolicy"],
                },
            }
            result = {
                "kind": "generated",
                "data": composed,
                "media": "image/png",
                "name": "局部改图.png",
                "metadata": metadata,
                "roomId": assets[0].room_id,
                "output": output,
            }
        else:
            raise DomainError("FEATURE_NOT_READY", "该任务类型尚未启用。", 501)
        _finish(jid, attempt, result=result, provider_started=provider_started)
    except Exception as exc:
        if not isinstance(exc, DomainError):
            log.error("Job %s failed with %s", jid, type(exc).__name__)
        if result and result["kind"] in ("generated", "recognized_plan"):
            exc = DomainError(
                "OUTPUT_SAVE_FAILED",
                "生成结果保存失败，已释放应用积分。服务商可能已产生用量，请核对后再提交。",
                502,
            )
        _finish(jid, attempt, result=result, exc=exc, provider_started=provider_started)
    finally:
        stop.set()
        heartbeat.join(timeout=1)


def tick():
    with session_scope() as db:
        stamp = time.time()
        candidates = list(
            db.scalars(
                select(Job).where(
                    Job.status.in_(ACTIVE),
                    (Job.lease_until < stamp) | (Job.lease_until.is_(None)),
                )
            )
        )
        for j in candidates:
            queued_cancel = j.status == "cancel_requested" and not j.lease_until
            status = "cancelled" if queued_cancel else "failed"
            changed = db.execute(
                update(Job)
                .where(
                    Job.id == j.id,
                    Job.attempts == j.attempts,
                    Job.status == j.status,
                    (Job.lease_until < stamp) | (Job.lease_until.is_(None)),
                )
                .values(
                    status=status, stage=status, finished_at=now(), lease_until=None
                )
            )
            if changed.rowcount != 1:
                continue
            db.refresh(j)
            uncertain = bool(j.output_json.get("providerRequestStarted"))
            j.output_json = {
                **j.output_json,
                "providerResultState": "unknown" if uncertain else "not_sent",
                "providerBillingUncertain": uncertain,
                "automaticRetryAllowed": False,
            }
            if not queued_cancel:
                j.error_code = "WORKER_INTERRUPTED"
                j.error_message = "任务执行中断，已释放应用积分。" + (
                    "服务商侧可能产生用量，请人工核对。"
                    if uncertain
                    else "请重新提交任务。"
                )
            settle(db, j, False)
        ids = list(
            db.scalars(
                select(Job.id)
                .where(Job.status == "queued")
                .order_by(Job.created_at)
                .limit(3)
            )
        )
    if settings.task_backend == "database":
        for jid in ids:
            process_job(jid)
    else:
        from .celery_app import app

        with session_scope() as db:
            for event in db.scalars(
                select(Outbox).where(Outbox.published == False).limit(20)
            ):
                job = db.get(Job, event.job_id)
                if job and job.status == "queued":
                    app.send_task("interior.process_job", args=[event.job_id])
                event.published = True


def start_dispatcher():
    stop = threading.Event()

    def loop():
        while not stop.is_set():
            try:
                tick()
            except Exception:
                log.exception("Dispatcher error")
            stop.wait(1)

    thread = threading.Thread(target=loop, name="interior-dispatcher", daemon=True)
    thread.start()
    return stop, thread
