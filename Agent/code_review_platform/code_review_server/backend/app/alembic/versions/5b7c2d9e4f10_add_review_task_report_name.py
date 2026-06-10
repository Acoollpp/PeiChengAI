"""add review task report name

Revision ID: 5b7c2d9e4f10
Revises: 4e9c1d7b2a65, 6e2a4d8b9f10
Create Date: 2026-06-10 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


revision = "5b7c2d9e4f10"
down_revision = ("4e9c1d7b2a65", "6e2a4d8b9f10")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("report_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_task", "report_name")
