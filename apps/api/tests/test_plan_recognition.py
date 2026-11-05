import copy
import io
import json
import uuid
import httpx
import pytest
from PIL import Image
from interior import plan_recognition, worker
from interior.catalog import single_room_scene
from interior.config import settings
from interior.geometry import validate_scene
from interior.security import DomainError


def payload():
    return {
        "isFloorPlan": True,
        "rooms": [
            {
                "key": "living",
                "name": "客厅",
                "type": "living",
                "x0": 100,
                "y0": 100,
                "x1": 500,
                "y1": 900,
            },
            {
                "key": "bed",
                "name": "卧室",
                "type": "bedroom",
                "x0": 500,
                "y0": 100,
                "x1": 900,
                "y1": 900,
            },
        ],
        "openings": [
            {
                "kind": "door",
                "x": 500,
                "y": 450,
                "width": 100,
                "roomKeys": ["living", "bed"],
            }
        ],
        "warnings": ["测试夹具，不是实际识别。"],
    }


def test_build_plan_is_valid_scaled_unconfirmed_and_preserves_original():
    original = single_room_scene()
    saved = copy.deepcopy(original)
    result = plan_recognition.build_plan_scene(
        payload(), original, "source-plan", 8000, 2800
    )
    assert original == saved
    assert validate_scene(result["scene"])["valid"]
    assert result["scene"]["confirmation"]["status"] == "draft"
    assert result["scene"]["floors"][0]["rooms"][0]["boundaryMm"][1][0] == 3900
    walls = result["scene"]["floors"][0]["walls"]
    assert (
        min(
            p[0] - w["thicknessMm"] / 2
            for w in walls
            for p in (w["startMm"], w["endMm"])
        )
        == 0
    )
    assert (
        max(
            p[0] + w["thicknessMm"] / 2
            for w in walls
            for p in (w["startMm"], w["endMm"])
        )
        == 8000
    )
    assert result["scene"]["layout"]["planSource"]["unverifiedDimensions"] is True
    assert len(result["scene"]["floors"][0]["openings"]) == 1


@pytest.mark.parametrize(
    "mutation",
    [
        lambda p: p.update(isFloorPlan=False),
        lambda p: p["rooms"][1].update(key="living"),
        lambda p: p["rooms"][1].update(x0=200),
        lambda p: p["rooms"][0].update(x1=101),
        lambda p: p["rooms"][0].update(x0=-20),
    ],
)
def test_invalid_or_overlapping_plan_never_becomes_a_scene(mutation):
    data = payload()
    mutation(data)
    with pytest.raises(DomainError):
        plan_recognition.build_plan_scene(
            data, single_room_scene(), "source-plan", 8000, 2800
        )


def test_unmatched_opening_is_not_invented():
    data = payload()
    data["openings"][0]["roomKeys"] = ["unknown"]
    result = plan_recognition.build_plan_scene(
        data, single_room_scene(), "source-plan", 8000, 2800
    )
    assert not result["scene"]["floors"][0]["openings"]
    assert any("省略" in w for w in result["warnings"])


def test_non_square_image_keeps_its_physical_aspect_ratio():
    result = plan_recognition.build_plan_scene(
        payload(), single_room_scene(), "source-plan", 8000, 2800, image_aspect=0.5
    )
    room = result["scene"]["floors"][0]["rooms"][0]
    assert (
        max(p[1] for p in room["boundaryMm"]) - min(p[1] for p in room["boundaryMm"])
        == 3700
    )


@pytest.fixture
def plan_job(signed, project, monkeypatch):
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "fixture-not-live")
    pid, w = project
    buf = io.BytesIO()
    Image.new("RGB", (800, 600), "white").save(buf, "PNG")
    source = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("demo-plan.png", buf.getvalue(), "image/png")},
        data={"kind": "floorplan"},
    )
    assert source.status_code == 201
    aid = source.json()["id"]
    body = {
        "type": "recognize",
        "assetIds": [aid],
        "parameters": {"planWidthMm": 8000, "heightMm": 2800},
        "maxCredits": 5,
    }
    return pid, w, aid, body


def test_normal_recognition_job_settles_once_and_does_not_replace_project(
    signed, plan_job, monkeypatch
):
    pid, w, aid, body = plan_job
    calls = []

    def fake(raw, original, asset_id, params):
        calls.append(True)
        return json.dumps(
            plan_recognition.build_plan_scene(payload(), original, asset_id, 8000, 2800)
        ).encode(), {
            "model": "qwen3-vl-plus",
            "sourceAssetId": asset_id,
            "testFixture": True,
        }

    monkeypatch.setattr(plan_recognition, "recognize_plan", fake)
    before = signed.get("/api/credits").json()["available"]
    key = str(uuid.uuid4())
    response = signed.post(
        f"/api/projects/{pid}/jobs", json=body, headers={"Idempotency-Key": key}
    )
    assert response.status_code == 202, response.text
    job = response.json()
    worker.process_job(job["id"])
    worker.process_job(job["id"])
    finished = signed.get("/api/jobs/" + job["id"]).json()
    assert finished["status"] == "succeeded"
    assert finished["chargedCredits"] == 5
    assert len(calls) == 1
    assert signed.get(f"/api/projects/{pid}/working-copy").json()["scene"] == w["scene"]
    account = signed.get("/api/credits").json()
    assert account["available"] == before - 5 and account["reserved"] == 0
    draft = signed.get(finished["output"]["assets"][0]["url"]).json()
    assert draft["scene"]["confirmation"]["status"] == "draft"
    saved = signed.put(
        f"/api/projects/{pid}/working-copy",
        json={"scene": draft["scene"], "baseRevision": w["revision"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["scene"]["confirmation"]["status"] == "draft"


def test_scale_and_wrong_source_are_rejected_before_reservation(signed, plan_job):
    pid, w, aid, body = plan_job
    before = signed.get("/api/credits").json()
    body["parameters"]["planWidthMm"] = True
    rejected = signed.post(
        f"/api/projects/{pid}/jobs",
        json=body,
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert (
        rejected.status_code == 422
        and rejected.json()["error"]["code"] == "PLAN_SCALE_REQUIRED"
    )
    after = signed.get("/api/credits").json()
    assert after["available"] == before["available"] and after["reserved"] == 0
    body["parameters"]["planWidthMm"] = 8000
    buf = io.BytesIO()
    Image.new("RGB", (30, 30)).save(buf, "JPEG")
    photo = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("not-plan.jpg", buf.getvalue(), "image/jpeg")},
    ).json()
    body["assetIds"] = [photo["id"]]
    wrong = signed.post(
        f"/api/projects/{pid}/jobs",
        json=body,
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert (
        wrong.status_code == 422
        and wrong.json()["error"]["code"] == "PLAN_IMAGE_REQUIRED"
    )
    assert signed.get("/api/credits").json()["reserved"] == 0


def test_recognition_timeout_releases_and_keeps_provider_uncertainty(
    signed, plan_job, monkeypatch
):
    pid, w, aid, body = plan_job

    def fail(*args, **kwargs):
        raise DomainError("PLAN_PROVIDER_TIMEOUT", "fixture timeout", 502)

    monkeypatch.setattr(plan_recognition, "recognize_plan", fail)
    before = signed.get("/api/credits").json()["available"]
    created = signed.post(
        f"/api/projects/{pid}/jobs",
        json=body,
        headers={"Idempotency-Key": str(uuid.uuid4())},
    ).json()
    worker.process_job(created["id"])
    finished = signed.get("/api/jobs/" + created["id"]).json()
    assert finished["status"] == "failed" and finished["creditState"] == "released"
    assert finished["providerBillingUncertain"] is True
    assert signed.get("/api/credits").json()["available"] == before


def test_non_photo_upload_kinds_are_closed(signed, project):
    pid, _ = project
    buf = io.BytesIO()
    Image.new("RGB", (20, 20)).save(buf, "JPEG")
    response = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("fixture.jpg", buf.getvalue(), "image/jpeg")},
        data={"kind": "generated"},
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "mode", ["success", "invalid", "truncated", "timeout", "rejected"]
)
def test_vision_protocol_is_one_bounded_request_without_retries(monkeypatch, mode):
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "fixture-not-live")
    calls = []
    client_class = httpx.Client

    def handler(request):
        calls.append(json.loads(request.content))
        if mode == "timeout":
            raise httpx.ReadTimeout("fixture", request=request)
        if mode == "rejected":
            return httpx.Response(403, json={"message": "untrusted provider details"})
        return httpx.Response(
            200,
            json={
                "id": "fixture-request",
                "choices": [
                    {
                        "finish_reason": "length" if mode == "truncated" else "stop",
                        "message": {
                            "content": "not JSON"
                            if mode == "invalid"
                            else json.dumps(payload())
                        },
                    }
                ],
                "usage": {"prompt_tokens": 10, "total_tokens": 100},
            },
        )

    monkeypatch.setattr(
        plan_recognition.httpx,
        "Client",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs),
    )
    buf = io.BytesIO()
    Image.new("RGB", (80, 80)).save(buf, "JPEG")
    if mode == "success":
        raw, meta = plan_recognition.recognize_plan(
            buf.getvalue(), single_room_scene(), "source-plan", {"planWidthMm": 8000}
        )
        assert json.loads(raw)["requiresMeasurementConfirmation"] is True
        assert meta["model"] == "qwen3-vl-plus"
    else:
        with pytest.raises(DomainError) as error:
            plan_recognition.recognize_plan(
                buf.getvalue(),
                single_room_scene(),
                "source-plan",
                {"planWidthMm": 8000},
            )
        assert "untrusted" not in error.value.message
    assert len(calls) == 1
    assert (
        calls[0]["response_format"] == {"type": "json_object"}
        and calls[0]["enable_thinking"] is False
    )
