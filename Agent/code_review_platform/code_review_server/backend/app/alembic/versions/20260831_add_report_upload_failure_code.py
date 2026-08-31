"""add report upload failure code

Revision ID: 20260831uploadfailure
Revises: 20260818customreview
Create Date: 2026-08-31
"""

import sqlalchemy as sa
from alembic import op

revision: str = "20260831uploadfailure"
down_revision: str | None = "20260818customreview"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("report_upload_failure_code", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_task", "report_upload_failure_code")
