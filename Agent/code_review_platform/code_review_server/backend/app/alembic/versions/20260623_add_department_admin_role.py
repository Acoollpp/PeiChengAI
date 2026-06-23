"""add department admin role

Revision ID: 20260623deptadmin
Revises: 20260622focusadmin
Create Date: 2026-06-23 00:00:00.000000
"""

from alembic import op


revision = "20260623deptadmin"
down_revision = "20260622focusadmin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'department_admin'")


def downgrade() -> None:
    # Downgrade intentionally keeps the enum value because PostgreSQL cannot remove enum values safely without rebuilding dependent columns.
    pass
