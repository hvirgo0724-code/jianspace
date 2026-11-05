"""Cross-feature workflows in conftest's disposable DB. No SMTP or AI traffic."""

import copy
import re
import io

from PIL import Image

from fastapi.testclient import TestClient

from interior.config import settings
from interior.main import app


def freeze(client, pid, working):
    response = client.post(
        f"/api/projects/{pid}/designs",
        json={
            "title": "完整功能验收 · 虚构数据",
            "geometryVersionId": working["scene"]["geometryVersionId"],
            "scene": working["scene"],
            "baseRevision": working["revision"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_registration_login_logout_and_password_recovery_with_fake_smtp(
    client, monkeypatch
):
    monkeypatch.setattr(settings, "allow_self_register", True)
    monkeypatch.setattr(settings, "smtp_host", "mail.test.invalid")
    messages = []

    class FakeSMTP:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def login(self, *args):
            pass

        def send_message(self, message):
            messages.append(message)

    monkeypatch.setattr("interior.mail.smtplib.SMTP_SSL", FakeSMTP)
    credentials = {
        "email": "regression@example.invalid",
        "password": "Fixture-password-123",
    }
    registered = client.post(
        "/api/auth/register", json={**credentials, "displayName": "回归用户"}
    )
    assert registered.status_code == 201, registered.text
    client.headers["X-CSRF-Token"] = registered.json()["csrfToken"]
    assert client.get("/api/me").json()["email"] == credentials["email"]
    assert (
        client.get("/api/auth/csrf").json()["csrfToken"]
        == registered.json()["csrfToken"]
    )
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/me").status_code == 401
    login = client.post("/api/auth/login", json=credentials)
    assert login.status_code == 200
    client.headers["X-CSRF-Token"] = login.json()["csrfToken"]
    assert (
        client.post(
            "/api/auth/password/forgot", json={"email": credentials["email"]}
        ).status_code
        == 202
    )
    assert len(messages) == 1
    reset_token = re.search(r"token=([^\s]+)", messages[0].get_content()).group(1)
    replacement = "Replacement-fixture-password-456"
    reset = client.post(
        "/api/auth/password/reset",
        json={"token": reset_token, "newPassword": replacement},
    )
    assert reset.status_code == 204, reset.text
    assert client.get("/api/me").status_code == 401
    assert (
        client.post(
            "/api/auth/password/reset",
            json={"token": reset_token, "newPassword": replacement},
        ).status_code
        == 422
    )
    assert client.post("/api/auth/login", json=credentials).status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={**credentials, "password": replacement}
        ).status_code
        == 200
    )


def test_public_capabilities_and_complete_catalog(client):
    assert client.get("/api/health").json()["status"] == "ok"
    capabilities = client.get("/api/capabilities").json()
    assert capabilities["aiImage"] is False
    assert set(capabilities["features"]["exports"]) == {"pdf", "csv", "json"}
    catalog = client.get("/api/catalog").json()
    assert len(catalog["items"]) == 48
    assert len(catalog["styles"]) == 12
    assert len(client.get("/api/home-templates").json()["items"]) == 11


def test_metadata_archive_copy_and_delete_do_not_modify_source(signed, project):
    pid, working = project
    original = copy.deepcopy(working["scene"])
    patched = signed.patch(
        f"/api/projects/{pid}", json={"name": "修改名称", "baseRevision": 0}
    )
    assert patched.status_code == 200
    archived = signed.post(
        f"/api/projects/{pid}/archive",
        json={"archived": True, "baseRevision": patched.json()["revision"]},
    )
    assert archived.status_code == 200 and archived.json()["archived"]
    restored = signed.post(
        f"/api/projects/{pid}/archive",
        json={"archived": False, "baseRevision": archived.json()["revision"]},
    )
    assert restored.status_code == 200 and not restored.json()["archived"]
    copied = signed.post(f"/api/projects/{pid}/copy", json={"name": "可删除测试副本"})
    assert copied.status_code == 201
    copy_id = copied.json()["id"]
    copied_scene = signed.get(f"/api/projects/{copy_id}/working-copy").json()["scene"]
    assert copied_scene["floors"] == original["floors"]
    assert copied_scene["sceneId"] != original["sceneId"]
    assert copied_scene["confirmation"]["status"] == "draft"
    assert signed.delete(f"/api/projects/{copy_id}").status_code == 202
    assert signed.get(f"/api/projects/{copy_id}").status_code == 403
    assert copy_id not in {p["id"] for p in signed.get("/api/projects").json()["items"]}
    assert signed.get(f"/api/projects/{pid}/working-copy").json()["scene"] == original


def test_measurement_batch_ids_units_and_superseding(signed, project):
    pid, working = project
    record = copy.deepcopy(working["scene"]["measurements"][0])
    url = f"/api/projects/{pid}/measurements"
    saved = signed.post(url, json={"records": [record]})
    assert saved.status_code == 201, saved.text
    first_id = saved.json()["id"]
    assert isinstance(first_id, str) and first_id
    record["rawValue"] *= 2
    record["normalizedMm"] *= 2
    second = signed.post(url, json={"records": [record], "supersedesId": first_id})
    assert second.status_code == 201, second.text
    assert second.json()["id"] != first_id
    assert len(signed.get(url).json()["items"]) == 2
    record["normalizedMm"] += 1
    assert signed.post(url, json={"records": [record]}).status_code == 422
    assert len(signed.get(url).json()["items"]) == 2


def test_copied_recognized_plan_is_independent_and_can_be_saved(signed, project):
    pid, working = project
    image = io.BytesIO()
    Image.new("RGB", (800, 600), "white").save(image, "PNG")
    uploaded = signed.post(
        f"/api/projects/{pid}/assets",
        files={"file": ("fictional-plan.png", image.getvalue(), "image/png")},
        data={"kind": "floorplan"},
    )
    assert uploaded.status_code == 201, uploaded.text
    source = copy.deepcopy(working["scene"])
    source["layout"]["planSource"] = {
        "assetId": uploaded.json()["id"],
        "method": "vision-draft",
        "referenceWidthMm": 8000,
        "unverifiedDimensions": True,
    }
    source["measurements"][0]["sourceAssetIds"] = [uploaded.json()["id"]]
    saved = signed.put(
        f"/api/projects/{pid}/working-copy",
        json={"scene": source, "baseRevision": working["revision"]},
    )
    assert saved.status_code == 200, saved.text
    copied = signed.post(f"/api/projects/{pid}/copy", json={"name": "  独立户型副本  "})
    assert copied.status_code == 201 and copied.json()["name"] == "独立户型副本"
    target = f"/api/projects/{copied.json()['id']}"
    draft = signed.get(target + "/working-copy").json()
    assert "planSource" not in draft["scene"]["layout"]
    assert all(not m["sourceAssetIds"] for m in draft["scene"]["measurements"])
    assert draft["scene"]["floors"] == source["floors"]
    assert draft["scene"]["confirmation"]["status"] == "draft"
    assert (
        signed.put(
            target + "/working-copy",
            json={"scene": draft["scene"], "baseRevision": draft["revision"]},
        ).status_code
        == 200
    )
    assert signed.get(target + "/assets").json()["items"] == []
    assert signed.get(f"/api/projects/{pid}/working-copy").json() == saved.json()


def test_copy_rejects_empty_and_overlong_names_without_creating_projects(
    signed, project
):
    pid, _ = project
    before = signed.get("/api/projects").json()
    for name in ("", "   ", "x" * 121):
        assert (
            signed.post(f"/api/projects/{pid}/copy", json={"name": name}).status_code
            == 422
        )
    assert signed.get("/api/projects").json() == before


def test_context_review_validation_and_geometry_history_are_read_only(
    signed, confirmed
):
    pid, working = confirmed
    body = {"scene": working["scene"], "baseRevision": working["revision"]}
    checked = signed.post(f"/api/projects/{pid}/geometry-drafts/validate", json=body)
    assert checked.status_code == 200 and checked.json()["valid"]
    reviewed = signed.post(f"/api/projects/{pid}/layout-review", json=body)
    assert reviewed.status_code == 200 and 0 <= reviewed.json()["score"] <= 100
    estimate = signed.post(f"/api/projects/{pid}/estimate", json=body)
    assert estimate.status_code == 200, estimate.text
    assert estimate.json()["knownSubtotalMinor"] >= 0
    room = working["scene"]["floors"][0]["rooms"][0]
    context = signed.post(
        f"/api/projects/{pid}/ai-context", json={**body, "roomId": room["id"]}
    )
    assert context.status_code == 200, context.text
    assert context.json()["heightMm"] == room["heightMm"]
    assert context.json()["imageDataUrl"].startswith("data:image/png;base64,")
    history = signed.get(f"/api/projects/{pid}/geometry-versions").json()["items"]
    assert any(g["id"] == working["scene"]["geometryVersionId"] for g in history)
    assert signed.get(f"/api/projects/{pid}/working-copy").json() == working


def test_saved_budget_comments_approval_and_membership_revocation(signed, confirmed):
    pid, working = confirmed
    design = freeze(signed, pid, working)
    did = design["id"]
    assert (
        signed.get(f"/api/projects/{pid}/designs/{did}").json()["sceneHash"]
        == design["sceneHash"]
    )
    budget = signed.post(f"/api/projects/{pid}/budgets", json={"designId": did})
    assert budget.status_code == 201 and budget.json()["id"]
    loaded = signed.get(f"/api/projects/{pid}/designs/{did}/budget").json()
    assert loaded["knownSubtotalMinor"] == budget.json()["knownSubtotalMinor"]
    with TestClient(app) as viewer:
        account = viewer.post("/api/auth/demo", json={}).json()
        viewer.headers["X-CSRF-Token"] = account["csrfToken"]
        member = signed.post(
            f"/api/projects/{pid}/members",
            json={"email": account["user"]["email"], "role": "viewer"},
        )
        assert member.status_code == 201
        assert len(signed.get(f"/api/projects/{pid}/members").json()["items"]) == 2
        comment = viewer.post(
            f"/api/projects/{pid}/comments",
            json={"designId": did, "body": "虚构方案验收意见"},
        )
        assert comment.status_code == 201
        comments = signed.get(
            f"/api/projects/{pid}/comments", params={"designId": did}
        ).json()["items"]
        assert comments[0]["id"] == comment.json()["id"]
        decision = viewer.post(
            f"/api/projects/{pid}/approvals",
            json={"designId": did, "decision": "changes_requested"},
        )
        assert decision.status_code == 200
        assert (
            viewer.post(
                f"/api/projects/{pid}/designs",
                json={
                    "title": "越权",
                    "scene": working["scene"],
                    "geometryVersionId": working["scene"]["geometryVersionId"],
                    "baseRevision": 0,
                },
            ).status_code
            == 403
        )
        assert (
            signed.delete(
                f"/api/projects/{pid}/members/{account['user']['id']}"
            ).status_code
            == 204
        )
        assert viewer.get(f"/api/projects/{pid}/designs/{did}").status_code == 403


def test_deleting_project_revokes_previously_working_share(signed, confirmed):
    pid, working = confirmed
    design = freeze(signed, pid, working)
    shared = signed.post(
        f"/api/projects/{pid}/shares",
        json={"designId": design["id"], "includeBudget": True},
    ).json()
    assert (
        signed.get(f"/api/projects/{pid}/shares").json()["items"][0]["id"]
        == shared["id"]
    )
    public_url = "/api/public/shares/" + shared["path"].split("/")[-1]
    assert signed.get(public_url).status_code == 200
    assert signed.delete(f"/api/projects/{pid}").status_code == 202
    assert signed.get(public_url).status_code == 404
