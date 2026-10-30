"""add whitebox platform

Revision ID: 20260704whitebox
Revises: 20260622gpio_drop_manual_svn
Create Date: 2026-07-04 17:30:00.000000
"""

import sqlalchemy as sa
from alembic import op


revision = "20260704whitebox"
down_revision = "20260622gpio_drop_manual_svn"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "whitebox_agent",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("machine_id", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("capabilities", sa.JSON(), nullable=True),
        sa.Column("current_task_id", sa.Uuid(), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_whitebox_agent_machine_id"), "whitebox_agent", ["machine_id"], unique=True)
    op.create_index(op.f("ix_whitebox_agent_status"), "whitebox_agent", ["status"], unique=False)
    op.create_index(op.f("ix_whitebox_agent_current_task_id"), "whitebox_agent", ["current_task_id"], unique=False)

    op.create_table(
        "whitebox_test_task",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("project_name", sa.String(length=255), nullable=False),
        sa.Column("source_url", sa.String(length=2048), nullable=False),
        sa.Column("revision", sa.String(length=255), nullable=False),
        sa.Column("test_config", sa.String(length=1024), nullable=True),
        sa.Column("status", sa.String(length=18), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=True),
        sa.Column("input_files", sa.JSON(), nullable=True),
        sa.Column("result_files", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_whitebox_test_task_user_id"), "whitebox_test_task", ["user_id"], unique=False)
    op.create_index(op.f("ix_whitebox_test_task_status"), "whitebox_test_task", ["status"], unique=False)
    op.create_index(op.f("ix_whitebox_test_task_agent_id"), "whitebox_test_task", ["agent_id"], unique=False)
    op.create_index(
        "ix_whitebox_test_task_user_id_status",
        "whitebox_test_task",
        ["user_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_whitebox_test_task_user_id_status", table_name="whitebox_test_task")
    op.drop_index(op.f("ix_whitebox_test_task_agent_id"), table_name="whitebox_test_task")
    op.drop_index(op.f("ix_whitebox_test_task_status"), table_name="whitebox_test_task")
    op.drop_index(op.f("ix_whitebox_test_task_user_id"), table_name="whitebox_test_task")
    op.drop_table("whitebox_test_task")
    op.drop_index(op.f("ix_whitebox_agent_current_task_id"), table_name="whitebox_agent")
    op.drop_index(op.f("ix_whitebox_agent_status"), table_name="whitebox_agent")
    op.drop_index(op.f("ix_whitebox_agent_machine_id"), table_name="whitebox_agent")
    op.drop_table("whitebox_agent")
