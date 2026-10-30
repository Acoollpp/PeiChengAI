"""add bom electronic edit tasks

Revision ID: 20260730_bom_electronic_edit
Revises: 20260717_bom_change_check
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260730_bom_electronic_edit"
down_revision: str | None = "20260717_bom_change_check"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bom_electronic_edit_task",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("input_files", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("result_files", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("modified_count", sa.Integer(), nullable=False),
        sa.Column("abnormal_count", sa.Integer(), nullable=False),
        sa.Column("report_count", sa.Integer(), nullable=False),
        sa.Column("processed_sheet_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_bom_electronic_edit_task_user_id",
        "bom_electronic_edit_task",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_bom_electronic_edit_task_status",
        "bom_electronic_edit_task",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_bom_electronic_edit_task_user_id_status",
        "bom_electronic_edit_task",
        ["user_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bom_electronic_edit_task_user_id_status",
        table_name="bom_electronic_edit_task",
    )
    op.drop_index("ix_bom_electronic_edit_task_status", table_name="bom_electronic_edit_task")
    op.drop_index("ix_bom_electronic_edit_task_user_id", table_name="bom_electronic_edit_task")
    op.drop_table("bom_electronic_edit_task")
