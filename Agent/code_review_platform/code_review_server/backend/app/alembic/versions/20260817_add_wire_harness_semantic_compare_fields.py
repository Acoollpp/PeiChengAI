"""add semantic comparison fields to wire harness tasks

Revision ID: 20260817wiresemantic
Revises: 20260811wireharness
"""

from alembic import op
import sqlalchemy as sa


revision = "20260817wiresemantic"
down_revision = "20260811wireharness"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("wire_harness_compare_task", sa.Column("semantic_diff_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("wire_harness_compare_task", sa.Column("review_required_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("wire_harness_compare_task", sa.Column("ocr_page_count", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("wire_harness_compare_task", "ocr_page_count")
    op.drop_column("wire_harness_compare_task", "review_required_count")
    op.drop_column("wire_harness_compare_task", "semantic_diff_count")
