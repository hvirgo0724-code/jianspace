"""Normal API task lifecycle tests; all provider calls use local fixtures."""

import io
import threading
import time
import uuid

import pytest
from PIL import Image
from sqlalchemy import func, select

from interior import providers, storage, worker
from interior.config import settings
from interior.database import session_scope
from interior.models import Asset, CreditLedger, Idempotency, Job, Project
from interior.security import DomainError


@pytest.fixture
def generation(signed, confirmed, monkeypatch):
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "fixture-key-never-live")
    pid, w = confirmed
    rid = w["scene"]["floors"][0]["rooms"][0]["id"]
    buf = io.BytesIO()
    Image.new("RGB", (400, 400), "white").save(buf, "JPEG")
    image = buf.getvalue()
    uploaded = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("synthetic-fixture.jpg", image, "image/jpeg")},
        data={"roomId": rid},
    )
    assert uploaded.status_code == 201, uploaded.text
    aid = uploaded.json()["id"]
    body = {
        "type": "style",
        "assetIds": [aid],
        "roomIds": [rid],
        "parameters": {"geometryGuide": True},
        "maxCredits": 10,
    }
    metadata = {
        "provider": "dashscope",
        "model": "qwen-image-2.0",
        "requestedModel": "qwen-image-2.0-pro",
        "fallbackUsed": True,
        "requestId": "11111111-2222-3333-4444-555555555555",
        "modelAttempts": [
            {
                "model": "qwen-image-2.0-pro",
                "status": "rejected",
                "httpStatus": 403,
                "code": "AllocationQuota.FreeTierOnly",
            },
            {"model": "qwen-image-2.0", "status": "succeeded", "httpStatus": 200},
        ],
        "structuralAudit": {
            "status": "completed",
            "decision": "needs_revision",
            "issues": [{"code": "ADDED_DOOR"}],
        },
    }
    calls = []

    def fake(*args, **kwargs):
        calls.append(True)
        return image, metadata

    monkeypatch.setattr(providers, "generate_image", fake)
    before = signed.get("/api/credits").json()["available"]
    return pid, body, image, metadata, calls, before


def create(signed, generation, key=None):
    pid, body, *_ = generation
    key = key or str(uuid.uuid4())
    response = signed.post(
        f"/api/projects/{pid}/jobs", json=body, headers={"Idempotency-Key": key}
    )
    assert response.status_code == 202, response.text
    return response.json(), key


def assert_released(signed, job, before):
    assert job["chargedCredits"] == 0
    assert job["creditState"] == "released" and job["currentlyReservedCredits"] == 0
    account = signed.get("/api/credits").json()
    assert account["available"] == before and account["reserved"] == 0
    with session_scope() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(CreditLedger)
                .where(CreditLedger.event_key == job["id"] + ":settle")
            )
            == 1
        )


def test_api_success_replay_returns_current_state_and_settles_only_once(
    signed, generation
):
    pid, body, _, _, calls, before = generation
    submitted, key = create(signed, generation)
    assert (
        submitted["creditState"] == "reserved"
        and submitted["currentlyReservedCredits"] == 10
    )
    worker.process_job(submitted["id"])
    worker.process_job(submitted["id"])
    replay = signed.post(
        f"/api/projects/{pid}/jobs", json=body, headers={"Idempotency-Key": key}
    ).json()
    assert replay["id"] == submitted["id"] and replay["status"] == "succeeded"
    assert (
        replay["creditState"] == "charged" and replay["currentlyReservedCredits"] == 0
    )
    assert replay["chargedCredits"] == 10 and len(calls) == 1
    assert replay["output"]["provider"]["model"] == "qwen-image-2.0"
    assert len(replay["output"]["provider"]["modelAttempts"]) == 2
    assert replay["output"]["structuralAudit"]["decision"] == "needs_revision"
    asset = replay["output"]["assets"][0]
    assert asset["metadata"]["review"]["status"] == "needs_revision"
    assert asset["roomId"] == body["roomIds"][0]
    assert asset["metadata"]["geometryReference"]["roomId"] == body["roomIds"][0]
    assert signed.get(asset["url"]).status_code == 200
    account = signed.get("/api/credits").json()
    assert account["available"] == before - 10 and account["reserved"] == 0
    with session_scope() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(CreditLedger)
                .where(CreditLedger.job_id == submitted["id"])
            )
            == 2
        )
    changed = signed.post(
        f"/api/projects/{pid}/jobs",
        json={**body, "instruction": "changed"},
        headers={"Idempotency-Key": key},
    )
    assert changed.status_code == 409


def test_queued_cancel_releases_immediately_without_a_provider_call(signed, generation):
    *_, calls, before = generation
    submitted, _ = create(signed, generation)
    cancelled = signed.post("/api/jobs/" + submitted["id"] + "/cancel").json()
    assert cancelled["status"] == "cancelled" and cancelled["stage"] == "cancelled"
    assert cancelled["output"]["cancelledBeforeProviderRequest"] is True
    worker.process_job(submitted["id"])
    worker.tick()
    signed.post("/api/jobs/" + submitted["id"] + "/cancel")
    assert not calls
    assert_released(signed, cancelled, before)


def test_running_cancel_remains_usable_and_discards_late_image(
    signed, generation, monkeypatch
):
    pid, _, image, metadata, _, before = generation
    submitted, _ = create(signed, generation)
    started, resume = threading.Event(), threading.Event()

    def blocked(*args, **kwargs):
        started.set()
        assert resume.wait(5)
        return image, metadata

    monkeypatch.setattr(providers, "generate_image", blocked)
    runner = threading.Thread(
        target=worker.process_job, args=(submitted["id"],), daemon=True
    )
    runner.start()
    try:
        assert started.wait(5)
        cancelling = signed.post("/api/jobs/" + submitted["id"] + "/cancel").json()
        assert (
            cancelling["status"] == "cancel_requested"
            and cancelling["stage"] == "cancelling"
        )
        assert cancelling["creditState"] == "reserved"
    finally:
        resume.set()
        runner.join(5)
    assert not runner.is_alive()
    job = signed.get("/api/jobs/" + submitted["id"]).json()
    assert (
        job["status"] == "cancelled"
        and job["output"]["providerResultState"] == "received"
    )
    assert job["output"]["providerUsageMayApply"] is True
    assert not [
        a
        for a in signed.get(f"/api/projects/{pid}/assets").json()["items"]
        if a["kind"] == "generated"
    ]
    assert_released(signed, job, before)


def test_cancellation_wins_when_inflight_provider_then_fails(
    signed, generation, monkeypatch
):
    *_, before = generation
    submitted, _ = create(signed, generation)

    def fail(*args, **kwargs):
        response = signed.post("/api/jobs/" + submitted["id"] + "/cancel")
        assert response.json()["status"] == "cancel_requested"
        raise DomainError(
            "PROVIDER_REQUEST_UNCERTAIN", "请求结果未知，请核对服务商记录。", 502
        )

    monkeypatch.setattr(providers, "generate_image", fail)
    worker.process_job(submitted["id"])
    job = signed.get("/api/jobs/" + submitted["id"]).json()
    assert job["status"] == "cancelled" and job["error"] is None
    assert job["providerBillingUncertain"] is True
    assert_released(signed, job, before)


def test_lease_recovery_owns_failure_and_late_worker_cannot_publish(
    signed, generation, monkeypatch
):
    _, _, image, metadata, _, before = generation
    submitted, _ = create(signed, generation)

    def late(*args, **kwargs):
        with session_scope() as db:
            j = db.get(Job, submitted["id"])
            j.lease_until = time.time() - 1
        assert worker._renew_lease(submitted["id"], 1) is False
        worker.tick()
        return image, metadata

    monkeypatch.setattr(providers, "generate_image", late)
    worker.process_job(submitted["id"])
    worker.tick()
    worker.process_job(submitted["id"])
    job = signed.get("/api/jobs/" + submitted["id"]).json()
    assert job["status"] == "failed" and job["error"]["code"] == "WORKER_INTERRUPTED"
    assert job["stage"] == "failed" and job["providerBillingUncertain"] is True
    assert (
        signed.post("/api/jobs/" + submitted["id"] + "/cancel").json()["status"]
        == "failed"
    )
    with session_scope() as db:
        assert (
            db.scalar(
                select(func.count()).select_from(Asset).where(Asset.kind == "generated")
            )
            == 0
        )
    assert_released(signed, job, before)


def test_heartbeat_renews_only_the_live_owner(signed, generation):
    submitted, _ = create(signed, generation)
    old = time.time() + 10
    with session_scope() as db:
        j = db.get(Job, submitted["id"])
        j.status, j.attempts, j.lease_until = "running", 1, old
    assert worker._renew_lease(submitted["id"], 2) is False
    assert worker._renew_lease(submitted["id"], 1) is True
    with session_scope() as db:
        assert db.get(Job, submitted["id"]).lease_until > old + 100
    worker._finish(submitted["id"], 1, exc=DomainError("TEST_STOP", "fixture stop"))
    assert worker._renew_lease(submitted["id"], 1) is False


def test_provider_timeout_records_uncertainty_and_releases_once(
    signed, generation, monkeypatch
):
    *_, before = generation
    submitted, _ = create(signed, generation)

    def fail(*args, **kwargs):
        raise DomainError(
            "PROVIDER_REQUEST_UNCERTAIN", "请求结果未知，请核对服务商记录。", 502
        )

    monkeypatch.setattr(providers, "generate_image", fail)
    worker.process_job(submitted["id"])
    worker.process_job(submitted["id"])
    job = signed.get("/api/jobs/" + submitted["id"]).json()
    assert job["status"] == "failed" and job["providerBillingUncertain"] is True
    assert job["output"]["automaticRetryAllowed"] is False
    assert_released(signed, job, before)


def test_failure_attempts_are_safe_and_unknown_exception_does_not_leak(
    signed, generation, monkeypatch, caplog
):
    *_, before = generation
    submitted, _ = create(signed, generation)

    def quota(*args, **kwargs):
        raise DomainError(
            "PROVIDER_QUOTA_EXHAUSTED",
            "候选额度不足。",
            503,
            {
                "modelAttempts": [
                    {
                        "model": "qwen-image-2.0-pro",
                        "status": "rejected",
                        "httpStatus": 403,
                        "code": "AllocationQuota.FreeTierOnly",
                        "message": "private-provider-message",
                    },
                    {
                        "model": "private-api-key",
                        "status": ["malformed"],
                        "code": ["malformed"],
                    },
                ]
            },
        )

    monkeypatch.setattr(providers, "generate_image", quota)
    worker.process_job(submitted["id"])
    job = signed.get("/api/jobs/" + submitted["id"]).json()
    assert (
        job["output"]["providerResultState"] == "rejected"
        and not job["providerBillingUncertain"]
    )
    assert len(job["output"]["provider"]["modelAttempts"]) == 1
    assert "private" not in str(job)
    assert_released(signed, job, before)
    second, _ = create(signed, generation)

    def broken(*args, **kwargs):
        raise RuntimeError("private-provider-url-and-key")

    monkeypatch.setattr(providers, "generate_image", broken)
    worker.process_job(second["id"])
    job = signed.get("/api/jobs/" + second["id"]).json()
    assert job["error"]["code"] == "TASK_FAILED" and "private" not in str(job)
    assert "private-provider-url-and-key" not in caplog.text
    assert_released(signed, job, before)


def test_configuration_preflight_rejects_before_reserving_credits(
    signed, generation, monkeypatch
):
    pid, body, _, _, calls, before = generation
    monkeypatch.setattr(
        providers,
        "validate_provider_configuration",
        lambda: {"models": [], "configurationError": "备用模型配置无效。"},
    )
    response = signed.post(
        f"/api/projects/{pid}/jobs",
        json=body,
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert (
        response.status_code == 503
        and response.json()["error"]["code"] == "PROVIDER_CONFIG_INVALID"
    )
    assert signed.get("/api/credits").json()["available"] == before
    assert not calls


def test_output_storage_failure_rolls_back_success_and_releases_once(
    signed, generation, monkeypatch
):
    *_, before = generation
    submitted, _ = create(signed, generation)

    def disk_failure(*args, **kwargs):
        raise OSError("test-only-disk-write-failed")

    monkeypatch.setattr(worker, "save_asset", disk_failure)
    worker.process_job(submitted["id"])
    worker.process_job(submitted["id"])
    job = signed.get("/api/jobs/" + submitted["id"]).json()
    assert job["status"] == "failed" and job["error"]["code"] == "OUTPUT_SAVE_FAILED"
    assert job["output"]["provider"]["model"] == "qwen-image-2.0"
    assert job["output"]["providerResultState"] == "received"
    assert job["output"]["outputPublicationFailed"] is True
    assert job["providerBillingUncertain"] is True
    with session_scope() as db:
        assert (
            db.scalar(
                select(func.count()).select_from(Asset).where(Asset.kind == "generated")
            )
            == 0
        )
    assert_released(signed, job, before)


def test_partial_object_write_is_cleaned_and_job_reservation_released(
    signed, generation, monkeypatch
):
    *_, before = generation
    submitted, _ = create(signed, generation)
    original_put = storage.put
    written = []

    def partial(key, data, media):
        original_put(key, data, media)
        written.append(key)
        raise OSError("test-only-interrupted-write")

    monkeypatch.setattr(storage, "put", partial)
    worker.process_job(submitted["id"])
    worker.process_job(submitted["id"])
    job = signed.get("/api/jobs/" + submitted["id"]).json()
    assert job["status"] == "failed" and len(written) == 1
    assert not (storage.root() / written[0]).exists()
    with session_scope() as db:
        assert (
            db.scalar(
                select(func.count()).select_from(Asset).where(Asset.kind == "generated")
            )
            == 0
        )
    assert_released(signed, job, before)


def test_asset_metadata_flush_failure_writes_no_object_and_releases(
    signed, generation, monkeypatch
):
    from sqlalchemy.orm import Session

    *_, before = generation
    submitted, _ = create(signed, generation)
    original_flush = Session.flush
    writes = []

    def fail_asset(session, *args, **kwargs):
        if any(
            isinstance(value, Asset) and value.kind == "generated"
            for value in session.new
        ):
            raise RuntimeError("test-only-asset-db-flush")
        return original_flush(session, *args, **kwargs)

    monkeypatch.setattr(Session, "flush", fail_asset)
    monkeypatch.setattr(storage, "put", lambda *args: writes.append(args[0]))
    worker.process_job(submitted["id"])
    job = signed.get("/api/jobs/" + submitted["id"]).json()
    assert job["status"] == "failed" and not writes
    with session_scope() as db:
        assert (
            db.scalar(
                select(func.count()).select_from(Asset).where(Asset.kind == "generated")
            )
            == 0
        )
    assert_released(signed, job, before)


def test_asset_cleanup_error_preserves_original_write_exception(
    generation, monkeypatch, caplog
):
    pid, _, image, *_ = generation

    def broken_write(*args):
        raise OSError("primary-write-error")

    def broken_cleanup(*args):
        raise RuntimeError("private-cleanup-url-and-credentials")

    monkeypatch.setattr(storage, "put", broken_write)
    monkeypatch.setattr(storage, "remove", broken_cleanup)
    with pytest.raises(OSError, match="primary-write-error"):
        with session_scope() as db:
            project = db.get(Project, pid)
            storage.save_asset(
                db, pid, project.owner_id, image, "fixture.jpg", "generated"
            )
    assert "private-cleanup-url-and-credentials" not in caplog.text
    with session_scope() as db:
        assert (
            db.scalar(
                select(func.count()).select_from(Asset).where(Asset.kind == "generated")
            )
            == 0
        )


def test_concurrent_same_request_creates_one_task_and_one_reservation(
    signed, generation, monkeypatch
):
    from sqlalchemy.orm import Session

    pid, body, _, _, _, before = generation
    key = str(uuid.uuid4())
    original_get = Session.get
    rendezvous = threading.Barrier(2)
    lock = threading.Lock()
    initial_lookups = 0

    def get(session, entity, ident, **kwargs):
        nonlocal initial_lookups
        value = original_get(session, entity, ident, **kwargs)
        pause = False
        if entity is Idempotency and value is None:
            with lock:
                initial_lookups += 1
                pause = initial_lookups <= 2
        if pause:
            rendezvous.wait(5)
        return value

    monkeypatch.setattr(Session, "get", get)
    responses, errors = [], []

    def submit():
        try:
            responses.append(
                signed.post(
                    f"/api/projects/{pid}/jobs",
                    json=body,
                    headers={"Idempotency-Key": key},
                )
            )
        except Exception as exc:
            errors.append(type(exc).__name__)

    threads = [threading.Thread(target=submit, daemon=True) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(8)
    assert not any(thread.is_alive() for thread in threads)
    assert not errors and len(responses) == 2
    assert [r.status_code for r in responses] == [202, 202]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    account = signed.get("/api/credits").json()
    assert account["available"] == before - 10 and account["reserved"] == 10
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(Job)) == 1
        assert (
            db.scalar(
                select(func.count())
                .select_from(CreditLedger)
                .where(CreditLedger.event_type == "reserve")
            )
            == 1
        )
