import time
from datetime import datetime, timezone
from fastapi import APIRouter, Response
from pydantic import Field, field_validator
from sqlalchemy import select, func, update, delete
from ..security import (
    CurrentUser,
    DB,
    DomainError,
    public_user,
    hash_password,
    token,
    verify_password,
)
from ..requests import Strict
from ..config import settings
from ..models import (
    AccountProfile,
    Asset,
    Audit,
    Challenge,
    CreditAccount,
    CreditLedger,
    DesignVersion,
    EmailVerification,
    Job,
    Member,
    Project,
    Share,
    UserSession,
    WorkingCopy,
    now,
)
from ..plans import entitlements, ensure_profile, lock_account

router = APIRouter()


@router.get("/plans")
def plans():
    return {
        "paymentEnabled": False,
        "trialDays": settings.family_trial_days,
        "trialCredits": settings.family_trial_credits,
        "registrationCredits": settings.registration_credits,
        "costs": {
            "style": settings.ai_image_credits,
            "inpaint": settings.ai_inpaint_credits,
            "recognize": settings.ai_plan_credits,
            "layout": 0,
            "export": 0,
        },
        "items": [
            {
                "id": "free",
                "name": "免费体验",
                "priceLabel": "¥0",
                "description": "适合建立第一份量房资料",
                "features": [
                    "1 个进行中的自有住宅项目",
                    "完整实测录入与校验",
                    "2D 编辑、3D 预览与漫游",
                    f"新注册赠送 {settings.registration_credits} 点应用积分",
                ],
            },
            {
                "id": "family",
                "name": "家庭版",
                "priceLabel": "试用中",
                "description": "完整 V1 流程，适合打磨一套住宅",
                "features": [
                    "最多 10 个进行中的自有项目",
                    "多房间与方案版本比较",
                    "预算草稿、导出与受控分享",
                    f"{settings.family_trial_days} 天免费试用，一次赠送 {settings.family_trial_credits} 点",
                ],
            },
            {
                "id": "professional",
                "name": "专业协作",
                "priceLabel": "后续开放",
                "description": "设计师与门店的多项目工作台",
                "features": [
                    "团队模板与品牌素材规划",
                    "客户资料结构化交付规划",
                    "API 与批量导出规划",
                    "可登记意向，当前不出售",
                ],
            },
        ],
    }


def account_data(db, user):
    profile = db.get(AccountProfile, user.id)
    credit = db.get(CreditAccount, user.id)
    projects = db.execute(
        select(Project, Member.role)
        .join(Member, Member.project_id == Project.id)
        .where(Member.user_id == user.id, Project.deleted == False)
        .order_by(Project.updated_at.desc())
    ).all()
    owned_ids = [p.id for p, _ in projects if p.owner_id == user.id]

    def scalar_sum(column, model, *conditions):
        return (
            db.scalar(
                select(func.coalesce(func.sum(column), 0))
                .select_from(model)
                .where(*conditions)
            )
            or 0
        )

    members = dict(
        db.execute(
            select(Member.project_id, func.count())
            .where(Member.project_id.in_([p.id for p, _ in projects]))
            .group_by(Member.project_id)
        ).all()
    )
    charged = -scalar_sum(
        CreditLedger.delta_reserved,
        CreditLedger,
        CreditLedger.user_id == user.id,
        CreditLedger.event_type == "charge",
    )
    released = scalar_sum(
        CreditLedger.delta_available,
        CreditLedger,
        CreditLedger.user_id == user.id,
        CreditLedger.event_type == "release",
    )
    storage = scalar_sum(
        Asset.bytes, Asset, Asset.project_id.in_(owned_ids), Asset.state == "ready"
    )
    return {
        "user": public_user(user),
        "emailVerified": bool(
            user.is_demo
            or db.scalar(
                select(EmailVerification.id).where(
                    EmailVerification.user_id == user.id
                )
            )
        ),
        "revision": profile.revision if profile else 0,
        "accountType": "demo"
        if user.is_demo
        else "admin"
        if user.system_role == "admin"
        else "registered",
        "plan": entitlements(db, user),
        "professionalInterest": bool(profile and profile.professional_interest),
        "credits": {
            "available": credit.available if credit else 0,
            "reserved": credit.reserved if credit else 0,
            "charged": charged,
            "released": released,
        },
        "stats": {
            "activeProjects": sum(not p.archived for p, _ in projects),
            "ownedActiveProjects": sum(
                not p.archived and p.owner_id == user.id for p, _ in projects
            ),
            "totalProjects": len(projects),
            "jobs": db.scalar(
                select(func.count()).select_from(Job).where(Job.user_id == user.id)
            ),
            "storageBytes": storage,
        },
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "role": role,
                "archived": p.archived,
                "memberCount": members.get(p.id, 0),
            }
            for p, role in projects
        ],
        "privacy": {
            "modelImprovementConsent": False,
            "consentAvailable": False,
            "storageMode": settings.storage_backend,
        },
    }


@router.get("/account")
def account(user: CurrentUser, db: DB):
    return account_data(db, user)


class ProfilePatch(Strict):
    displayName: str = Field(min_length=1, max_length=80)
    baseRevision: int = Field(ge=0)

    @field_validator("displayName")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("显示名称不能为空。")
        return value.strip()


@router.patch("/account")
def patch_account(body: ProfilePatch, user: CurrentUser, db: DB):
    lock_account(db, user)
    profile = ensure_profile(db, user)
    if profile.revision != body.baseRevision:
        raise DomainError("REVISION_CONFLICT", "账户资料已更新，请刷新后重试。", 409)
    user.display_name = body.displayName
    profile.revision += 1
    db.add(Audit(actor_id=user.id, action="account.profile.update"))
    db.flush()
    return account_data(db, user)


@router.post("/account/trial")
def trial(body: Strict, user: CurrentUser, db: DB):
    if user.is_demo:
        raise DomainError(
            "DEMO_TRIAL_INCLUDED",
            "本地体验账户已开放完整流程，不能重复领取家庭版试用积分。",
            409,
        )
    lock_account(db, user)
    profile = ensure_profile(db, user)
    if not profile.trial_started_at:
        current = time.time()
        profile.plan_id = "family"
        profile.trial_started_at = current
        profile.trial_expires_at = current + settings.family_trial_days * 86400
        profile.revision += 1
        db.execute(
            update(CreditAccount)
            .where(CreditAccount.user_id == user.id)
            .values(available=CreditAccount.available + settings.family_trial_credits)
        )
        db.add(
            CreditLedger(
                user_id=user.id,
                event_key="family-trial:" + user.id,
                event_type="trial_grant",
                delta_available=settings.family_trial_credits,
                delta_reserved=0,
            )
        )
        db.add(Audit(actor_id=user.id, action="account.trial.start"))
        db.flush()
    db.expire_all()
    return account_data(db, user)


class Interest(Strict):
    interested: bool


@router.post("/account/professional-interest")
def interest(body: Interest, user: CurrentUser, db: DB):
    lock_account(db, user)
    profile = ensure_profile(db, user)
    profile.professional_interest = body.interested
    profile.revision += 1
    db.add(
        Audit(
            actor_id=user.id,
            action="account.professional.interest",
            detail_json={"interested": body.interested},
        )
    )
    db.flush()
    return account_data(db, user)


@router.get("/account/export")
def export_account(user: CurrentUser, db: DB):
    # Whitelist: no password/session hashes, other members' drafts or storage keys.
    owned = db.scalars(
        select(Project).where(Project.owner_id == user.id, Project.deleted == False)
    ).all()
    result = []
    for p in owned:
        w = db.get(WorkingCopy, (p.id, user.id))
        result.append(
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "archived": p.archived,
                "workingScene": w.scene_json if w else None,
                "designs": [
                    {
                        "id": d.id,
                        "title": d.title,
                        "scene": d.scene_json,
                        "createdAt": d.created_at,
                    }
                    for d in db.scalars(
                        select(DesignVersion).where(DesignVersion.project_id == p.id)
                    )
                ],
                "assets": [
                    {
                        "id": a.id,
                        "name": a.name,
                        "kind": a.kind,
                        "bytes": a.bytes,
                        "state": a.state,
                    }
                    for a in db.scalars(select(Asset).where(Asset.project_id == p.id))
                ],
                "jobs": [
                    {
                        "id": j.id,
                        "type": j.type,
                        "status": j.status,
                        "chargedCredits": j.charged_credits,
                    }
                    for j in db.scalars(
                        select(Job).where(
                            Job.project_id == p.id, Job.user_id == user.id
                        )
                    )
                ],
            }
        )
    ledger = [
        {
            "type": l.event_type,
            "deltaAvailable": l.delta_available,
            "deltaReserved": l.delta_reserved,
            "createdAt": l.created_at,
        }
        for l in db.scalars(
            select(CreditLedger)
            .where(CreditLedger.user_id == user.id)
            .order_by(CreditLedger.created_at)
        )
    ]
    return {
        "format": "jianspace-personal-data-1.0",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "user": public_user(user),
        "account": account_data(db, user),
        "ownedProjects": result,
        "ledger": ledger,
        "note": "仅包含自有未删除项目；原始媒体请在项目内单独下载。账户导出不作为场景导入文件。",
    }


class AccountDelete(Strict):
    confirmEmail: str = Field(min_length=1, max_length=254)
    password: str = Field(default="", max_length=128)


@router.delete("/account", status_code=202)
def delete_account(
    body: AccountDelete,
    response: Response,
    user: CurrentUser,
    db: DB,
):
    # Self-service account closure: revoke access immediately, keep a soft-deleted
    # project shell for the cleanup command, then anonymize the identity.
    if user.system_role == "admin":
        raise DomainError(
            "ADMIN_DELETE_BLOCKED",
            "运维管理账户不能自助注销，请由其他管理员处理。",
            409,
        )
    if body.confirmEmail.strip().lower() != user.email.lower():
        raise DomainError(
            "CONFIRM_MISMATCH", "请输入当前账户邮箱以确认注销。", 422
        )
    if not user.is_demo and not verify_password(user.password_hash, body.password):
        raise DomainError("INVALID_CREDENTIALS", "密码不正确，账户未注销。", 403)

    lock_account(db, user)
    owned_ids = list(
        db.scalars(
            select(Project.id).where(
                Project.owner_id == user.id, Project.deleted == False
            )
        ).all()
    )
    if owned_ids:
        db.execute(
            update(Project)
            .where(Project.id.in_(owned_ids))
            .values(deleted=True, updated_at=now())
        )
        db.execute(
            update(Share).where(Share.project_id.in_(owned_ids)).values(revoked=True)
        )
        db.execute(
            update(Job)
            .where(
                Job.project_id.in_(owned_ids),
                Job.status.in_(["queued", "running", "waiting_provider", "retry_wait"]),
            )
            .values(status="cancel_requested")
        )
    db.execute(delete(Member).where(Member.user_id == user.id))
    db.execute(delete(WorkingCopy).where(WorkingCopy.user_id == user.id))
    db.execute(delete(Challenge).where(Challenge.user_id == user.id))
    db.execute(
        delete(EmailVerification).where(EmailVerification.user_id == user.id)
    )
    db.execute(delete(CreditLedger).where(CreditLedger.user_id == user.id))
    db.execute(delete(CreditAccount).where(CreditAccount.user_id == user.id))
    db.execute(delete(AccountProfile).where(AccountProfile.user_id == user.id))
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.add(
        Audit(
            actor_id=user.id,
            action="account.delete",
            detail_json={"ownedProjects": len(owned_ids)},
        )
    )
    user.email = f"deleted+{user.id}@invalid"
    user.display_name = "已注销账户"
    user.password_hash = hash_password(token())
    user.status = "deleted"
    user.is_demo = False
    db.flush()
    response.delete_cookie("interior_session")
    response.delete_cookie("interior_csrf")
    return {
        "status": "deleted",
        "ownedProjects": len(owned_ids),
        "cleanupPolicy": "账户与授权立即失效；自有项目进入删除状态，媒体文件由清理命令回收。",
    }
