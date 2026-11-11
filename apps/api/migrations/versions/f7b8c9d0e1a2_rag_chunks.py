"""RAG knowledge chunks for the assistant.

Revision ID: f7b8c9d0e1a2
Revises: e6a7b8c9d0f1
"""

import sqlalchemy as sa
from alembic import op

revision = "f7b8c9d0e1a2"
down_revision = "e6a7b8c9d0f1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rag_chunks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("doc_id", sa.String(160), nullable=False, index=True),
        sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("category", sa.String(40), nullable=False, index=True),
        sa.Column("source", sa.String(200), nullable=False, server_default=""),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("keywords_json", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False, index=True),
        sa.Column(
            "embedding_provider",
            sa.String(30),
            nullable=False,
            server_default="local",
        ),
        sa.Column("embedding_model", sa.String(80), nullable=False, server_default=""),
        sa.Column("embedding_dim", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("embedding_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.UniqueConstraint("doc_id", "chunk_index"),
    )


def downgrade():
    op.drop_table("rag_chunks")
