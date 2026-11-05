"""Application entitlements; never treats a client claim as a paid subscription."""

import time
from sqlalchemy import select, update, func
from .config import settings
from .models import AccountProfile, Project, User
from .security import DomainError


def entitlements(db, user):
    profile = db.get(AccountProfile, user.id)
    active_trial = bool(
        profile
        and profile.plan_id == "family"
        and profile.trial_expires_at
        and profile.trial_expires_at > time.time()
    )
    plan = "demo" if user.is_demo else "family" if active_trial else "free"
    return {
        "id": plan,
        "name": {
            "demo": "本地体验 · 完整 V1",
            "family": "家庭版 · 试用中",
            "free": "免费体验",
        }[plan],
        "maxActiveProjects": None if plan == "demo" else 10 if plan == "family" else 1,
        "aiDailyLimit": min(settings.ai_daily_limit, 5 if plan == "free" else 30),
        "trialUsed": bool(profile and profile.trial_started_at),
        "trialExpiresAt": profile.trial_expires_at if profile else None,
        "autoRenew": False,
        "paymentEnabled": False,
    }


def lock_account(db, user):
    # Serialize quota checks and one-time grants across workers (SQLite and PostgreSQL).
    db.execute(
        update(User).where(User.id == user.id).values(display_name=User.display_name)
    )


def ensure_profile(db, user):
    profile = db.get(AccountProfile, user.id)
    if not profile:
        profile = AccountProfile(user_id=user.id)
        db.add(profile)
        db.flush()
    return profile


def check_project_quota(db, user):
    if user.is_demo:
        return
    lock_account(db, user)
    limit = entitlements(db, user)["maxActiveProjects"]
    count = db.scalar(
        select(func.count())
        .select_from(Project)
        .where(
            Project.owner_id == user.id,
            Project.deleted == False,
            Project.archived == False,
        )
    )
    if limit is not None and count >= limit:
        raise DomainError(
            "PROJECT_PLAN_LIMIT",
            f"当前套餐最多支持 {limit} 个进行中的自有项目。可先归档，或前往账户与套餐查看试用。",
            409,
            {"limit": limit, "active": count},
        )
