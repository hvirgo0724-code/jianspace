"""Email verification records.

Revision ID: d5f6a7b8c9e0
Revises: c4e21a08b6f1
"""

from alembic import op
import sqlalchemy as sa

revision = "d5f6a7b8c9e0"
down_revision = "c4e21a08b6f1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "email_verifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("verified_at", sa.Float(), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    op.create_index(
        "ix_email_verifications_user_id", "email_verifications", ["user_id"]
    )


def downgrade():
    op.drop_index("ix_email_verifications_user_id", table_name="email_verifications")
    op.drop_table("email_verifications")
