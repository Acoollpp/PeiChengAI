"""为审查任务增加审查项 ID

Revision ID: 20260805reviewitems
Revises: 20260731updatepolicy
Create Date: 2026-08-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260805reviewitems"
down_revision: str | None = "20260731updatepolicy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column(
            "review_item_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("review_task", "review_item_ids")
