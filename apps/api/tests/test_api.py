import io, uuid
from PIL import Image
from fastapi.testclient import TestClient
from interior.main import app
from interior.worker import process_job
from interior.geometry import content_hash
from interior.exports import export_scene


def save_design(c, pid, w):
    r = c.post(
        f"/api/projects/{pid}/designs",
        json={
            "title": "原木方案",
            "geometryVersionId": w["scene"]["geometryVersionId"],
            "scene": w["scene"],
            "baseRevision": w["revision"],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_auth_csrf_and_project_access(client):
    assert client.get("/api/projects").status_code == 401
    token = client.post("/api/auth/demo", json={}).json()["csrfToken"]
    assert client.post("/api/projects", json={"name": "家"}).status_code == 403
    client.headers["X-CSRF-Token"] = token
    assert (
        client.post(
            "/api/projects",
            json={"name": "家"},
            headers={"Origin": "https://evil.invalid"},
        ).status_code
        == 403
    )
    p = client.post("/api/projects", json={"name": "家"}).json()
    with TestClient(app) as stranger:
        data = stranger.post("/api/auth/demo", json={}).json()
        stranger.headers["X-CSRF-Token"] = data["csrfToken"]
        assert stranger.get("/api/projects/" + p["id"]).status_code == 403


def test_optimistic_revision_and_confirmation_invalidation(signed, confirmed):
    pid, w = confirmed
    url = f"/api/projects/{pid}/working-copy"
    body = {"scene": w["scene"], "baseRevision": w["revision"]}
    assert signed.put(url, json=body).status_code == 200
    assert signed.put(url, json=body).status_code == 409
    w = signed.get(url).json()
    w["scene"]["floors"][0]["walls"][0]["heightMm"] += 1
    r = signed.put(url, json={"scene": w["scene"], "baseRevision": w["revision"]})
    assert r.status_code == 200
    assert r.json()["scene"]["confirmation"]["status"] == "draft"
    assert (
        signed.post(
            f"/api/projects/{pid}/jobs",
            json={"type": "layout"},
            headers={"Idempotency-Key": str(uuid.uuid4())},
        ).status_code
        == 422
    )


def test_design_share_snapshot_and_immediate_revocation(signed, confirmed):
    pid, w = confirmed
    d = save_design(signed, pid, w)
    share = signed.post(
        f"/api/projects/{pid}/shares", json={"designId": d["id"], "expiresInHours": 1}
    ).json()
    raw = share["path"].split("/")[-1]
    url = "/api/public/shares/" + raw
    public = signed.get(url)
    assert public.status_code == 200
    assert public.headers["cache-control"] == "no-store"
    assert public.json()["design"]["sceneHash"] == d["sceneHash"]
    assert signed.delete("/api/shares/" + share["id"]).status_code == 204
    assert signed.get(url).status_code == 404


def test_job_idempotency_export_and_layout(signed, confirmed):
    pid, w = confirmed
    key = str(uuid.uuid4())
    url = f"/api/projects/{pid}/jobs"
    body = {"type": "export", "parameters": {"format": "pdf"}}
    a = signed.post(url, json=body, headers={"Idempotency-Key": key})
    assert a.status_code == 202, a.text
    b = signed.post(url, json=body, headers={"Idempotency-Key": key})
    assert a.json()["id"] == b.json()["id"]
    assert (
        signed.post(
            url, json={"type": "layout"}, headers={"Idempotency-Key": key}
        ).status_code
        == 409
    )
    process_job(a.json()["id"])
    r = signed.get("/api/jobs/" + a.json()["id"]).json()
    assert r["status"] == "succeeded", r
    asset = r["output"]["assets"][0]
    data = signed.get(asset["url"])
    assert data.content.startswith(b"%PDF-")
    r = signed.post(
        url, json={"type": "layout"}, headers={"Idempotency-Key": str(uuid.uuid4())}
    )
    assert r.status_code == 202, r.text
    process_job(r.json()["id"])
    r = signed.get("/api/jobs/" + r.json()["id"]).json()
    assert r["status"] == "succeeded", r
    assert len(r["output"]["designIds"]) == 3


def test_image_validation_private_access_and_metadata(signed, project):
    pid, w = project
    url = f"/api/projects/{pid}/assets"
    assert (
        signed.post(
            url, files={"file": ("bad.svg", b"<svg/>", "image/svg+xml")}
        ).status_code
        == 422
    )
    buf = io.BytesIO()
    Image.new("RGB", (500, 400), "white").save(buf, "JPEG")
    r = signed.post(url, files={"file": ("room.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["metadata"]["exifRemoved"]
    assert a["url"].endswith("/content") and a["thumbUrl"].endswith("/thumbnail")
    assert signed.get(a["url"]).status_code == 200
    thumb = signed.get(a["thumbUrl"])
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"
    assert thumb.headers["cache-control"].startswith("private")
    with TestClient(app) as anon:
        assert anon.get(a["url"]).status_code == 401
        assert anon.get(a["thumbUrl"]).status_code == 401
    assert signed.delete("/api/assets/" + a["id"]).status_code == 204
    assert signed.get(a["url"]).status_code == 404


def test_photo_organisation_room_direction_position_note(signed, project):
    pid, w = project
    rooms = [r["id"] for f in w["scene"]["floors"] for r in f["rooms"]]
    assert len(rooms) >= 2
    buf = io.BytesIO()
    Image.new("RGB", (240, 180), "white").save(buf, "JPEG")
    photo = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("bedroom.jpg", buf.getvalue(), "image/jpeg")},
        data={"roomId": rooms[0]},
    ).json()
    r = signed.patch(
        "/api/assets/" + photo["id"],
        json={
            "direction": "southwest",
            "position": " 床头窗边 ",
            "note": "下午逆光，待补测窗宽",
        },
    )
    assert r.status_code == 200, r.text
    organized = r.json()
    assert organized["roomId"] == rooms[0]
    assert organized["metadata"]["direction"] == "southwest"
    assert organized["metadata"]["capturePosition"] == "床头窗边"
    assert organized["metadata"]["note"] == "下午逆光，待补测窗宽"
    # Only supplied keys change; moving rooms and clearing the note keeps direction.
    r = signed.patch(
        "/api/assets/" + photo["id"], json={"roomId": rooms[1], "note": ""}
    )
    assert r.status_code == 200, r.text
    moved = r.json()
    assert moved["roomId"] == rooms[1]
    assert moved["metadata"]["direction"] == "southwest"
    assert "note" not in moved["metadata"]
    listed = signed.get(f"/api/projects/{pid}/assets").json()["items"]
    assert [a["roomId"] for a in listed if a["id"] == photo["id"]] == [rooms[1]]
    # Unknown room and unknown direction are both rejected without changing data.
    bad_room = signed.patch("/api/assets/" + photo["id"], json={"roomId": "no-such"})
    assert bad_room.status_code == 422
    assert bad_room.json()["error"]["code"] == "ROOM_MISSING"
    assert (
        signed.patch(
            "/api/assets/" + photo["id"], json={"direction": "upwards"}
        ).status_code
        == 422
    )
    # Floor plans are not photos and cannot be organised as room shots.
    plan_buf = io.BytesIO()
    Image.new("RGB", (240, 180), "white").save(plan_buf, "PNG")
    plan = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("plan.png", plan_buf.getvalue(), "image/png")},
        data={"kind": "floorplan"},
    ).json()
    assert (
        signed.patch("/api/assets/" + plan["id"], json={"note": "户型图"}).json()[
            "error"
        ]["code"]
        == "ASSET_NOT_PHOTO"
    )


def test_ai_unconfigured_never_fake_success_or_charge(signed, confirmed):
    pid, w = confirmed
    before = signed.get("/api/credits").json()["available"]
    r = signed.post(
        f"/api/projects/{pid}/jobs",
        json={"type": "style", "maxCredits": 10},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "PROVIDER_NOT_CONFIGURED"
    assert signed.get("/api/credits").json()["available"] == before


def test_exports_scene_roundtrip_and_unknown_budget(signed, project):
    from interior.catalog import budget_for

    pid, w = project
    s = w["scene"]
    s["layout"]["catalogSnapshot"][0]["priceMinor"] = None
    b = budget_for(s)
    assert b["unknownLineCount"] == 1
    raw, media, name = export_scene(s, "json")
    import json

    assert content_hash(json.loads(raw)) == content_hash(s)
    raw, media, name = export_scene(s, "csv")
    assert raw.startswith(b"\xef\xbb\xbf")


def test_viewer_cannot_mutate(signed, confirmed):
    pid, w = confirmed
    buf = io.BytesIO()
    Image.new("RGB", (384, 384), "white").save(buf, "JPEG")
    photo = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("room.jpg", buf.getvalue(), "image/jpeg")},
    ).json()
    with TestClient(app) as viewer:
        u = viewer.post("/api/auth/demo", json={}).json()
        viewer.headers["X-CSRF-Token"] = u["csrfToken"]
        r = signed.post(
            f"/api/projects/{pid}/members",
            json={"email": u["user"]["email"], "role": "viewer"},
        )
        assert r.status_code == 201
        assert viewer.get(f"/api/projects/{pid}").status_code == 200
        assert viewer.get(photo["url"]).status_code == 403
        assert viewer.get(photo["thumbUrl"]).status_code == 403
        assert (
            viewer.patch(
                "/api/assets/" + photo["id"], json={"note": "viewer edit"}
            ).status_code
            == 403
        )
        assert not viewer.get(f"/api/projects/{pid}/assets").json()["items"]
        vw = viewer.get(f"/api/projects/{pid}/working-copy").json()
        assert (
            viewer.put(
                f"/api/projects/{pid}/working-copy",
                json={"scene": vw["scene"], "baseRevision": vw["revision"]},
            ).status_code
            == 403
        )


def test_failed_provider_refunds_reserved_credits_once(signed, confirmed, monkeypatch):
    from interior.config import settings
    from interior.security import DomainError
    import interior.providers

    monkeypatch.setattr(settings, "allow_ai_calls", True)
    monkeypatch.setattr(settings, "dashscope_api_key", "test-fixture-only")

    def fail(*args):
        raise DomainError("PROVIDER_ERROR", "服务商测试失败", 502)

    monkeypatch.setattr(interior.providers, "generate_image", fail)
    pid, w = confirmed
    buf = io.BytesIO()
    Image.new("RGB", (384, 384), "white").save(buf, "JPEG")
    aid = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("fixture.jpg", buf.getvalue(), "image/jpeg")},
    ).json()["id"]
    before = signed.get("/api/credits").json()["available"]
    j = signed.post(
        f"/api/projects/{pid}/jobs",
        json={"type": "style", "assetIds": [aid], "maxCredits": 10},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert j.status_code == 202, j.text
    process_job(j.json()["id"])
    account = signed.get("/api/credits").json()
    assert account["available"] == before
    assert account["reserved"] == 0
    process_job(j.json()["id"])
    assert signed.get("/api/credits").json()["available"] == before
    result = signed.get("/api/jobs/" + j.json()["id"]).json()
    assert result["status"] == "failed"
    assert result["chargedCredits"] == 0
