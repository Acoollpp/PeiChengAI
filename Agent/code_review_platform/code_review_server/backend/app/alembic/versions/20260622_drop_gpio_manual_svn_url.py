"""drop gpio manual svn url

Revision ID: 20260622gpio_drop_manual_svn
Revises: 20260622gpio_platform
Create Date: 2026-06-22 14:20:00.000000
"""

import sqlalchemy as sa
from alembic import op


revision = "20260622gpio_drop_manual_svn"
down_revision = "20260622gpio_platform"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("gpio_generation_task", "manual_svn_url")


def downgrade() -> None:
    op.add_column(
        "gpio_generation_task",
        sa.Column("manual_svn_url", sa.String(length=2048), nullable=False, server_default=""),
    )
    op.alter_column("gpio_generation_task", "manual_svn_url", server_default=None)
