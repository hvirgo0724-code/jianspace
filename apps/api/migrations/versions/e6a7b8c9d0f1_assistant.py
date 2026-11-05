"""Assistant conversations, messages and human handoff tickets.

Revision ID: e6a7b8c9d0f1
Revises: d5f6a7b8c9e0
"""

from alembic import op
import sqlalchemy as sa

revision = "e6a7b8c9d0f1"
down_revision = "d5f6a7b8c9e0"
branch_labels = None
depends_on = None


def _identity():
    return [
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.String(40), nullable=False),
    ]


def upgrade():
    op.create_table(
        "assistant_conversations",
        *_identity(),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), index=True),
        sa.Column("title", sa.String(120), nullable=False),
    )
    op.create_table(
        "assistant_messages",
        *_identity(),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("assistant_conversations.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("intent", sa.String(30), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sources_json", sa.JSON(), nullable=False),
        sa.Column("actions_json", sa.JSON(), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
    )
    op.create_table(
        "assistant_handoffs",
        *_identity(),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("assistant_conversations.id"),
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id")),
        sa.Column("reason", sa.String(120), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("contact", sa.String(254), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, index=True),
        sa.Column("resolution", sa.Text(), nullable=False),
        sa.Column("transcript_json", sa.JSON(), nullable=False),
    )


def downgrade():
    op.drop_table("assistant_handoffs")
    op.drop_table("assistant_messages")
    op.drop_table("assistant_conversations")
