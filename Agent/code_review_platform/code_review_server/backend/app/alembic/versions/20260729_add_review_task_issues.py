"""新增逐问题反馈协议和审查问题快照

Revision ID: 20260729taskissues
Revises: 20260703reportfeedback
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260729taskissues"
down_revision: str | None = "20260703reportfeedback"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("feedback_protocol_version", sa.Integer(), nullable=True),
    )
    op.create_table(
        "review_task_issue",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("issue_text", sa.Text(), nullable=False),
        sa.Column("description_text", sa.Text(), nullable=False),
        sa.Column("display_snapshot", sa.Text(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("location", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("helpful", sa.Boolean(), nullable=True),
        sa.Column("feedback_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["task_id"], ["review_task.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id", "order", name="uq_review_task_issue_task_order"
        ),
    )
    op.create_index(
        op.f("ix_review_task_issue_task_id"),
        "review_task_issue",
        ["task_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_task_issue_helpful"),
        "review_task_issue",
        ["helpful"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_review_task_issue_helpful"), table_name="review_task_issue")
    op.drop_index(op.f("ix_review_task_issue_task_id"), table_name="review_task_issue")
    op.drop_table("review_task_issue")
    op.drop_column("review_task", "feedback_protocol_version")
