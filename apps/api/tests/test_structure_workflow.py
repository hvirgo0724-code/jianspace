"""Normal API structure workflow tests; no live generation or credentials."""

import base64
import copy
import io
import uuid

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from interior.ai_context import (
    constrained_instruction,
    measured_context,
    PROMPT_BYTE_BUDGET,
)
from interior.config import settings
from interior.database import session_scope
from interior.main import app
from interior.models import Project
from interior.security import DomainError
from interior.storage import save_asset


@pytest.fixture
def single_project(signed):
    r = signed.post(
        "/api/projects", json={"name": "结构流程测试", "templateId": "single-room"}
    )
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    return pid, signed.get(f"/api/projects/{pid}/working-copy").json()


@pytest.fixture
def jpeg():
    raw = io.BytesIO()
    Image.new("RGB", (400, 400), "white").save(raw, "JPEG")
    return raw.getvalue()


def freeze(signed, pid, w, basis="demo"):
    created = signed.post(
        f"/api/projects/{pid}/geometry-versions",
        json={"scene": w["scene"], "baseRevision": w["revision"]},
    )
    assert created.status_code == 201, created.text
    g = created.json()
    body = {
        "expectedStructureHash": g["structureHash"],
        "basis": basis,
        "confirmDemoDimensions": basis == "demo",
        "confirmMeasuredDimensions": basis == "user_measured",
    }
    r = signed.post(
        f"/api/projects/{pid}/geometry-versions/{g['id']}/confirm", json=body
    )
    assert r.status_code == 200, r.text
    return r.json(), signed.get(f"/api/projects/{pid}/working-copy").json()


def capture_body(w, jpeg):
    room = w["scene"]["floors"][0]["rooms"][0]
    return {
        "scene": copy.deepcopy(w["scene"]),
        "baseRevision": w["revision"],
        "roomId": room["id"],
        "imageDataUrl": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(),
        "camera": {
            "positionMm": [2000, 2500, 1600],
            "targetMm": [2000, 4000, 1600],
            "fovDeg": 60,
            "aspectRatio": 1.5,
        },
    }


def capture(signed, pid, w, jpeg):
    r = signed.post(f"/api/projects/{pid}/scene-references", json=capture_body(w, jpeg))
    assert r.status_code == 201, r.text
    return r.json()


def enable_fake_provider(monkeypatch):
    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "workflow-fixture-no-real-key")
    monkeypatch.setattr(settings, "ai_structure_review_enabled", False)


def job_request(w, aid, instruction=""):
    return {
        "type": "style",
        "assetIds": [aid],
        "roomIds": [w["scene"]["floors"][0]["rooms"][0]["id"]],
        "parameters": {"geometryGuide": True},
        "maxCredits": 10,
        "instruction": instruction,
    }


@pytest.mark.parametrize("basis", ["demo", "user_measured"])
def test_confirmation_basis_is_frozen_and_exposed_in_project_cards(
    signed, single_project, basis
):
    pid, w = single_project
    g, w = freeze(signed, pid, w, basis)
    assert g["status"] == "confirmed" and g["scene"]["confirmation"]["basis"] == basis
    assert w["scene"]["confirmation"]["basis"] == basis
    row = next(p for p in signed.get("/api/projects").json()["items"] if p["id"] == pid)
    assert row["confirmationBasis"] == basis and row["geometryStatus"] == "confirmed"
    opposite = "demo" if basis == "user_measured" else "user_measured"
    r = signed.post(
        f"/api/projects/{pid}/geometry-versions/{g['id']}/confirm",
        json={
            "expectedStructureHash": g["structureHash"],
            "basis": opposite,
            "confirmDemoDimensions": opposite == "demo",
            "confirmMeasuredDimensions": opposite == "user_measured",
        },
    )
    assert (
        r.status_code == 409
        and r.json()["error"]["code"] == "CONFIRMATION_BASIS_CONFLICT"
    )
    # A client cannot turn a demo into real measurements by editing working JSON.
    scene = copy.deepcopy(w["scene"])
    scene["confirmation"]["basis"] = opposite
    saved = signed.put(
        f"/api/projects/{pid}/working-copy",
        json={"scene": scene, "baseRevision": w["revision"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["scene"]["confirmation"]["basis"] == basis
    original = signed.get(f"/api/projects/{pid}/geometry-versions/{g['id']}").json()
    assert original["scene"]["confirmation"]["basis"] == basis


@pytest.mark.parametrize(
    "ack",
    [
        {"basis": "demo"},
        {"basis": "demo", "confirmMeasuredDimensions": True},
        {
            "basis": "demo",
            "confirmDemoDimensions": True,
            "confirmMeasuredDimensions": True,
        },
        {"basis": "user_measured"},
        {"basis": "user_measured", "confirmDemoDimensions": True},
        {"basis": "untrusted", "confirmDemoDimensions": True},
    ],
)
def test_confirmation_requires_matching_explicit_acknowledgement(
    signed, single_project, ack
):
    pid, w = single_project
    g = signed.post(
        f"/api/projects/{pid}/geometry-versions",
        json={"scene": w["scene"], "baseRevision": w["revision"]},
    ).json()
    r = signed.post(
        f"/api/projects/{pid}/geometry-versions/{g['id']}/confirm",
        json={"expectedStructureHash": g["structureHash"], **ack},
    )
    assert r.status_code == 422
    assert (
        signed.get(f"/api/projects/{pid}/geometry-versions/{g['id']}").json()["status"]
        == "draft"
    )


def test_scene_capture_is_labelled_and_matches_current_geometry_and_camera(
    signed, single_project, jpeg
):
    pid, w = single_project
    _, w = freeze(signed, pid, w)
    a = capture(signed, pid, w, jpeg)
    ref = a["metadata"]["sceneReference"]
    context = measured_context(w["scene"], a["roomId"])
    assert a["kind"] == "photo" and "非实拍" in a["name"]
    assert a["metadata"]["referenceType"] == "scene_capture"
    assert ref["confirmationBasis"] == "demo"
    assert (
        ref["structureHash"] == context["structureHash"]
        and ref["layoutHash"] == context["layoutHash"]
    )
    assert ref["camera"]["positionMm"] == [2000, 2500, 1600]
    assert signed.get(a["url"]).status_code == 200


def test_scene_capture_requires_editor_access(signed, single_project, jpeg):
    pid, w = single_project
    body = capture_body(w, jpeg)
    with TestClient(app) as viewer:
        user = viewer.post("/api/auth/demo", json={}).json()
        viewer.headers["X-CSRF-Token"] = user["csrfToken"]
        assert (
            viewer.post(f"/api/projects/{pid}/scene-references", json=body).status_code
            == 403
        )
        joined = signed.post(
            f"/api/projects/{pid}/members",
            json={"email": user["user"]["email"], "role": "viewer"},
        )
        assert joined.status_code == 201, joined.text
        assert (
            viewer.post(f"/api/projects/{pid}/scene-references", json=body).status_code
            == 403
        )


@pytest.mark.parametrize(
    "case,code",
    [
        ("revision", "REVISION_CONFLICT"),
        ("geometry", "REFERENCE_SCENE_CHANGED"),
        ("outside", "REFERENCE_CAMERA_OUTSIDE"),
        ("below", "REFERENCE_CAMERA_OUTSIDE"),
        ("above", "REFERENCE_CAMERA_OUTSIDE"),
        ("prefix", "INVALID_REFERENCE_IMAGE"),
        ("encoding", "INVALID_REFERENCE_IMAGE"),
        ("image", "INVALID_IMAGE"),
        ("room", "ROOM_MISSING"),
    ],
)
def test_scene_capture_rejects_stale_or_invalid_input(
    signed, single_project, jpeg, case, code
):
    pid, w = single_project
    body = capture_body(w, jpeg)
    if case == "revision":
        body["baseRevision"] += 1
    elif case == "geometry":
        body["scene"]["floors"][0]["walls"][0]["heightMm"] += 10
    elif case == "outside":
        body["camera"]["positionMm"][0] = 100000
    elif case == "below":
        body["camera"]["positionMm"][2] = 49
    elif case == "above":
        body["camera"]["positionMm"][2] = 2801
    elif case == "prefix":
        body["imageDataUrl"] = body["imageDataUrl"].replace("image/jpeg", "image/png")
    elif case == "encoding":
        body["imageDataUrl"] = "data:image/jpeg;base64," + "!" * 40
    elif case == "image":
        body["imageDataUrl"] = (
            "data:image/jpeg;base64,"
            + base64.b64encode(b"not a real image file").decode()
        )
    elif case == "room":
        body["roomId"] = "missing-room"
    r = signed.post(f"/api/projects/{pid}/scene-references", json=body)
    assert r.status_code in (409, 422), r.text
    assert r.json()["error"]["code"] == code, r.text
    assert not signed.get(f"/api/projects/{pid}/assets").json()["items"]


@pytest.mark.parametrize("change", ["geometry", "furniture"])
def test_stale_scene_capture_is_rejected_before_reserving_credits(
    signed, single_project, jpeg, monkeypatch, change
):
    enable_fake_provider(monkeypatch)
    pid, w = single_project
    _, w = freeze(signed, pid, w)
    a = capture(signed, pid, w, jpeg)
    changed = copy.deepcopy(w["scene"])
    if change == "geometry":
        changed["floors"][0]["rooms"][0]["heightMm"] -= 100
    else:
        floor = changed["floors"][0]
        rid = floor["rooms"][0]["id"]
        changed["layout"]["catalogSnapshot"].append(
            {
                "skuId": "fixture-cabinet",
                "name": "测试柜",
                "sizeMm": [600, 600, 800],
                "priceMinor": None,
                "currency": "CNY",
                "sourceType": "user_input",
                "quotedAt": "2026-10-23T00:00:00Z",
                "modelAssetId": "builtin-cabinet",
                "productUrl": None,
            }
        )
        changed["layout"]["furniture"].append(
            {
                "id": "fixture-furniture",
                "floorId": floor["id"],
                "roomId": rid,
                "skuId": "fixture-cabinet",
                "positionMm": [1000, 1000, 0],
                "sizeMm": [600, 600, 800],
                "rotationDeg": 0,
                "locked": False,
            }
        )
    saved = signed.put(
        f"/api/projects/{pid}/working-copy",
        json={"scene": changed, "baseRevision": w["revision"]},
    )
    assert saved.status_code == 200, saved.text
    w = saved.json()
    if change == "geometry":
        _, w = freeze(signed, pid, w)
    before = signed.get("/api/credits").json()
    r = signed.post(
        f"/api/projects/{pid}/jobs",
        json=job_request(w, a["id"]),
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert (
        r.status_code == 422 and r.json()["error"]["code"] == "STALE_SCENE_REFERENCE"
    ), r.text
    after = signed.get("/api/credits").json()
    assert (
        after["available"] == before["available"]
        and after["reserved"] == before["reserved"] == 0
    )
    assert not signed.get(f"/api/projects/{pid}/jobs").json()["items"]


def test_prompt_budget_does_not_grow_with_complex_room_geometry(single_project):
    _, w = single_project
    c = measured_context(w["scene"], w["scene"]["floors"][0]["rooms"][0]["id"])
    c["boundaryMm"] = [[i, i * 2] for i in range(200)]
    c["openings"] = [{"kind": "door"}] * 1000 + [{"kind": "window"}] * 1000
    c["walls"] = [{"id": str(i), "unused": "x" * 1000} for i in range(2000)]
    c["camera"] = {
        "positionMm": [2000, 2500, 1600],
        "targetMm": [2000, 4000, 1600],
        "fovDeg": 60,
        "aspectRatio": 1.5,
    }
    base = constrained_instruction(c, "原木自然", "")
    assert len(base.encode("utf-8")) <= PROMPT_BYTE_BUDGET == 1200
    assert '"doors":1000' in base and '"windows":1000' in base
    available = PROMPT_BYTE_BUDGET - len(base.encode("utf-8"))
    assert (
        len(constrained_instruction(c, "原木自然", "x" * available).encode("utf-8"))
        == 1200
    )
    with pytest.raises(DomainError) as exc:
        constrained_instruction(c, "原木自然", "x" * (available + 1))
    assert exc.value.code == "AI_PROMPT_TOO_LONG"


def test_long_instruction_is_rejected_before_credit_reservation(
    signed, single_project, jpeg, monkeypatch
):
    enable_fake_provider(monkeypatch)
    pid, w = single_project
    _, w = freeze(signed, pid, w)
    a = capture(signed, pid, w, jpeg)
    before = signed.get("/api/credits").json()
    r = signed.post(
        f"/api/projects/{pid}/jobs",
        json=job_request(w, a["id"], "保持墙面" * 400),
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "AI_PROMPT_TOO_LONG", (
        r.text
    )
    after = signed.get("/api/credits").json()
    assert (
        after["available"] == before["available"]
        and after["reserved"] == before["reserved"] == 0
    )
    assert not signed.get(f"/api/projects/{pid}/jobs").json()["items"]


def test_explicit_automatic_structure_risk_cannot_be_erased_by_manual_consistent_flags(
    signed, single_project, jpeg
):
    pid, w = single_project
    rid = w["scene"]["floors"][0]["rooms"][0]["id"]
    context = measured_context(w["scene"], rid)
    with session_scope() as db:
        p = db.get(Project, pid)
        a = save_asset(
            db,
            pid,
            p.owner_id,
            jpeg,
            "自动差异测试.jpg",
            "generated",
            "image/jpeg",
            {
                "geometryReference": context,
                "structuralAudit": {
                    "status": "completed",
                    "risk": "high",
                    "decision": "needs_revision",
                    "manualReviewRequired": True,
                },
            },
            rid,
        )
        aid = a.id
    r = signed.patch(
        f"/api/assets/{aid}/review",
        json={
            "checks": {
                k: "consistent"
                for k in ("walls", "doors", "windows", "furniture", "proportions")
            },
            "notes": "模拟一致，不应抹除自动发现的明确结构风险。",
        },
    )
    assert r.status_code == 200, r.text
    review = r.json()["metadata"]["review"]
    assert review["status"] == "needs_revision" and review["automatedRisk"] == "high"
    assert review["contextChanged"] is False
