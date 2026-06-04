"""add review task user status index

Revision ID: a7c9e2f1b304
Revises: c4f8a9d2e101
Create Date: 2026-06-04 00:00:00.000000

"""

from alembic import op

revision = "a7c9e2f1b304"
down_revision = "c4f8a9d2e101"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_review_task_user_id_status",
        "review_task",
        ["user_id", "status"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_review_task_user_id_status", table_name="review_task")
