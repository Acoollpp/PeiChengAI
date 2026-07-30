"""新增逐问题反馈草稿提交时间

Revision ID: 20260729issuedrafts
Revises: 20260729taskissues
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729issuedrafts"
down_revision: str | None = "20260729taskissues"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("feedback_submitted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_task", "feedback_submitted_at")
