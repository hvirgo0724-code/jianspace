"""Account plans and one-time trial state.

Revision ID: c4e21a08b6f1
Revises: b2bab41d6ad8
"""

from alembic import op
import sqlalchemy as sa

revision = "c4e21a08b6f1"
down_revision = "b2bab41d6ad8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account_profiles",
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("app_users.id"), primary_key=True
        ),
        sa.Column("plan_id", sa.String(24), nullable=False),
        sa.Column("trial_started_at", sa.Float()),
        sa.Column("trial_expires_at", sa.Float()),
        sa.Column("professional_interest", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
    )


def downgrade():
    op.drop_table("account_profiles")
