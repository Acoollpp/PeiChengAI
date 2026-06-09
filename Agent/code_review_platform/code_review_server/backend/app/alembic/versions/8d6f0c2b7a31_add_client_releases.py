"""add client releases

Revision ID: 8d6f0c2b7a31
Revises: a7c9e2f1b304
Create Date: 2026-06-08 00:00:00.000000

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "8d6f0c2b7a31"
down_revision = "a7c9e2f1b304"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "client_release",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "version",
            sqlmodel.sql.sqltypes.AutoString(length=128),
            nullable=False,
        ),
        sa.Column(
            "platform",
            sqlmodel.sql.sqltypes.AutoString(length=32),
            nullable=False,
        ),
        sa.Column(
            "arch",
            sqlmodel.sql.sqltypes.AutoString(length=32),
            nullable=False,
        ),
        sa.Column(
            "release_notes",
            sqlmodel.sql.sqltypes.AutoString(length=4096),
            nullable=True,
        ),
        sa.Column(
            "artifact_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            "artifact_path",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=False,
        ),
        sa.Column("artifact_size", sa.Integer(), nullable=False),
        sa.Column(
            "artifact_sha512",
            sqlmodel.sql.sqltypes.AutoString(length=128),
            nullable=False,
        ),
        sa.Column(
            "latest_yml_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            "latest_yml_path",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=False,
        ),
        sa.Column(
            "blockmap_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
        ),
        sa.Column(
            "blockmap_path",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=True,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_client_release_version"),
        "client_release",
        ["version"],
        unique=False,
    )
    op.create_index(
        op.f("ix_client_release_platform"),
        "client_release",
        ["platform"],
        unique=False,
    )
    op.create_index(
        op.f("ix_client_release_arch"),
        "client_release",
        ["arch"],
        unique=False,
    )
    op.create_index(
        op.f("ix_client_release_artifact_sha512"),
        "client_release",
        ["artifact_sha512"],
        unique=False,
    )
    op.create_index(
        op.f("ix_client_release_is_active"),
        "client_release",
        ["is_active"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_client_release_is_active"), table_name="client_release")
    op.drop_index(
        op.f("ix_client_release_artifact_sha512"),
        table_name="client_release",
    )
    op.drop_index(op.f("ix_client_release_arch"), table_name="client_release")
    op.drop_index(op.f("ix_client_release_platform"), table_name="client_release")
    op.drop_index(op.f("ix_client_release_version"), table_name="client_release")
    op.drop_table("client_release")
