"""add review task pdf report

Revision ID: 20260612pdf01
Revises: 5b7c2d9e4f10
Create Date: 2026-06-12 10:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612pdf01"
down_revision = "5b7c2d9e4f10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("pdf_report_path", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column("pdf_report_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_task", "pdf_report_name")
    op.drop_column("review_task", "pdf_report_path")
