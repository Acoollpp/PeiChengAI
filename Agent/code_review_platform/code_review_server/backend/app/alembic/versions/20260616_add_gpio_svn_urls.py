"""add gpio svn urls

Revision ID: 20260616gpio_svn
Revises: 20260615gpio01
Create Date: 2026-06-16 11:14:00.000000
"""

import sqlalchemy as sa
from alembic import op


revision = "20260616gpio_svn"
down_revision = "20260615gpio01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "gpio_generation_task",
        sa.Column("manual_svn_url", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "gpio_generation_task",
        sa.Column("code_svn_url", sa.String(length=2048), nullable=True),
    )
    op.execute("update gpio_generation_task set manual_svn_url = '' where manual_svn_url is null")
    op.execute("update gpio_generation_task set code_svn_url = '' where code_svn_url is null")
    op.alter_column("gpio_generation_task", "manual_svn_url", nullable=False)
    op.alter_column("gpio_generation_task", "code_svn_url", nullable=False)


def downgrade() -> None:
    op.drop_column("gpio_generation_task", "code_svn_url")
    op.drop_column("gpio_generation_task", "manual_svn_url")
