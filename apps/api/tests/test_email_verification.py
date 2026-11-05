"""Email verification: opt-in request, token confirmation and account status."""

import pytest

from interior.config import settings
from interior.routes import auth as auth_routes
from interior import mail


@pytest.fixture
def registered(client):
    response = client.post(
        "/api/auth/register",
        json={
            "email": "verify@example.invalid",
            "password": "Fixture-verify-password-123",
            "displayName": "邮箱验收",
        },
    )
    assert response.status_code == 201, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrfToken"]
    return client


def test_demo_account_needs_no_email_verification(signed):
    assert signed.get("/api/account").json()["emailVerified"] is True
    response = signed.post("/api/auth/email/verify/request")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "DEMO_EMAIL"


def test_registered_account_requires_configured_mail_service(registered):
    assert registered.get("/api/account").json()["emailVerified"] is False
    response = registered.post("/api/auth/email/verify/request")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "EMAIL_NOT_CONFIGURED"


def test_verification_token_is_single_use_and_updates_account(
    registered, monkeypatch
):
    captured = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            captured["host"] = host

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def login(self, user, password):
            pass

        def send_message(self, message):
            captured["to"] = message["To"]
            captured["body"] = message.get_content()

    monkeypatch.setattr(settings, "smtp_host", "smtp.example.invalid")
    monkeypatch.setattr(settings, "smtp_from", "noreply@example.invalid")
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(auth_routes, "token", lambda: "fixture-verify-token")

    response = registered.post("/api/auth/email/verify/request")
    assert response.status_code == 202, response.text
    assert response.json() == {"accepted": True, "alreadyVerified": False}
    assert captured["to"] == "verify@example.invalid"
    assert "/account?verify=fixture-verify-token" in captured["body"]
    assert registered.get("/api/account").json()["emailVerified"] is False

    wrong = registered.post(
        "/api/auth/email/verify/confirm", json={"token": "wrong-token"}
    )
    assert wrong.status_code == 422
    assert wrong.json()["error"]["code"] == "TOKEN_EXPIRED"

    confirmed = registered.post(
        "/api/auth/email/verify/confirm", json={"token": "fixture-verify-token"}
    )
    assert confirmed.status_code == 200 and confirmed.json() == {"verified": True}
    assert registered.get("/api/account").json()["emailVerified"] is True

    again = registered.post(
        "/api/auth/email/verify/confirm", json={"token": "fixture-verify-token"}
    )
    assert again.status_code == 422
    repeated = registered.post("/api/auth/email/verify/request")
    assert repeated.status_code == 202
    assert repeated.json()["alreadyVerified"] is True
