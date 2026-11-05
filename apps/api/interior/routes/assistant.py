from typing import Literal

from fastapi import APIRouter, Request
from pydantic import Field, field_validator
from sqlalchemy import func, select

from .. import assistant
from ..config import settings
from ..mail import send_email
from ..models import (
    AssistantConversation,
    AssistantHandoff,
    AssistantMessage,
    Audit,
    Project,
    User,
)
from ..requests import Strict
from ..security import DB, CurrentUser, DomainError, authorize, rate_limit

router = APIRouter()


class ChatIn(Strict):
    message: str = Field(min_length=1, max_length=2000)
    conversationId: str | None = None
    projectId: str | None = None

    @field_validator("message")
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("请输入问题。")
        return value


def owned_conversation(db, user, conversation_id):
    conversation = db.get(AssistantConversation, conversation_id)
    if not conversation or conversation.user_id != user.id:
        raise DomainError("CONVERSATION_NOT_FOUND", "对话不存在。", 404)
    if conversation.project_id:
        authorize(db, user, conversation.project_id)
    return conversation


def history_for(db, conversation_id, limit=12):
    rows = list(
        db.scalars(
            select(AssistantMessage)
            .where(AssistantMessage.conversation_id == conversation_id)
            .order_by(AssistantMessage.seq.desc())
            .limit(limit)
        )
    )
    return [{"role": row.role, "content": row.content} for row in reversed(rows)]


def next_seq(db, conversation_id):
    return (
        db.scalar(
            select(func.max(AssistantMessage.seq)).where(
                AssistantMessage.conversation_id == conversation_id
            )
        )
        or 0
    ) + 1


@router.post("/assistant/chat")
def chat(body: ChatIn, request: Request, user: CurrentUser, db: DB):
    rate_limit("assistant:" + request.client.host, 60, 300)
    conversation = None
    if body.conversationId:
        conversation = owned_conversation(db, user, body.conversationId)
        project_id = conversation.project_id
    else:
        project_id = body.projectId
        if project_id:
            authorize(db, user, project_id)
        conversation = AssistantConversation(
            user_id=user.id,
            project_id=project_id,
            title=body.message[:40],
        )
        db.add(conversation)
        db.flush()
    brief = assistant.project_brief(db, user, project_id)
    result = assistant.answer(body.message, brief, history_for(db, conversation.id))
    seq = next_seq(db, conversation.id)
    db.add(
        AssistantMessage(
            conversation_id=conversation.id,
            role="user",
            content=body.message,
            intent=result["intent"],
            seq=seq,
            mode=result["mode"],
        )
    )
    reply = AssistantMessage(
        conversation_id=conversation.id,
        role="assistant",
        content=result["content"],
        intent=result["intent"],
        seq=seq + 1,
        sources_json=result["sources"],
        actions_json=result["actions"],
        mode=result["mode"],
    )
    db.add(reply)
    db.flush()
    return {
        "conversationId": conversation.id,
        "mode": result["mode"],
        "handoffSuggested": result["handoffSuggested"],
        "message": assistant.message_view(reply),
    }


@router.get("/assistant/conversations/{conversation_id}")
def conversation(conversation_id: str, user: CurrentUser, db: DB):
    conversation = owned_conversation(db, user, conversation_id)
    rows = list(
        db.scalars(
            select(AssistantMessage)
            .where(AssistantMessage.conversation_id == conversation.id)
            .order_by(AssistantMessage.seq)
            .limit(100)
        )
    )
    return {
        "conversation": assistant.conversation_brief(conversation),
        "messages": [assistant.message_view(row) for row in rows],
    }


class HandoffIn(Strict):
    conversationId: str | None = None
    projectId: str | None = None
    reason: str = Field(min_length=2, max_length=120)
    detail: str = Field(default="", max_length=2000)
    contact: str = Field(default="", max_length=254)


def transcript_for(db, conversation_id):
    if not conversation_id:
        return []
    rows = list(
        db.scalars(
            select(AssistantMessage)
            .where(AssistantMessage.conversation_id == conversation_id)
            .order_by(AssistantMessage.seq.desc())
            .limit(20)
        )
    )
    return [
        {"role": row.role, "content": row.content[:2000]} for row in reversed(rows)
    ]


@router.post("/assistant/handoffs", status_code=201)
def create_handoff(body: HandoffIn, request: Request, user: CurrentUser, db: DB):
    rate_limit("assistant-handoff:" + request.client.host, 5, 3600)
    conversation = None
    if body.conversationId:
        conversation = owned_conversation(db, user, body.conversationId)
    project_id = conversation.project_id if conversation else body.projectId
    project = None
    if project_id:
        project = authorize(db, user, project_id)
    contact = body.contact.strip() or user.email
    row = AssistantHandoff(
        conversation_id=conversation.id if conversation else None,
        user_id=user.id,
        project_id=project_id,
        reason=body.reason.strip(),
        detail=body.detail.strip(),
        contact=contact,
        transcript_json=transcript_for(db, conversation.id if conversation else None),
    )
    db.add(row)
    db.flush()
    db.add(
        Audit(
            actor_id=user.id,
            project_id=project_id,
            action="assistant.handoff",
            detail_json={"handoffId": row.id, "reason": row.reason},
        )
    )
    notified = False
    if settings.support_email and settings.smtp_host:
        lines = [
            f"工单：{row.id}",
            f"用户：{user.email}",
            f"联系方式：{contact}",
            f"项目：{project.name if project else '无'}",
            f"原因：{row.reason}",
            f"说明：{row.detail or '无'}",
            "",
            "对话记录：",
        ]
        lines.extend(
            f"{item['role']}: {item['content']}" for item in row.transcript_json
        )
        try:
            send_email(
                settings.support_email,
                "筑见 · 新的转人工工单",
                "\n".join(lines),
            )
            notified = True
        except DomainError:
            notified = False
    return {
        "id": row.id,
        "status": row.status,
        "notified": notified,
        "createdAt": row.created_at,
    }


def handoff_view(row):
    return {
        "id": row.id,
        "reason": row.reason,
        "detail": row.detail,
        "status": row.status,
        "resolution": row.resolution,
        "projectId": row.project_id,
        "createdAt": row.created_at,
    }


@router.get("/assistant/handoffs")
def my_handoffs(user: CurrentUser, db: DB):
    rows = db.scalars(
        select(AssistantHandoff)
        .where(AssistantHandoff.user_id == user.id)
        .order_by(AssistantHandoff.created_at.desc())
        .limit(20)
    )
    return {"items": [handoff_view(row) for row in rows]}


class HandoffPatch(Strict):
    status: Literal["pending", "in_progress", "resolved"]
    resolution: str = Field(default="", max_length=2000)


def require_admin(user):
    if user.system_role != "admin":
        raise DomainError("FORBIDDEN", "需要运维管理员权限。", 403)


@router.get("/admin/assistant/handoffs")
def admin_handoffs(user: CurrentUser, db: DB, status: str | None = None):
    require_admin(user)
    query = select(AssistantHandoff)
    if status:
        query = query.where(AssistantHandoff.status == status)
    rows = db.scalars(
        query.order_by(AssistantHandoff.created_at.desc()).limit(100)
    )
    return {
        "items": [
            {
                **handoff_view(row),
                "userEmail": (db.get(User, row.user_id).email if db.get(User, row.user_id) else ""),
                "projectName": (
                    db.get(Project, row.project_id).name
                    if row.project_id and db.get(Project, row.project_id)
                    else ""
                ),
                "transcript": row.transcript_json,
            }
            for row in rows
        ]
    }


@router.patch("/admin/assistant/handoffs/{handoff_id}")
def resolve_handoff(
    handoff_id: str, body: HandoffPatch, user: CurrentUser, db: DB
):
    require_admin(user)
    row = db.get(AssistantHandoff, handoff_id)
    if not row:
        raise DomainError("HANDOFF_NOT_FOUND", "工单不存在。", 404)
    row.status = body.status
    if body.resolution.strip():
        row.resolution = body.resolution.strip()
        if row.conversation_id:
            db.add(
                AssistantMessage(
                    conversation_id=row.conversation_id,
                    role="assistant",
                    content="【人工客服】" + row.resolution,
                    intent="handoff",
                    seq=next_seq(db, row.conversation_id),
                    mode="human",
                )
            )
    db.add(
        Audit(
            actor_id=user.id,
            project_id=row.project_id,
            action="assistant.handoff.update",
            detail_json={"handoffId": row.id, "status": row.status},
        )
    )
    return handoff_view(row)
