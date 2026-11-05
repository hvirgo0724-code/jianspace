import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Integer,
    BigInteger,
    Boolean,
    ForeignKey,
    JSON,
    Text,
    Float,
    UniqueConstraint,
    CheckConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from .database import Base


def uid():
    return str(uuid.uuid4())


def now():
    return datetime.now(timezone.utc).isoformat()


J = JSON().with_variant(JSONB(), "postgresql")


class Identity:
    id = Column(String(36), primary_key=True, default=uid)
    created_at = Column(String(40), nullable=False, default=now)


class User(Identity, Base):
    __tablename__ = "app_users"
    email = Column(String(254), nullable=False, unique=True)
    display_name = Column(String(80), nullable=False)
    password_hash = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="active")
    system_role = Column(String(20), nullable=False, default="user")
    is_demo = Column(Boolean, nullable=False, default=False)


class UserSession(Identity, Base):
    __tablename__ = "user_sessions"
    user_id = Column(String(36), ForeignKey("app_users.id"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    csrf_hash = Column(String(64), nullable=False)
    expires_epoch = Column(Float, nullable=False)


class AccountProfile(Base):
    __tablename__ = "account_profiles"
    user_id = Column(String(36), ForeignKey("app_users.id"), primary_key=True)
    plan_id = Column(String(24), nullable=False, default="free")
    trial_started_at = Column(Float)
    trial_expires_at = Column(Float)
    professional_interest = Column(Boolean, nullable=False, default=False)
    revision = Column(Integer, nullable=False, default=0)


class Challenge(Identity, Base):
    __tablename__ = "auth_challenges"
    user_id = Column(String(36), ForeignKey("app_users.id"), nullable=False)
    purpose = Column(String(30), nullable=False)
    token_hash = Column(String(64), unique=True, nullable=False)
    expires_epoch = Column(Float, nullable=False)
    consumed = Column(Boolean, nullable=False, default=False)


class EmailVerification(Identity, Base):
    __tablename__ = "email_verifications"
    user_id = Column(
        String(36), ForeignKey("app_users.id"), unique=True, nullable=False, index=True
    )
    verified_at = Column(Float, nullable=False)


class Project(Identity, Base):
    __tablename__ = "projects"
    owner_id = Column(
        String(36), ForeignKey("app_users.id"), nullable=False, index=True
    )
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=False, default="")
    revision = Column(Integer, nullable=False, default=0)
    current_geometry_id = Column(String(36))
    current_design_id = Column(String(36))
    updated_at = Column(String(40), nullable=False, default=now)
    archived = Column(Boolean, nullable=False, default=False)
    deleted = Column(Boolean, nullable=False, default=False)


class Member(Base):
    __tablename__ = "project_members"
    project_id = Column(String(36), ForeignKey("projects.id"), primary_key=True)
    user_id = Column(String(36), ForeignKey("app_users.id"), primary_key=True)
    role = Column(String(16), nullable=False)


class WorkingCopy(Base):
    __tablename__ = "project_working_copies"
    project_id = Column(String(36), ForeignKey("projects.id"), primary_key=True)
    user_id = Column(String(36), ForeignKey("app_users.id"), primary_key=True)
    scene_json = Column(J, nullable=False)
    revision = Column(Integer, nullable=False, default=0)
    base_design_id = Column(String(36))
    updated_at = Column(String(40), nullable=False, default=now)


class MeasurementBatch(Identity, Base):
    __tablename__ = "measurement_batches"
    project_id = Column(
        String(36), ForeignKey("projects.id"), nullable=False, index=True
    )
    user_id = Column(String(36), ForeignKey("app_users.id"), nullable=False)
    records_json = Column(J, nullable=False)
    source_asset_ids = Column(J, nullable=False, default=list)


class GeometryVersion(Identity, Base):
    __tablename__ = "geometry_versions"
    project_id = Column(
        String(36), ForeignKey("projects.id"), nullable=False, index=True
    )
    version_no = Column(Integer, nullable=False)
    scene_json = Column(J, nullable=False)
    structure_hash = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, default="draft")
    validation_json = Column(J, nullable=False)
    confirmed_by = Column(String(36), ForeignKey("app_users.id"))
    confirmed_at = Column(String(40))
    __table_args__ = (UniqueConstraint("project_id", "version_no"),)


class DesignVersion(Identity, Base):
    __tablename__ = "design_versions"
    project_id = Column(
        String(36), ForeignKey("projects.id"), nullable=False, index=True
    )
    geometry_version_id = Column(
        String(36), ForeignKey("geometry_versions.id"), nullable=False
    )
    parent_id = Column(String(36), ForeignKey("design_versions.id"))
    title = Column(String(120), nullable=False)
    scene_json = Column(J, nullable=False)
    scene_hash = Column(String(64), nullable=False)
    creator_id = Column(String(36), ForeignKey("app_users.id"), nullable=False)


class Asset(Identity, Base):
    __tablename__ = "project_assets"
    project_id = Column(
        String(36), ForeignKey("projects.id"), nullable=False, index=True
    )
    uploader_id = Column(String(36), ForeignKey("app_users.id"), nullable=False)
    name = Column(String(255), nullable=False)
    object_key = Column(String(255), unique=True, nullable=False)
    kind = Column(String(30), nullable=False)
    media_type = Column(String(100), nullable=False)
    bytes = Column(BigInteger, nullable=False, default=0)
    sha256 = Column(String(64), nullable=False, default="")
    state = Column(String(20), nullable=False, default="ready")
    room_id = Column(String(100))
    metadata_json = Column(J, nullable=False, default=dict)


class Job(Identity, Base):
    __tablename__ = "generation_jobs"
    project_id = Column(
        String(36), ForeignKey("projects.id"), nullable=False, index=True
    )
    user_id = Column(String(36), ForeignKey("app_users.id"), nullable=False)
    type = Column(String(30), nullable=False)
    status = Column(String(30), nullable=False, default="queued", index=True)
    stage = Column(String(60), nullable=False, default="queued")
    input_json = Column(J, nullable=False)
    input_hash = Column(String(64), nullable=False)
    progress = Column(Integer, nullable=False, default=0)
    lease_until = Column(Float)
    attempts = Column(Integer, nullable=False, default=0)
    reserved_credits = Column(Integer, nullable=False, default=0)
    charged_credits = Column(Integer, nullable=False, default=0)
    error_code = Column(String(60))
    error_message = Column(Text)
    output_json = Column(J, nullable=False, default=dict)
    provider_task_id = Column(String(100))
    finished_at = Column(String(40))


class Outbox(Identity, Base):
    __tablename__ = "outbox_events"
    job_id = Column(
        String(36), ForeignKey("generation_jobs.id"), nullable=False, unique=True
    )
    published = Column(Boolean, nullable=False, default=False)


class CreditAccount(Base):
    __tablename__ = "credit_accounts"
    user_id = Column(String(36), ForeignKey("app_users.id"), primary_key=True)
    available = Column(Integer, nullable=False, default=0)
    reserved = Column(Integer, nullable=False, default=0)
    __table_args__ = (
        CheckConstraint("available >= 0"),
        CheckConstraint("reserved >= 0"),
    )


class CreditLedger(Identity, Base):
    __tablename__ = "credit_ledger"
    user_id = Column(String(36), ForeignKey("app_users.id"), nullable=False, index=True)
    job_id = Column(String(36), ForeignKey("generation_jobs.id"))
    event_key = Column(String(160), nullable=False, unique=True)
    event_type = Column(String(30), nullable=False)
    delta_available = Column(Integer, nullable=False)
    delta_reserved = Column(Integer, nullable=False)


class Idempotency(Base):
    __tablename__ = "idempotency_records"
    user_id = Column(String(36), ForeignKey("app_users.id"), primary_key=True)
    route = Column(String(180), primary_key=True)
    key = Column(String(128), primary_key=True)
    request_hash = Column(String(64), nullable=False)
    response_json = Column(J, nullable=False)


class Budget(Identity, Base):
    __tablename__ = "budget_snapshots"
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    design_id = Column(String(36), ForeignKey("design_versions.id"), nullable=False)
    currency = Column(String(3), nullable=False, default="CNY")
    lines_json = Column(J, nullable=False)
    subtotal_minor = Column(BigInteger, nullable=False)
    assumptions_json = Column(J, nullable=False)


class Share(Identity, Base):
    __tablename__ = "share_links"
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    design_id = Column(String(36), ForeignKey("design_versions.id"), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    expires_epoch = Column(Float, nullable=False)
    revoked = Column(Boolean, nullable=False, default=False)
    include_budget = Column(Boolean, nullable=False, default=False)


class Comment(Identity, Base):
    __tablename__ = "design_comments"
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    design_id = Column(String(36), ForeignKey("design_versions.id"), nullable=False)
    author_id = Column(String(36), ForeignKey("app_users.id"), nullable=False)
    body = Column(Text, nullable=False)
    room_id = Column(String(100))
    object_id = Column(String(100))
    deleted = Column(Boolean, nullable=False, default=False)


class Approval(Identity, Base):
    __tablename__ = "design_approvals"
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    design_id = Column(String(36), ForeignKey("design_versions.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("app_users.id"), nullable=False)
    decision = Column(String(30), nullable=False)
    note = Column(Text, nullable=False, default="")
    __table_args__ = (UniqueConstraint("design_id", "user_id"),)


class SupportReport(Identity, Base):
    __tablename__ = "support_reports"
    project_id = Column(String(36), ForeignKey("projects.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("app_users.id"), nullable=False)
    category = Column(String(60), nullable=False)
    description = Column(Text, nullable=False)


class AssistantConversation(Identity, Base):
    __tablename__ = "assistant_conversations"
    user_id = Column(String(36), ForeignKey("app_users.id"), nullable=False, index=True)
    project_id = Column(String(36), ForeignKey("projects.id"), index=True)
    title = Column(String(120), nullable=False, default="新对话")


class AssistantMessage(Identity, Base):
    __tablename__ = "assistant_messages"
    conversation_id = Column(
        String(36), ForeignKey("assistant_conversations.id"), nullable=False, index=True
    )
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    intent = Column(String(30), nullable=False, default="chat")
    seq = Column(Integer, nullable=False, default=0)
    sources_json = Column(J, nullable=False, default=list)
    actions_json = Column(J, nullable=False, default=list)
    mode = Column(String(20), nullable=False, default="rules")


class AssistantHandoff(Identity, Base):
    __tablename__ = "assistant_handoffs"
    conversation_id = Column(
        String(36), ForeignKey("assistant_conversations.id"), index=True
    )
    user_id = Column(String(36), ForeignKey("app_users.id"), nullable=False, index=True)
    project_id = Column(String(36), ForeignKey("projects.id"))
    reason = Column(String(120), nullable=False)
    detail = Column(Text, nullable=False, default="")
    contact = Column(String(254), nullable=False, default="")
    status = Column(String(20), nullable=False, default="pending", index=True)
    resolution = Column(Text, nullable=False, default="")
    transcript_json = Column(J, nullable=False, default=list)


class Audit(Identity, Base):
    __tablename__ = "audit_events"
    actor_id = Column(String(36), ForeignKey("app_users.id"))
    project_id = Column(String(36), ForeignKey("projects.id"))
    action = Column(String(80), nullable=False)
    detail_json = Column(J, nullable=False, default=dict)
