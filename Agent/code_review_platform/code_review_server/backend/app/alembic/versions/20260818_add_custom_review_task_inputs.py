"""为审查任务增加自定义审查输入快照

Revision ID: 20260818customreview
Revises: 20260805reviewitems
Create Date: 2026-08-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260818customreview"
down_revision: str | None = "20260805reviewitems"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("custom_review_rule", sa.String(length=1200), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column("custom_review_mode", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column("has_custom_review_word_material", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column("has_custom_review_excel_material", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column("has_custom_review_pdf_material", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_task", "has_custom_review_pdf_material")
    op.drop_column("review_task", "has_custom_review_excel_material")
    op.drop_column("review_task", "has_custom_review_word_material")
    op.drop_column("review_task", "custom_review_mode")
    op.drop_column("review_task", "custom_review_rule")
