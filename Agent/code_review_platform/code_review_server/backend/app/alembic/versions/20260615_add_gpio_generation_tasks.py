"""add gpio generation tasks

Revision ID: 20260615gpio01
Revises: 20260612pdf01
Create Date: 2026-06-15 17:30:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "20260615gpio01"
down_revision = "20260612pdf01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gpio_generation_task",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column(
            "uploaded_files",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "recognition_summary",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("result_path", sa.String(length=2048), nullable=True),
        sa.Column("result_name", sa.String(length=255), nullable=True),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_gpio_generation_task_user_id",
        "gpio_generation_task",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_gpio_generation_task_status",
        "gpio_generation_task",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_gpio_generation_task_user_id_status",
        "gpio_generation_task",
        ["user_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gpio_generation_task_user_id_status",
        table_name="gpio_generation_task",
    )
    op.drop_index("ix_gpio_generation_task_status", table_name="gpio_generation_task")
    op.drop_index("ix_gpio_generation_task_user_id", table_name="gpio_generation_task")
    op.drop_table("gpio_generation_task")
