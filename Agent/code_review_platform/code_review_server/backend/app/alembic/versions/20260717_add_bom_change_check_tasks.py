"""add bom change check tasks

Revision ID: 20260717_bom_change_check
Revises: 20260706bomspec
Create Date: 2026-07-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260717_bom_change_check"
down_revision: str | None = "20260706bomspec"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bom_change_check_task",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("input_files", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("result_files", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("change_order_abnormal_count", sa.Integer(), nullable=False),
        sa.Column("bom_diff_abnormal_count", sa.Integer(), nullable=False),
        sa.Column("replacement_abnormal_count", sa.Integer(), nullable=False),
        sa.Column("customer_restriction_abnormal_count", sa.Integer(), nullable=False),
        sa.Column("manual_review_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_bom_change_check_task_user_id",
        "bom_change_check_task",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_bom_change_check_task_status",
        "bom_change_check_task",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_bom_change_check_task_user_id_status",
        "bom_change_check_task",
        ["user_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_bom_change_check_task_user_id_status", table_name="bom_change_check_task")
    op.drop_index("ix_bom_change_check_task_status", table_name="bom_change_check_task")
    op.drop_index("ix_bom_change_check_task_user_id", table_name="bom_change_check_task")
    op.drop_table("bom_change_check_task")
