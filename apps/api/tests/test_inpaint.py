"""Masked local editing: validation, credit reservation and deterministic compositing."""

import base64
import io
import uuid

import pytest
from PIL import Image, ImageDraw

from interior import providers
from interior.config import settings
from interior.worker import process_job


@pytest.fixture
def ai(monkeypatch):
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only-never-live")
    monkeypatch.setattr(settings, "dashscope_image_model", "qwen-image-2.0-pro")
    monkeypatch.setattr(settings, "dashscope_image_fallback_models", "")
    monkeypatch.setattr(settings, "ai_inpaint_credits", 3)


def mask_url(size, rect=None, white=False):
    im = Image.new("L", size, 255 if white else 0)
    if rect:
        ImageDraw.Draw(im).rectangle(rect, fill=255)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def upload_photo(client, pid, size=(120, 80)):
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, "JPEG")
    r = client.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("room.jpg", buf.getvalue(), "image/jpeg")},
    )
    assert r.status_code == 201, r.text
    return r.json()


def submit(client, pid, payload):
    return client.post(
        f"/api/projects/{pid}/jobs",
        json={"type": "inpaint", "maxCredits": 3, **payload},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )


def test_inpaint_rejects_incomplete_or_dangerous_masks(ai, signed, confirmed):
    pid, _ = confirmed
    photo = upload_photo(signed, pid)
    before = signed.get("/api/credits").json()["available"]

    def code(response):
        return response.json()["error"]["code"]

    assert code(submit(signed, pid, {"assetIds": [photo["id"]], "instruction": "换沙发"})) == (
        "MASK_REQUIRED"
    )
    assert (
        code(
            submit(
                signed,
                pid,
                {"assetIds": [photo["id"]], "instruction": "  ", "maskDataUrl": mask_url((120, 80), (10, 10, 40, 30))},
            )
        )
        == "INPAINT_INSTRUCTION_REQUIRED"
    )
    assert (
        code(
            submit(
                signed,
                pid,
                {"assetIds": [photo["id"]], "instruction": "换沙发", "maskDataUrl": mask_url((60, 40), (10, 10, 20, 20))},
            )
        )
        == "MASK_DIMENSIONS"
    )
    assert (
        code(
            submit(
                signed,
                pid,
                {"assetIds": [photo["id"]], "instruction": "换沙发", "maskDataUrl": mask_url((120, 80), (0, 0, 0, 0))},
            )
        )
        == "MASK_TOO_SMALL"
    )
    assert (
        code(
            submit(
                signed,
                pid,
                {"assetIds": [photo["id"]], "instruction": "换沙发", "maskDataUrl": mask_url((120, 80), white=True)},
            )
        )
        == "MASK_TOO_LARGE"
    )
    assert (
        code(
            submit(
                signed,
                pid,
                {"assetIds": [photo["id"]], "instruction": "换沙发", "maskDataUrl": mask_url((120, 80), (10, 10, 40, 30)), "maxCredits": 0},
            )
        )
        == "CREDIT_CONFIRMATION_REQUIRED"
    )
    assert signed.get("/api/credits").json()["available"] == before


def test_inpaint_requires_photo_or_render_source(ai, signed, confirmed):
    pid, _ = confirmed
    buf = io.BytesIO()
    Image.new("RGB", (120, 80), "white").save(buf, "PNG")
    plan = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("plan.png", buf.getvalue(), "image/png")},
        data={"kind": "floorplan"},
    ).json()
    response = submit(
        signed,
        pid,
        {
            "assetIds": [plan["id"]],
            "instruction": "换沙发",
            "maskDataUrl": mask_url((120, 80), (10, 10, 40, 30)),
        },
    )
    assert response.json()["error"]["code"] == "INVALID_INPAINT_SOURCE"
    photo = upload_photo(signed, pid)
    response = submit(
        signed,
        pid,
        {
            "type": "style",
            "assetIds": [photo["id"]],
            "maskDataUrl": mask_url((120, 80), (10, 10, 40, 30)),
        },
    )
    assert response.json()["error"]["code"] == "MASK_NOT_APPLICABLE"


def test_inpaint_composites_provider_result_inside_mask_only(
    ai, signed, confirmed, monkeypatch
):
    pid, _ = confirmed
    photo = upload_photo(signed, pid)
    mask_png = mask_url((120, 80), (10, 10, 40, 30))
    calls = {}

    def fake_edit(source, mask, instruction):
        calls["source"], calls["mask"], calls["instruction"] = source, mask, instruction
        buf = io.BytesIO()
        Image.new("RGB", (240, 160), (200, 30, 30)).save(buf, "PNG")
        return buf.getvalue(), {
            "provider": "dashscope",
            "model": "qwen-image-2.0-pro",
            "requestedModel": "qwen-image-2.0-pro",
            "requestId": "fixture-inpaint",
        }

    monkeypatch.setattr(providers, "edit_image_masked", fake_edit)
    before = signed.get("/api/credits").json()["available"]
    response = submit(
        signed,
        pid,
        {
            "assetIds": [photo["id"]],
            "instruction": "把窗边的沙发换成布艺",
            "maskDataUrl": mask_png,
        },
    )
    assert response.status_code == 202, response.text
    process_job(response.json()["id"])
    job = signed.get("/api/jobs/" + response.json()["id"]).json()
    assert job["status"] == "succeeded", job
    assert job["chargedCredits"] == 3
    assert signed.get("/api/credits").json()["available"] == before - 3
    assert job["output"]["mask"]["outsideChangedPixels"] == 0
    assert job["output"]["mask"]["policy"] == "mask-outside-source-pixels"
    assert calls["instruction"] == "把窗边的沙发换成布艺"
    assert Image.open(io.BytesIO(calls["mask"])).convert("L").getpixel((20, 20)) == 255
    assert Image.open(io.BytesIO(calls["source"])).size == (120, 80)

    asset = job["output"]["assets"][0]
    assert asset["kind"] == "generated" and asset["mediaType"] == "image/png"
    stored = Image.open(io.BytesIO(signed.get(asset["url"]).content)).convert("RGB")
    assert stored.size == (120, 80)
    assert stored.getpixel((20, 20)) == (200, 30, 30)
    assert stored.getpixel((100, 70)) == (255, 255, 255)
    assert asset["metadata"]["maskAssetId"]
    assert asset["metadata"]["sourceAssetId"] == photo["id"]
    assert asset["metadata"]["maskCoverage"] == pytest.approx(651 / 9600, abs=1e-5)
    # The mask is stored privately and hidden from viewers like source photos.
    kinds = [a["kind"] for a in signed.get(f"/api/projects/{pid}/assets").json()["items"]]
    assert "mask" in kinds


def test_inpaint_capability_and_pricing_are_advertised(ai, signed):
    caps = signed.get("/api/capabilities").json()
    assert caps["aiInpaint"] is True and caps["aiInpaintCredits"] == 3
    assert signed.get("/api/plans").json()["costs"]["inpaint"] == 3
