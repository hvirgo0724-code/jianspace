import io, uuid, base64
from PIL import Image
from interior.catalog import single_room_scene, budget_for
from interior.ai_context import measured_context, reference_image
from interior.geometry import validate_scene
from interior.layout_quality import assess_layout
from interior.worker import process_job


def test_quantities_unknown_rates_and_rounding():
    s = single_room_scene()
    rid = s["floors"][0]["rooms"][0]["id"]
    s["layout"]["renovation"] = {
        "wastePercent": 5,
        "contingencyPercent": 10,
        "rooms": [
            {
                "roomId": rid,
                "enabled": True,
                "floorMaterialMinor": 10000,
                "floorLaborMinor": 5000,
                "wallMaterialMinor": 0,
                "wallLaborMinor": 0,
                "ceilingMaterialMinor": 0,
                "ceilingLaborMinor": None,
            }
        ],
        "extraLines": [
            {
                "id": "water",
                "title": "水电测试报价",
                "category": "plumbing",
                "quantity": 3,
                "unit": "项",
                "unitPriceMinor": 15000,
            }
        ],
    }
    b = budget_for(s)
    assert b["quantities"][0]["floorAreaM2"] == 20
    assert b["quantities"][0]["wallAreaM2"] == 50.4
    assert b["renovationSubtotalMinor"] == 355000
    assert b["contingencyMinor"] == 35500 and b["estimatedTotalMinor"] == 390500
    assert b["unknownLineCount"] == 1
    import csv
    from interior.exports import export_scene

    raw, media, filename = export_scene(s, "csv")
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    assert media == "text/csv" and "装修" in filename
    assert rows[0][3] == "单位"
    assert rows[-3][5] == "3550.0"
    assert rows[-2][5] == "355.0"
    assert rows[-1][5] == "3905.0"
    assert any(row[3] == "m²" and row[4] == "" and row[5] == "" for row in rows[1:])
    from interior.estimates import money

    assert money(1.005, 101) == 102


def test_estimates_reject_duplicate_room_rates_and_cross_project_access(
    signed, project, client
):
    pid, w = project
    s = w["scene"]
    rid = s["floors"][0]["rooms"][0]["id"]
    s["layout"]["renovation"] = {
        "rooms": [{"roomId": rid, "enabled": True}, {"roomId": rid, "enabled": True}]
    }
    r = signed.post(
        f"/api/projects/{pid}/estimate", json={"scene": s, "baseRevision": 0}
    )
    assert r.status_code == 422
    assert "BUDGET_ROOM" in {i["code"] for i in validate_scene(s)["issues"]}


def test_measured_ai_context_does_not_mutate_scene_and_renders_png():
    s = single_room_scene()
    rid = s["floors"][0]["rooms"][0]["id"]
    context = measured_context(s, rid)
    assert context["widthMm"] == 4000 and context["depthMm"] == 5000
    im = Image.open(io.BytesIO(reference_image(context)))
    assert im.size == (1024, 1024) and im.format == "PNG"
    assert not s["layout"]["furniture"]


def test_geometry_guided_ai_request_contains_plan_and_measurements(
    monkeypatch, tmp_path
):
    from interior.config import settings
    import interior.providers as provider
    from types import SimpleNamespace

    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only")
    raw = io.BytesIO()
    Image.new("RGB", (400, 400), "white").save(raw, "JPEG")
    data = raw.getvalue()
    monkeypatch.setattr(provider, "read", lambda key: data)
    captured = {}

    class Response:
        status_code = 200

        def json(self):
            return {
                "output": {
                    "choices": [
                        {
                            "message": {
                                "content": [
                                    {
                                        "image": "data:image/jpeg;base64,"
                                        + base64.b64encode(data).decode()
                                    }
                                ]
                            }
                        }
                    ]
                },
                "request_id": "test-only",
            }

    class Client:
        def __init__(self, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kw):
            captured.update(kw["json"])
            return Response()

    monkeypatch.setattr(provider.httpx, "Client", Client)
    s = single_room_scene()
    context = measured_context(s, s["floors"][0]["rooms"][0]["id"])
    result, meta = provider.generate_image(
        [SimpleNamespace(object_key="test")], "原木", "测试", geometry=context
    )
    content = captured["input"]["messages"][0]["content"]
    assert len([c for c in content if "image" in c]) == 2
    assert "4000" in content[-1]["text"] and "5000" in content[-1]["text"]
    assert captured["parameters"]["prompt_extend"] is False
    assert result and meta["provider"] == "dashscope"


def test_guided_job_and_review_are_recorded_without_live_provider(
    signed, confirmed, monkeypatch
):
    from interior.config import settings
    import interior.providers as provider

    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-only")
    pid, w = confirmed
    rid = w["scene"]["floors"][0]["rooms"][0]["id"]
    raw = io.BytesIO()
    Image.new("RGB", (400, 400), "white").save(raw, "JPEG")
    photo = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("test.jpg", raw.getvalue(), "image/jpeg")},
        data={"roomId": rid},
    ).json()
    seen = {}

    def fake(assets, style, instruction, geometry=None):
        seen.update(geometry)
        return raw.getvalue(), {"testFixture": True}

    monkeypatch.setattr(provider, "generate_image", fake)
    response = signed.post(
        f"/api/projects/{pid}/jobs",
        json={
            "type": "style",
            "assetIds": [photo["id"]],
            "roomIds": [rid],
            "parameters": {"geometryGuide": True},
            "maxCredits": 10,
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert response.status_code == 202, response.text
    process_job(response.json()["id"])
    job = signed.get("/api/jobs/" + response.json()["id"]).json()
    assert job["status"] == "succeeded", job
    asset = job["output"]["assets"][0]
    assert seen["roomId"] == rid
    assert asset["metadata"]["review"]["status"] == "pending"
    checks = {
        k: "consistent"
        for k in ("walls", "doors", "windows", "furniture", "proportions")
    }
    checks["proportions"] = "uncertain"
    review = signed.patch(
        "/api/assets/" + asset["id"] + "/review",
        json={"checks": checks, "notes": "自动测试夹具，不代表实调用"},
    ).json()
    assert review["metadata"]["review"]["status"] == "pending"
    checks["windows"] = "different"
    review = signed.patch(
        "/api/assets/" + asset["id"] + "/review",
        json={"checks": checks, "notes": "窗位有差异"},
    ).json()
    assert review["metadata"]["review"]["status"] == "needs_revision"
    assert signed.get("/api/assets/" + asset["id"] + "/reference").status_code == 200


def test_household_needs_are_assessed_as_explainable_advice():
    s = single_room_scene()
    s["layout"]["preferences"] = {
        "occupants": 3,
        "elderly": True,
        "children": True,
        "storagePriority": True,
        "passageMm": 900,
    }
    result = assess_layout(s)
    assert any(i["code"] == "SLEEPING_CAPACITY" for i in result["issues"])
    assert any("900" in reason for reason in result["reasons"])
    assert any("儿童" in reason for reason in result["reasons"])


def test_door_approach_checks_clearance_even_when_there_is_no_swing_leaf():
    s = single_room_scene()
    f = s["floors"][0]
    rid = f["rooms"][0]["id"]
    f["openings"] = [
        dict(
            id="entry",
            kind="door",
            wallId="wall-1",
            offsetMm=500,
            widthMm=1000,
            bottomMm=0,
            heightMm=2100,
            connects=[rid, None],
        )
    ]
    s["layout"]["catalogSnapshot"] = [
        dict(
            skuId="test",
            name="测试柜",
            sizeMm=[600, 600, 800],
            priceMinor=None,
            currency="CNY",
            sourceType="user_input",
            quotedAt="2026-10-23T00:00:00Z",
            modelAssetId="builtin-cabinet",
            productUrl=None,
        )
    ]
    s["layout"]["furniture"] = [
        dict(
            id="box",
            floorId=f["id"],
            roomId=rid,
            skuId="test",
            positionMm=[900, 350, 0],
            sizeMm=[600, 600, 800],
            rotationDeg=0,
            locked=False,
        )
    ]
    assert validate_scene(s)["valid"]
    assert any(i["code"] == "DOOR_APPROACH" for i in assess_layout(s)["issues"])
    s["layout"]["furniture"][0]["positionMm"] = [2500, 3000, 0]
    assert not any(i["code"] == "DOOR_APPROACH" for i in assess_layout(s)["issues"])


def test_family_layout_job_preserves_confirmed_geometry_and_explains_results(
    signed, confirmed
):
    from interior.geometry import structure_hash

    pid, w = confirmed
    s = w["scene"]
    before = structure_hash(s)
    s["layout"]["preferences"] = {
        "occupants": 3,
        "children": True,
        "elderly": True,
        "storagePriority": True,
        "passageMm": 900,
        "budgetMinor": 100,
    }
    saved = signed.put(
        f"/api/projects/{pid}/working-copy",
        json={"scene": s, "baseRevision": w["revision"], "baseDesignId": None},
    )
    assert saved.status_code == 200, saved.text
    response = signed.post(
        f"/api/projects/{pid}/jobs",
        json={"type": "layout"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert response.status_code == 202, response.text
    process_job(response.json()["id"])
    job = signed.get("/api/jobs/" + response.json()["id"]).json()
    assert job["status"] == "succeeded", job
    designs = signed.get(f"/api/projects/{pid}/designs").json()["items"]
    generated = next(d for d in designs if d["id"] in job["output"]["designIds"])[
        "scene"
    ]
    assert structure_hash(generated) == before
    assert (
        generated["layout"]["analysis"]["reasons"]
        and generated["layout"]["analysis"]["warnings"]
    )
