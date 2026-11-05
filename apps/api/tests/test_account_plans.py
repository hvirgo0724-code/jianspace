import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from sqlalchemy import select
from fastapi.testclient import TestClient
from interior.main import app
from interior.database import SessionLocal
from interior.models import (
    AccountProfile,
    CreditAccount,
    Member,
    Project,
    User,
    UserSession,
    WorkingCopy,
    uid,
)


@pytest.fixture
def regular(client):
    response = client.post(
        "/api/auth/register",
        json={
            "email": "plans@example.invalid",
            "password": "Fixture-plan-password-123",
            "displayName": "套餐验收",
        },
    )
    assert response.status_code == 201
    client.headers["X-CSRF-Token"] = response.json()["csrfToken"]
    return client


def test_public_catalog_uses_current_costs_and_never_promises_payment(client):
    catalog = client.get("/api/plans").json()
    assert [p["id"] for p in catalog["items"]] == ["free", "family", "professional"]
    assert catalog["paymentEnabled"] is False
    assert catalog["costs"] == {
        "style": 10,
        "inpaint": 8,
        "recognize": 5,
        "layout": 0,
        "export": 0,
    }
    assert client.get("/api/account").status_code == 401
    assert client.get("/api/account/export").status_code == 401


def test_registered_and_demo_accounts_have_distinct_real_entitlements(regular):
    account = regular.get("/api/account").json()
    assert account["accountType"] == "registered" and account["plan"]["id"] == "free"
    assert account["plan"]["maxActiveProjects"] == 1
    assert account["plan"]["aiDailyLimit"] == 5
    assert account["credits"] == {
        "available": 6,
        "reserved": 0,
        "charged": 0,
        "released": 0,
    }
    assert account["privacy"]["modelImprovementConsent"] is False
    assert (
        regular.get("/api/credits").json()["ledger"][0]["type"] == "registration_grant"
    )


def test_demo_cannot_farm_trial_credits(signed):
    before = signed.get("/api/credits").json()
    assert signed.get("/api/account").json()["plan"]["id"] == "demo"
    assert signed.post("/api/account/trial", json={}).status_code == 409
    assert signed.get("/api/credits").json() == before


def test_trial_grants_once_even_with_concurrent_requests_and_does_not_renew(regular):
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda _: regular.post("/api/account/trial", json={}), range(2))
        )
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    account = regular.get("/api/account").json()
    assert (
        account["plan"]["id"] == "family" and account["plan"]["maxActiveProjects"] == 10
    )
    assert account["credits"]["available"] == 36 and not account["plan"]["autoRenew"]
    ledger = regular.get("/api/credits").json()["ledger"]
    assert len([l for l in ledger if l["type"] == "trial_grant"]) == 1
    with SessionLocal() as db:
        profile = db.get(AccountProfile, account["user"]["id"])
        profile.trial_expires_at = time.time() - 1
        db.commit()
    after = regular.post("/api/account/trial", json={}).json()
    assert after["plan"]["id"] == "free" and after["plan"]["trialUsed"]
    assert after["credits"]["available"] == 36


def test_free_project_quota_covers_create_copy_and_unarchive(regular):
    first = regular.post("/api/projects", json={"name": "第一个家"}).json()
    assert (
        regular.post("/api/projects", json={"name": "超额"}).json()["error"]["code"]
        == "PROJECT_PLAN_LIMIT"
    )
    assert (
        regular.post(
            f"/api/projects/{first['id']}/copy", json={"name": "超额副本"}
        ).status_code
        == 409
    )
    archived = regular.post(
        f"/api/projects/{first['id']}/archive",
        json={"archived": True, "baseRevision": 0},
    ).json()
    assert regular.post("/api/projects", json={"name": "第二个家"}).status_code == 201
    assert (
        regular.post(
            f"/api/projects/{first['id']}/archive",
            json={"archived": False, "baseRevision": archived["revision"]},
        ).status_code
        == 409
    )
    assert regular.get(f"/api/projects/{first['id']}").status_code == 200
    regular.post("/api/account/trial", json={})
    assert (
        regular.post(
            f"/api/projects/{first['id']}/archive",
            json={"archived": False, "baseRevision": archived["revision"]},
        ).status_code
        == 200
    )


def test_profile_revision_and_forbidden_role_and_plan_changes(regular):
    before = regular.get("/api/account").json()
    changed = regular.patch(
        "/api/account", json={"displayName": "  新名字  ", "baseRevision": 0}
    )
    assert (
        changed.status_code == 200 and changed.json()["user"]["displayName"] == "新名字"
    )
    assert regular.get("/api/me").json()["displayName"] == "新名字"
    assert (
        regular.patch(
            "/api/account", json={"displayName": "旧请求", "baseRevision": 0}
        ).status_code
        == 409
    )
    for extra in ({"role": "admin"}, {"planId": "family"}, {"dataConsent": True}):
        assert (
            regular.patch(
                "/api/account", json={"displayName": "越权", "baseRevision": 1, **extra}
            ).status_code
            == 422
        )
    assert regular.get("/api/account").json()["plan"] == before["plan"]
    assert (
        regular.post(
            "/api/account/trial", json={"credits": 10000, "planId": "admin"}
        ).status_code
        == 422
    )
    with SessionLocal() as db:
        db.get(User, before["user"]["id"]).system_role = "admin"
        db.commit()
    admin = regular.get("/api/account").json()
    assert admin["accountType"] == "admin" and admin["plan"]["id"] == "free"


def test_professional_interest_can_be_cancelled_without_grant_or_messages(regular):
    for value in (True, True, False):
        response = regular.post(
            "/api/account/professional-interest", json={"interested": value}
        )
        assert (
            response.status_code == 200
            and response.json()["professionalInterest"] is value
        )
        assert response.json()["credits"]["available"] == 6
        assert response.json()["plan"]["id"] == "free"


def test_export_whitelists_owned_data_and_excludes_credentials_and_other_users(
    signed, project
):
    pid, _ = project
    owner = signed.get("/api/me").json()
    with SessionLocal() as db:
        other = User(
            id=uid(),
            email="other-private@example.invalid",
            display_name="其他用户",
            password_hash="not-used",
        )
        db.add(other)
        db.flush()
        shared = Project(id=uid(), owner_id=other.id, name="共享项目")
        db.add(shared)
        db.flush()
        db.add_all(
            [
                Member(project_id=shared.id, user_id=other.id, role="owner"),
                Member(project_id=shared.id, user_id=owner["id"], role="viewer"),
                WorkingCopy(
                    project_id=shared.id,
                    user_id=other.id,
                    scene_json={"private": "PRIVATE_OWNER_DRAFT"},
                ),
            ]
        )
        db.commit()
    exported = signed.get("/api/account/export").json()
    assert exported["ownedProjects"][0]["id"] == pid
    assert exported["ownedProjects"][0]["workingScene"]["measurements"]
    assert exported["format"] == "jianspace-personal-data-1.0"
    text = str(exported)
    assert (
        "PRIVATE_OWNER_DRAFT" not in text
        and "other-private@example.invalid" not in text
    )
    assert len(exported["ownedProjects"]) == 1
    assert (
        next(p for p in exported["account"]["projects"] if p["id"] == shared.id)["role"]
        == "viewer"
    )
    assert all(
        secret not in text
        for secret in (
            "password_hash",
            "token_hash",
            "csrf_hash",
            "object_key",
            "dashscope_api_key",
        )
    )
    with SessionLocal() as db:
        db.get(User, owner["id"]).system_role = "admin"
        db.commit()
    assert signed.get("/api/account").json()["accountType"] == "demo"


def test_project_quota_is_serialized_under_concurrent_creation(regular):
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda i: regular.post("/api/projects", json={"name": f"并发项目{i}"}),
                range(2),
            )
        )
    assert sorted(r.status_code for r in responses) == [201, 409]
    assert regular.get("/api/account").json()["stats"]["ownedActiveProjects"] == 1


def test_trial_expiry_preserves_existing_projects_and_remaining_credits(regular):
    regular.post("/api/account/trial", json={})
    projects = [
        regular.post("/api/projects", json={"name": f"试用项目{i}"}).json()
        for i in range(2)
    ]
    account = regular.get("/api/account").json()
    with SessionLocal() as db:
        db.get(AccountProfile, account["user"]["id"]).trial_expires_at = time.time() - 1
        db.commit()
    assert regular.get("/api/account").json()["credits"]["available"] == 36
    for p in projects:
        assert regular.get(f"/api/projects/{p['id']}/working-copy").status_code == 200
        assert (
            regular.patch(
                f"/api/projects/{p['id']}",
                json={"name": "到期仍可编辑", "baseRevision": p["revision"]},
            ).status_code
            == 200
        )
    assert (
        regular.post("/api/projects", json={"name": "超出免费名额"}).status_code == 409
    )


def test_project_list_paginates_and_filters_archived(signed):
    created = [
        signed.post("/api/projects", json={"name": f"分页项目{i}"}).json()
        for i in range(5)
    ]
    first = signed.get("/api/projects?limit=2").json()
    assert first["total"] == 5 and first["activeTotal"] == 5
    assert len(first["items"]) == 2 and first["nextCursor"] == "2"
    second = signed.get("/api/projects?limit=2&offset=2").json()
    third = signed.get("/api/projects?limit=2&offset=4").json()
    assert third["nextCursor"] is None and len(third["items"]) == 1
    seen = [p["id"] for p in first["items"] + second["items"] + third["items"]]
    assert len(set(seen)) == 5 and set(seen) == {p["id"] for p in created}
    assert len(signed.get("/api/projects?limit=999").json()["items"]) == 5

    target = created[0]
    archived = signed.post(
        f"/api/projects/{target['id']}/archive",
        json={"archived": True, "baseRevision": target["revision"]},
    )
    assert archived.status_code == 200
    active = signed.get("/api/projects?archived=false").json()
    assert active["total"] == 4 and active["activeTotal"] == 4
    only_archived = signed.get("/api/projects?archived=true").json()
    assert only_archived["total"] == 1 and only_archived["activeTotal"] == 4
    assert only_archived["items"][0]["id"] == target["id"]


def test_project_list_searches_filters_and_sorts_server_side(signed):
    created = {
        "海棠湾住宅": signed.post(
            "/api/projects",
            json={"name": "海棠湾住宅", "description": "海边三居", "templateId": "three-bedroom"},
        ).json(),
        "Loft Studio": signed.post(
            "/api/projects",
            json={"name": "Loft Studio", "description": "LOFT 改造", "templateId": "loft"},
        ).json(),
        "山间小屋": signed.post(
            "/api/projects",
            json={"name": "山间小屋", "description": "手写备忘：周末短住", "templateId": "single-room"},
        ).json(),
    }
    by_name = signed.get("/api/projects?q=海棠").json()
    assert by_name["total"] == 1 and by_name["items"][0]["id"] == created["海棠湾住宅"]["id"]
    by_description = signed.get("/api/projects?q=loft 改造").json()
    assert by_description["total"] == 1
    assert by_description["items"][0]["id"] == created["Loft Studio"]["id"]
    assert signed.get("/api/projects?q=%25").json()["total"] == 0

    draft = signed.get("/api/projects?status=draft").json()
    assert draft["total"] == 3
    assert signed.get("/api/projects?status=confirmed").json()["total"] == 0

    names = [p["name"] for p in signed.get("/api/projects?sort=name").json()["items"]]
    assert names == sorted(names, key=str.lower)

    areas = [
        p.get("areaM2")
        for p in signed.get("/api/projects?sort=area").json()["items"]
        if p.get("areaM2") is not None
    ]
    assert areas == sorted(areas, reverse=True)

    page = signed.get("/api/projects?q=项目&limit=1").json()
    assert page["total"] == 0
    filtered = signed.get("/api/projects?status=draft&limit=1").json()
    assert filtered["total"] == 3 and len(filtered["items"]) == 1
    assert filtered["nextCursor"] == "1"


def test_account_deletion_is_confirmed_then_revokes_everything(regular):
    email = regular.get("/api/me").json()["email"]
    password = "Fixture-plan-password-123"
    project = regular.post("/api/projects", json={"name": "注销前项目"}).json()
    account = regular.get("/api/account").json()
    user_id = account["user"]["id"]

    assert (
        regular.request(
            "DELETE",
            "/api/account",
            json={"confirmEmail": "wrong@example.invalid", "password": password},
        ).status_code
        == 422
    )
    assert (
        regular.request(
            "DELETE",
            "/api/account",
            json={"confirmEmail": email, "password": "wrong-password"},
        ).status_code
        == 403
    )
    assert regular.get("/api/me").status_code == 200

    closed = regular.request(
        "DELETE", "/api/account", json={"confirmEmail": email, "password": password}
    )
    assert closed.status_code == 202, closed.text
    assert closed.json()["ownedProjects"] == 1
    assert regular.get("/api/me").status_code == 401
    assert regular.get("/api/projects").status_code == 401

    with TestClient(app) as again:
        assert (
            again.post(
                "/api/auth/login", json={"email": email, "password": password}
            ).status_code
            == 401
        )

    with SessionLocal() as db:
        user = db.get(User, user_id)
        assert user.status == "deleted" and user.email != email
        assert "已注销" in user.display_name
        assert db.get(Project, project["id"]).deleted is True
        assert not db.scalars(select(Member).where(Member.user_id == user_id)).all()
        assert not db.scalars(
            select(UserSession).where(UserSession.user_id == user_id)
        ).all()
        assert db.get(CreditAccount, user_id) is None
        assert db.get(AccountProfile, user_id) is None
