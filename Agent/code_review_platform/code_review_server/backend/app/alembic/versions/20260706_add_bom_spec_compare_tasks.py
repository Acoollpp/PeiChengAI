"""add bom spec compare tasks

Revision ID: 20260706bomspec
Revises: 20260704whitebox
Create Date: 2026-07-06 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


revision = "20260706bomspec"
down_revision = "20260704whitebox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bom_spec_compare_task",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("status", sa.Enum(
            "created",
            "queued",
            "preparing",
            "running",
            "uploading_report",
            "success",
            "failed",
            "timeout",
            "cancelled",
            name="bomspeccomparetaskstatus",
        ), nullable=False),
        sa.Column("input_files", sa.JSON(), nullable=True),
        sa.Column("result_files", sa.JSON(), nullable=True),
        sa.Column("project_count", sa.Integer(), nullable=False),
        sa.Column("success_count", sa.Integer(), nullable=False),
        sa.Column("consistent_count", sa.Integer(), nullable=False),
        sa.Column("different_count", sa.Integer(), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_bom_spec_compare_task_user_id",
        "bom_spec_compare_task",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_bom_spec_compare_task_status",
        "bom_spec_compare_task",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_bom_spec_compare_task_user_id_status",
        "bom_spec_compare_task",
        ["user_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_bom_spec_compare_task_user_id_status", table_name="bom_spec_compare_task")
    op.drop_index("ix_bom_spec_compare_task_status", table_name="bom_spec_compare_task")
    op.drop_index("ix_bom_spec_compare_task_user_id", table_name="bom_spec_compare_task")
    op.drop_table("bom_spec_compare_task")
    op.execute("DROP TYPE IF EXISTS bomspeccomparetaskstatus")
