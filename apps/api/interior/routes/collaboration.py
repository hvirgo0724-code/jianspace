import time
from fastapi import APIRouter
from sqlalchemy import select
from ..security import DB, CurrentUser, authorize, DomainError, token, digest
from ..models import (
    Budget,
    DesignVersion,
    Share,
    Project,
    Comment,
    Approval,
    Member,
    User,
)
from ..requests import BudgetCreate, ShareCreate, CommentCreate, Strict
from ..catalog import budget_for
from .projects import assert_owned, dview

router = APIRouter()


@router.post("/projects/{project_id}/budgets", status_code=201)
def budget(project_id: str, body: BudgetCreate, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    d = assert_owned(DesignVersion, db, body.designId, project_id)
    b = budget_for(d.scene_json)
    obj = Budget(
        project_id=project_id,
        design_id=d.id,
        lines_json=b["lines"],
        subtotal_minor=b["knownSubtotalMinor"],
        assumptions_json=b["assumptions"],
    )
    db.add(obj)
    db.flush()
    return {"id": obj.id, "designId": d.id, **b}


@router.get("/projects/{project_id}/designs/{design_id}/budget")
def get_budget(project_id: str, design_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return budget_for(assert_owned(DesignVersion, db, design_id, project_id).scene_json)


@router.post("/projects/{project_id}/shares", status_code=201)
def share(project_id: str, body: ShareCreate, user: CurrentUser, db: DB):
    authorize(db, user, project_id, write=True)
    assert_owned(DesignVersion, db, body.designId, project_id)
    raw = token()
    s = Share(
        project_id=project_id,
        design_id=body.designId,
        token_hash=digest(raw),
        expires_epoch=time.time() + body.expiresInHours * 3600,
        include_budget=body.includeBudget,
    )
    db.add(s)
    db.flush()
    return {
        "id": s.id,
        "path": f"/share/{raw}",
        "expiresAt": s.expires_epoch,
        "designId": s.design_id,
    }


@router.get("/projects/{project_id}/shares")
def shares(project_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return {
        "items": [
            {
                "id": s.id,
                "designId": s.design_id,
                "revoked": s.revoked,
                "expiresAt": s.expires_epoch,
            }
            for s in db.scalars(select(Share).where(Share.project_id == project_id))
        ]
    }


@router.delete("/shares/{share_id}", status_code=204)
def revoke(share_id: str, user: CurrentUser, db: DB):
    s = db.get(Share, share_id)
    if not s:
        raise DomainError("SHARE_NOT_FOUND", "分享不存在。", 404)
    authorize(db, user, s.project_id, write=True)
    s.revoked = True


@router.get("/public/shares/{share_token}")
def public(share_token: str, db: DB):
    s = db.scalar(select(Share).where(Share.token_hash == digest(share_token)))
    p = db.get(Project, s.project_id) if s else None
    if not s or s.revoked or s.expires_epoch < time.time() or not p or p.deleted:
        raise DomainError("SHARE_EXPIRED", "链接已过期或被撤销。", 404)
    d = db.get(DesignVersion, s.design_id)
    return {
        "projectName": p.name,
        "design": dview(d),
        "budget": budget_for(d.scene_json) if s.include_budget else None,
        "readOnly": True,
    }


@router.get("/projects/{project_id}/comments")
def comments(project_id: str, user: CurrentUser, db: DB, designId: str):
    authorize(db, user, project_id)
    assert_owned(DesignVersion, db, designId, project_id)
    return {
        "items": [
            {
                "id": c.id,
                "body": c.body,
                "authorId": c.author_id,
                "createdAt": c.created_at,
                "roomId": c.room_id,
                "objectId": c.object_id,
            }
            for c in db.scalars(
                select(Comment)
                .where(
                    Comment.project_id == project_id,
                    Comment.design_id == designId,
                    Comment.deleted == False,
                )
                .order_by(Comment.created_at)
            )
        ]
    }


@router.post("/projects/{project_id}/comments", status_code=201)
def add_comment(project_id: str, body: CommentCreate, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    assert_owned(DesignVersion, db, body.designId, project_id)
    c = Comment(
        project_id=project_id,
        design_id=body.designId,
        author_id=user.id,
        body=body.body,
        room_id=body.roomId,
        object_id=body.objectId,
    )
    db.add(c)
    db.flush()
    return {"id": c.id}


class ApprovalBody(Strict):
    designId: str
    decision: str
    note: str = ""


@router.post("/projects/{project_id}/approvals")
def approve(project_id: str, body: ApprovalBody, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    assert_owned(DesignVersion, db, body.designId, project_id)
    if body.decision not in ("approved", "changes_requested"):
        raise DomainError("INVALID_DECISION", "请选择通过或要求调整。")
    a = db.scalar(
        select(Approval).where(
            Approval.design_id == body.designId, Approval.user_id == user.id
        )
    )
    if not a:
        a = Approval(project_id=project_id, design_id=body.designId, user_id=user.id)
        db.add(a)
    a.decision = body.decision
    a.note = body.note[:2000]
    db.flush()
    return {"id": a.id, "decision": a.decision}


class MemberBody(Strict):
    email: str
    role: str


@router.get("/projects/{project_id}/members")
def members(project_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id)
    return {
        "items": [
            {
                "userId": u.id,
                "displayName": u.display_name,
                "email": u.email,
                "role": m.role,
            }
            for m, u in db.execute(
                select(Member, User)
                .join(User, User.id == Member.user_id)
                .where(Member.project_id == project_id)
            )
        ]
    }


@router.post("/projects/{project_id}/members", status_code=201)
def add_member(project_id: str, body: MemberBody, user: CurrentUser, db: DB):
    authorize(db, user, project_id, owner=True)
    if body.role not in ("editor", "viewer"):
        raise DomainError("INVALID_ROLE", "可添加编辑者或查看者。")
    u = db.scalar(
        select(User).where(
            User.email == body.email.lower().strip(), User.status == "active"
        )
    )
    if not u:
        raise DomainError("USER_NOT_FOUND", "该邮箱尚未注册。", 404)
    m = db.get(Member, (project_id, u.id))
    if m and m.role == "owner":
        raise DomainError("OWNER_PROTECTED", "不能修改项目所有者。")
    if not m:
        m = Member(project_id=project_id, user_id=u.id)
        db.add(m)
    m.role = body.role
    return {"userId": u.id, "role": m.role}


@router.delete("/projects/{project_id}/members/{member_id}", status_code=204)
def remove_member(project_id: str, member_id: str, user: CurrentUser, db: DB):
    authorize(db, user, project_id, owner=True)
    m = db.get(Member, (project_id, member_id))
    if m and m.role == "owner":
        raise DomainError("OWNER_PROTECTED", "不能移除项目所有者。")
    if m:
        db.delete(m)
