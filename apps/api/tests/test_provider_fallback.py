"""No live provider calls: all HTTP responses and image bytes are fixtures."""

import base64
import io
import uuid
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image

from interior import providers
from interior.config import settings
from interior.security import DomainError
from interior.worker import process_job

PRIMARY = "qwen-image-2.0-pro"
BACKUP = "qwen-image-2.0"
THIRD = "qwen-image-2.0-pro-2026-06-22"


@pytest.fixture
def fake_provider(monkeypatch):
    raw = io.BytesIO()
    Image.new("RGB", (400, 400), "white").save(raw, "JPEG")
    image = raw.getvalue()
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_image_model", PRIMARY)
    monkeypatch.setattr(
        settings, "dashscope_image_fallback_models", f"{BACKUP},{THIRD}"
    )
    monkeypatch.setattr(providers, "read", lambda key: image)
    calls = []
    responses = []

    class Client:
        def __init__(self, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kw):
            calls.append({"url": url, "json": kw["json"]})
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

        def stream(self, *args, **kw):
            raise httpx.ReadTimeout("test download only")

    monkeypatch.setattr(providers.httpx, "Client", Client)
    return responses, calls, image


def success(image):
    return httpx.Response(
        200,
        json={
            "output": {
                "choices": [
                    {
                        "message": {
                            "content": [
                                {
                                    "image": "data:image/jpeg;base64,"
                                    + base64.b64encode(image).decode()
                                }
                            ]
                        }
                    }
                ]
            },
            "request_id": "fixture-success",
        },
    )


def reject(code, status=403):
    return httpx.Response(
        status,
        json={
            "code": code,
            "request_id": "fixture-rejected",
            "message": "Untrusted provider message including test-only-never-live must not be exposed",
        },
    )


def generate():
    return providers.generate_image(
        [SimpleNamespace(object_key="fixture")], "原木", "测试"
    )


@pytest.mark.parametrize(
    "code,status",
    [
        ("AllocationQuota.FreeTierOnly", 403),
        ("Throttling.RateQuota", 429),
        ("Throttling.AllocationQuota", 429),
    ],
)
def test_explicit_rejection_uses_next_model_and_records_actual_model(
    fake_provider, code, status
):
    responses, calls, image = fake_provider
    responses.extend([reject(code, status), success(image)])
    data, meta = generate()
    assert data and [c["json"]["model"] for c in calls] == [PRIMARY, BACKUP]
    assert calls[0]["json"]["input"] == calls[1]["json"]["input"]
    assert meta["model"] == BACKUP and meta["requestedModel"] == PRIMARY
    assert meta["fallbackUsed"] is True and len(meta["modelAttempts"]) == 2
    assert "test-only-never-live" not in str(meta)


def test_success_stops_and_does_not_probe_backups(fake_provider):
    responses, calls, image = fake_provider
    responses.append(success(image))
    _, meta = generate()
    assert len(calls) == 1 and meta["fallbackUsed"] is False


@pytest.mark.parametrize(
    "code,status,expected",
    [
        ("InvalidApiKey", 401, "PROVIDER_AUTH_ERROR"),
        ("Arrearage", 403, "PROVIDER_ACCOUNT_UNAVAILABLE"),
        ("DataInspectionFailed", 400, "PROVIDER_ERROR"),
        ("AccessDenied", 403, "PROVIDER_ERROR"),
        ("ModelNotFound", 404, "PROVIDER_ERROR"),
        ("InternalError", 500, "PROVIDER_ERROR"),
        ("UnknownRateError", 429, "PROVIDER_RATE_LIMITED"),
    ],
)
def test_other_errors_stop_without_fallback(fake_provider, code, status, expected):
    responses, calls, _ = fake_provider
    responses.append(reject(code, status))
    with pytest.raises(DomainError) as exc:
        generate()
    assert exc.value.code == expected and len(calls) == 1
    assert "test-only-never-live" not in str(exc.value.details) + exc.value.message


def test_timeout_does_not_repeat_a_possibly_accepted_call(fake_provider):
    responses, calls, _ = fake_provider
    responses.append(httpx.ReadTimeout("test only"))
    with pytest.raises(DomainError) as exc:
        generate()
    assert exc.value.code == "PROVIDER_REQUEST_UNCERTAIN" and len(calls) == 1


def test_invalid_success_does_not_start_another_generation(fake_provider):
    responses, calls, _ = fake_provider
    responses.append(httpx.Response(200, json={"output": {"choices": []}}))
    with pytest.raises(DomainError) as exc:
        generate()
    assert exc.value.code == "PROVIDER_INVALID_RESPONSE" and len(calls) == 1


def test_download_failure_does_not_pay_for_another_generation(
    fake_provider, monkeypatch
):
    responses, calls, _ = fake_provider
    responses.append(
        httpx.Response(
            200,
            json={
                "output": {
                    "choices": [
                        {
                            "message": {
                                "content": [
                                    {"image": "https://fixture.aliyuncs.com/image.jpg"}
                                ]
                            }
                        }
                    ]
                }
            },
        )
    )
    monkeypatch.setattr(
        providers.socket,
        "getaddrinfo",
        lambda *args: [(None, None, None, None, ("8.8.8.8", 443))],
    )
    with pytest.raises(DomainError) as exc:
        generate()
    assert exc.value.code == "PROVIDER_DOWNLOAD_FAILED" and len(calls) == 1


def test_model_order_is_deduplicated_and_configuration_is_bounded(monkeypatch):
    monkeypatch.setattr(settings, "dashscope_image_model", PRIMARY)
    monkeypatch.setattr(
        settings,
        "dashscope_image_fallback_models",
        f" {BACKUP}, {PRIMARY}, {BACKUP}, {THIRD}",
    )
    assert settings.image_model_chain == [PRIMARY, BACKUP, THIRD]
    monkeypatch.setattr(
        settings,
        "dashscope_image_fallback_models",
        f"{BACKUP},{THIRD},qwen-image-2.0-2026-03-03",
    )
    with pytest.raises(ValueError):
        _ = settings.image_model_chain
    monkeypatch.setattr(settings, "dashscope_image_fallback_models", "qwen-plus")
    with pytest.raises(ValueError):
        _ = settings.image_model_chain


@pytest.mark.parametrize(
    "base",
    [
        "https://dashscope.aliyuncs.com",
        "https://dashscope-intl.aliyuncs.com/",
        "https://123.cn-beijing.maas.aliyuncs.com",
        "https://123.ap-southeast-1.maas.aliyuncs.com",
    ],
)
def test_legacy_and_workspace_region_hosts_are_supported(monkeypatch, base):
    monkeypatch.setattr(settings, "dashscope_api_base", base)
    assert providers.provider_base() == base.rstrip("/")


@pytest.mark.parametrize(
    "base",
    [
        "http://dashscope.aliyuncs.com",
        "https://evil.example.com",
        "https://dashscope.aliyuncs.com/api/v1",
        "https://dashscope.aliyuncs.com?key=secret",
        "https://dashscope.aliyuncs.com:notaport",
        "https://user:secret@dashscope.aliyuncs.com",
    ],
)
def test_invalid_hosts_are_rejected_without_printing_credentials(monkeypatch, base):
    monkeypatch.setattr(settings, "dashscope_api_base", base)
    with pytest.raises(DomainError) as exc:
        providers.provider_base()
    assert (
        exc.value.code == "PROVIDER_CONFIG_INVALID"
        and "secret" not in exc.value.message
    )


def test_all_models_exhausted_refunds_application_credits_once(
    signed, confirmed, fake_provider
):
    responses, calls, image = fake_provider
    responses.extend(reject("AllocationQuota.FreeTierOnly") for _ in range(3))
    pid, _ = confirmed
    aid = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("fixture.jpg", image, "image/jpeg")},
    ).json()["id"]
    before = signed.get("/api/credits").json()["available"]
    r = signed.post(
        f"/api/projects/{pid}/jobs",
        json={
            "type": "style",
            "assetIds": [aid],
            "maxCredits": 10,
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 202, r.text
    process_job(r.json()["id"])
    process_job(r.json()["id"])
    job = signed.get("/api/jobs/" + r.json()["id"]).json()
    account = signed.get("/api/credits").json()
    assert (
        job["status"] == "failed" and job["error"]["code"] == "PROVIDER_QUOTA_EXHAUSTED"
    )
    assert job["chargedCredits"] == 0 and account["reserved"] == 0
    assert account["available"] == before and len(calls) == 3


def test_success_after_fallback_charges_application_credits_only_once(
    signed, confirmed, fake_provider
):
    responses, calls, image = fake_provider
    responses.extend([reject("AllocationQuota.FreeTierOnly"), success(image)])
    pid, _ = confirmed
    aid = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("fixture.jpg", image, "image/jpeg")},
    ).json()["id"]
    before = signed.get("/api/credits").json()["available"]
    r = signed.post(
        f"/api/projects/{pid}/jobs",
        json={
            "type": "style",
            "assetIds": [aid],
            "maxCredits": 10,
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 202, r.text
    process_job(r.json()["id"])
    process_job(r.json()["id"])
    job = signed.get("/api/jobs/" + r.json()["id"]).json()
    account = signed.get("/api/credits").json()
    assert job["status"] == "succeeded" and job["chargedCredits"] == 10
    assert account["reserved"] == 0 and account["available"] == before - 10
    assert len(calls) == 2 and job["output"]["assets"][0]["metadata"]["model"] == BACKUP
