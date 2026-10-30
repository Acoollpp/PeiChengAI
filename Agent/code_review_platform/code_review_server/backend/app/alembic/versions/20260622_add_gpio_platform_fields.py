"""add gpio platform fields

Revision ID: 20260622gpio_platform
Revises: 20260616gpio_svn
Create Date: 2026-06-22 10:50:00.000000
"""

import sqlalchemy as sa
from alembic import op


revision = "20260622gpio_platform"
down_revision = "20260616gpio_svn"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "gpio_generation_task",
        sa.Column("project_no", sa.String(length=255), nullable=False, server_default=""),
    )
    op.add_column(
        "gpio_generation_task",
        sa.Column("chip_model", sa.String(length=255), nullable=False, server_default=""),
    )
    op.add_column(
        "gpio_generation_task",
        sa.Column("package_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "gpio_generation_task",
        sa.Column("manual_file_path", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "gpio_generation_task",
        sa.Column("manual_file_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "gpio_generation_task",
        sa.Column("code_revision", sa.String(length=255), nullable=False, server_default=""),
    )
    op.add_column(
        "gpio_generation_task",
        sa.Column("svn_export_path", sa.String(length=2048), nullable=True),
    )
    op.alter_column("gpio_generation_task", "project_no", server_default=None)
    op.alter_column("gpio_generation_task", "chip_model", server_default=None)
    op.alter_column("gpio_generation_task", "code_revision", server_default=None)


def downgrade() -> None:
    op.drop_column("gpio_generation_task", "svn_export_path")
    op.drop_column("gpio_generation_task", "code_revision")
    op.drop_column("gpio_generation_task", "manual_file_name")
    op.drop_column("gpio_generation_task", "manual_file_path")
    op.drop_column("gpio_generation_task", "package_name")
    op.drop_column("gpio_generation_task", "chip_model")
    op.drop_column("gpio_generation_task", "project_no")
