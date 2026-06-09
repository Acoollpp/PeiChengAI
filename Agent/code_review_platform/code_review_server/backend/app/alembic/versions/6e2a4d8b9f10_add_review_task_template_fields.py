"""add review task template fields

Revision ID: 6e2a4d8b9f10
Revises: 3f6b2d1a9c44
Create Date: 2026-06-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "6e2a4d8b9f10"
down_revision = "3f6b2d1a9c44"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("template_key", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column("skill_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_task", "skill_name")
    op.drop_column("review_task", "template_key")
