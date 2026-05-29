"""add skill package file size

Revision ID: b4d3f2c8a901
Revises: 7f13b7a9c202
Create Date: 2026-05-29 14:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b4d3f2c8a901"
down_revision = "7f13b7a9c202"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "skill_package",
        sa.Column("file_size", sa.Integer(), server_default="0", nullable=False),
    )
    op.alter_column("skill_package", "file_size", server_default=None)


def downgrade():
    op.drop_column("skill_package", "file_size")
