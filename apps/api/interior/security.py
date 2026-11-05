import hashlib, secrets, time, threading
from collections import defaultdict, deque
from typing import Annotated
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from .database import get_db
from .models import User, UserSession, Project, Member


class DomainError(Exception):
    def __init__(self, code, message, status=422, details=None):
        self.code, self.message, self.status, self.details = (
            code,
            message,
            status,
            details or {},
        )


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def token():
    return secrets.token_urlsafe(32)


hasher = PasswordHasher()


def hash_password(password):
    return hasher.hash(password)


def verify_password(hash_, password):
    try:
        return hasher.verify(hash_, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


DB = Annotated[Session, Depends(get_db, scope="function")]


def current_user(request: Request, db: DB):
    raw = request.cookies.get("interior_session", "")
    session = (
        db.scalar(select(UserSession).where(UserSession.token_hash == digest(raw)))
        if raw
        else None
    )
    if not session or session.expires_epoch < time.time():
        raise DomainError("SESSION_EXPIRED", "请登录后继续。", 401)
    user = db.get(User, session.user_id)
    if not user or user.status != "active":
        raise DomainError("SESSION_EXPIRED", "账户当前无法使用。", 401)
    request.state.user = user
    request.state.session = session
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def authorize(db, user, project_id, write=False, owner=False):
    p = db.get(Project, project_id)
    m = db.get(Member, (project_id, user.id))
    if not p or p.deleted or not m:
        raise DomainError("PROJECT_FORBIDDEN", "无法访问该项目。", 403)
    if owner and m.role != "owner" or write and m.role == "viewer":
        raise DomainError("PROJECT_FORBIDDEN", "当前角色没有修改权限。", 403)
    return p


_limits = defaultdict(deque)
_limit_lock = threading.Lock()


def rate_limit(key, limit=10, seconds=60):
    from .config import settings

    if settings.production:
        import redis

        try:
            store = redis.Redis.from_url(settings.redis_url, socket_timeout=2)
            bucket = (
                "interior:rate:" + digest(key) + ":" + str(int(time.time()) // seconds)
            )
            with store.pipeline() as pipe:
                pipe.incr(bucket)
                pipe.expire(bucket, seconds + 1)
                count, _ = pipe.execute()
            if count > limit:
                raise DomainError("RATE_LIMITED", "请求较多，请稍后再试。", 429)
            return
        except redis.RedisError:
            raise DomainError(
                "RATE_LIMIT_UNAVAILABLE", "认证服务暂不可用，请稍后再试。", 503
            )
    with _limit_lock:
        q = _limits[key]
        t = time.monotonic()
        while q and q[0] < t - seconds:
            q.popleft()
        if len(q) >= limit:
            raise DomainError("RATE_LIMITED", "请求较多，请稍后再试。", 429)
        q.append(t)


def public_user(u):
    return {
        "id": u.id,
        "email": u.email,
        "displayName": u.display_name,
        "status": u.status,
        "isDemo": u.is_demo,
        "role": u.system_role,
    }
