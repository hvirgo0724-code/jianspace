import time
from fastapi import APIRouter, Request, Response
from sqlalchemy import select, delete
from ..config import settings
from ..mail import send_email
from ..security import (
    DB,
    CurrentUser,
    DomainError,
    digest,
    token,
    hash_password,
    verify_password,
    public_user,
    rate_limit,
)
from ..models import (
    User,
    UserSession,
    Challenge,
    EmailVerification,
    CreditAccount,
    CreditLedger,
    AccountProfile,
    uid,
)
from ..requests import Register, Login, Strict

router = APIRouter()


def establish(db, user, response):
    raw = token()
    csrf = token()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=digest(raw),
            csrf_hash=digest(csrf),
            expires_epoch=time.time() + 7 * 86400,
        )
    )
    response.set_cookie(
        "interior_session",
        raw,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=7 * 86400,
        path="/",
    )
    response.set_cookie(
        "interior_csrf",
        csrf,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=7 * 86400,
        path="/",
    )
    return {"user": public_user(user), "csrfToken": csrf, "mfaRequired": False}


@router.post("/auth/register", status_code=201)
def register(body: Register, request: Request, response: Response, db: DB):
    if not settings.allow_self_register:
        raise DomainError("REGISTRATION_DISABLED", "暂未开放注册。", 403)
    rate_limit("register:" + request.client.host, 6, 3600)
    if db.scalar(select(User).where(User.email == body.email)):
        raise DomainError(
            "ACCOUNT_UNAVAILABLE", "该邮箱无法注册，请尝试登录或恢复账户。", 409
        )
    u = User(
        id=uid(),
        email=body.email,
        display_name=body.displayName.strip(),
        password_hash=hash_password(body.password),
    )
    db.add(u)
    db.flush()
    db.add(AccountProfile(user_id=u.id))
    db.add(CreditAccount(user_id=u.id, available=settings.registration_credits))
    db.add(
        CreditLedger(
            user_id=u.id,
            event_key="registration:" + u.id,
            event_type="registration_grant",
            delta_available=settings.registration_credits,
            delta_reserved=0,
        )
    )
    return establish(db, u, response)


@router.post("/auth/login")
def login(body: Login, request: Request, response: Response, db: DB):
    rate_limit("login:" + request.client.host, 15, 300)
    u = db.scalar(
        select(User).where(
            User.email == body.email.strip().lower(), User.status == "active"
        )
    )
    if not u or not verify_password(u.password_hash, body.password):
        raise DomainError("INVALID_CREDENTIALS", "邮箱或密码不正确。", 401)
    if u.system_role == "admin" and settings.production:
        raise DomainError(
            "ADMIN_LOGIN_DISABLED", "生产管理员需使用受控运维认证入口。", 403
        )
    return establish(db, u, response)


@router.post("/auth/demo")
def demo(request: Request, response: Response, db: DB):
    if settings.production:
        raise DomainError("DEMO_DISABLED", "生产环境不提供演示账户。", 404)
    rate_limit("demo:" + request.client.host, 20, 3600)
    u = User(
        id=uid(),
        email=f"{uid()}@demo.invalid",
        display_name="体验设计师",
        password_hash=hash_password(token()),
        is_demo=True,
    )
    db.add(u)
    db.flush()
    db.add(CreditAccount(user_id=u.id, available=100))
    db.add(
        CreditLedger(
            user_id=u.id,
            event_key="welcome:" + u.id,
            event_type="development_grant",
            delta_available=100,
            delta_reserved=0,
        )
    )
    return establish(db, u, response)


@router.get("/me")
def me(user: CurrentUser):
    return public_user(user)


@router.get("/auth/csrf")
def csrf(request: Request, user: CurrentUser):
    return {"csrfToken": request.cookies.get("interior_csrf", "")}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, user: CurrentUser, db: DB):
    db.delete(request.state.session)
    response.delete_cookie("interior_session")
    response.delete_cookie("interior_csrf")


class Forgot(Strict):
    email: str


class Reset(Strict):
    token: str
    newPassword: str


@router.post("/auth/password/forgot", status_code=202)
def forgot(body: Forgot, request: Request, db: DB):
    rate_limit("forgot:" + request.client.host, 5, 600)
    if not settings.smtp_host:
        raise DomainError(
            "EMAIL_NOT_CONFIGURED", "账户邮件服务尚未配置，请联系管理员。", 503
        )
    u = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if u:
        raw = token()
        db.add(
            Challenge(
                user_id=u.id,
                purpose="password_reset",
                token_hash=digest(raw),
                expires_epoch=time.time() + 1800,
            )
        )
        send_email(
            u.email,
            "筑见账户恢复",
            f"请打开以下链接设置新密码（30分钟内有效）：\n{settings.public_url}/reset?token={raw}",
        )
    return {"accepted": True}


class EmailToken(Strict):
    token: str


@router.post("/auth/email/verify/request", status_code=202)
def request_email_verification(request: Request, user: CurrentUser, db: DB):
    rate_limit("verify-email:" + request.client.host, 5, 3600)
    if user.is_demo:
        raise DomainError("DEMO_EMAIL", "体验账户不需要验证邮箱。", 400)
    if not settings.smtp_host:
        raise DomainError(
            "EMAIL_NOT_CONFIGURED", "账户邮件服务尚未配置，请联系管理员。", 503
        )
    if db.scalar(select(EmailVerification.id).where(EmailVerification.user_id == user.id)):
        return {"accepted": True, "alreadyVerified": True}
    raw = token()
    db.add(
        Challenge(
            user_id=user.id,
            purpose="email_verify",
            token_hash=digest(raw),
            expires_epoch=time.time() + 86400,
        )
    )
    send_email(
        user.email,
        "验证筑见账户邮箱",
        f"请打开以下链接完成邮箱验证（24小时内有效）：\n{settings.public_url}/account?verify={raw}",
    )
    return {"accepted": True, "alreadyVerified": False}


@router.post("/auth/email/verify/confirm")
def confirm_email(body: EmailToken, user: CurrentUser, db: DB):
    c = db.scalar(
        select(Challenge).where(
            Challenge.token_hash == digest(body.token),
            Challenge.purpose == "email_verify",
            Challenge.consumed == False,
            Challenge.user_id == user.id,
        )
    )
    if not c or c.expires_epoch < time.time():
        raise DomainError("TOKEN_EXPIRED", "验证链接无效或已过期。")
    c.consumed = True
    if not db.scalar(select(EmailVerification.id).where(EmailVerification.user_id == user.id)):
        db.add(EmailVerification(user_id=user.id, verified_at=time.time()))
    return {"verified": True}


@router.post("/auth/password/reset", status_code=204)
def reset(body: Reset, db: DB):
    if not 12 <= len(body.newPassword) <= 128:
        raise DomainError("INVALID_PASSWORD", "密码需要12至128个字符。")
    c = db.scalar(
        select(Challenge).where(
            Challenge.token_hash == digest(body.token),
            Challenge.purpose == "password_reset",
            Challenge.consumed == False,
        )
    )
    if not c or c.expires_epoch < time.time():
        raise DomainError("TOKEN_EXPIRED", "链接无效或已过期。")
    c.consumed = True
    db.get(User, c.user_id).password_hash = hash_password(body.newPassword)
    db.execute(delete(UserSession).where(UserSession.user_id == c.user_id))
