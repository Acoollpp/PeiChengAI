"""add skill packages

Revision ID: 7f13b7a9c202
Revises: 2b8f6c4d9e01
Create Date: 2026-05-28 16:25:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "7f13b7a9c202"
down_revision = "2b8f6c4d9e01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "skill_package",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column(
            "version",
            sqlmodel.sql.sqltypes.AutoString(length=128),
            nullable=False,
        ),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=1024),
            nullable=True,
        ),
        sa.Column(
            "content_hash",
            sqlmodel.sql.sqltypes.AutoString(length=64),
            nullable=False,
        ),
        sa.Column(
            "file_path",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_skill_package_name"), "skill_package", ["name"], unique=False)
    op.create_index(
        op.f("ix_skill_package_content_hash"),
        "skill_package",
        ["content_hash"],
        unique=False,
    )
    op.create_index(
        op.f("ix_skill_package_is_active"),
        "skill_package",
        ["is_active"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_skill_package_is_active"), table_name="skill_package")
    op.drop_index(op.f("ix_skill_package_content_hash"), table_name="skill_package")
    op.drop_index(op.f("ix_skill_package_name"), table_name="skill_package")
    op.drop_table("skill_package")
