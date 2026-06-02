"""replace email auth with key auth

Revision ID: c4f8a9d2e101
Revises: b4d3f2c8a901
Create Date: 2026-06-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy.dialects import postgresql


revision = "c4f8a9d2e101"
down_revision = "b4d3f2c8a901"
branch_labels = None
depends_on = None


auth_source = postgresql.ENUM("local", "cch", name="authsource", create_type=False)


def upgrade():
    bind = op.get_bind()
    auth_source.create(bind, checkfirst=True)

    op.add_column(
        "user",
        sa.Column("auth_source", auth_source, server_default="local", nullable=False),
    )
    op.add_column("user", sa.Column("cch_user_id", sa.Integer(), nullable=True))
    op.add_column(
        "user",
        sa.Column(
            "disabled_reason",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
        ),
    )
    op.add_column(
        "user",
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column("user", "auth_source", server_default=None)
    op.create_index(op.f("ix_user_auth_source"), "user", ["auth_source"], unique=False)
    op.create_index(op.f("ix_user_cch_user_id"), "user", ["cch_user_id"], unique=True)

    op.create_table(
        "user_api_key",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cch_key_id", sa.Integer(), nullable=False),
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "disabled_reason",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_api_key_user_id"), "user_api_key", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_user_api_key_cch_key_id"),
        "user_api_key",
        ["cch_key_id"],
        unique=True,
    )
    op.create_index(op.f("ix_user_api_key_key"), "user_api_key", ["key"], unique=True)
    op.create_index(
        op.f("ix_user_api_key_is_active"),
        "user_api_key",
        ["is_active"],
        unique=False,
    )

    op.drop_index(op.f("ix_user_email"), table_name="user")
    op.drop_column("user", "email")
    op.drop_column("user", "hashed_password")


def downgrade():
    op.add_column(
        "user",
        sa.Column("hashed_password", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "user",
        sa.Column("email", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
    )
    op.execute("UPDATE \"user\" SET email = concat(id::text, '@restored.invalid')")
    op.execute("UPDATE \"user\" SET hashed_password = 'disabled'")
    op.alter_column("user", "email", nullable=False)
    op.alter_column("user", "hashed_password", nullable=False)
    op.create_index(op.f("ix_user_email"), "user", ["email"], unique=True)

    op.drop_index(op.f("ix_user_api_key_is_active"), table_name="user_api_key")
    op.drop_index(op.f("ix_user_api_key_key"), table_name="user_api_key")
    op.drop_index(op.f("ix_user_api_key_cch_key_id"), table_name="user_api_key")
    op.drop_index(op.f("ix_user_api_key_user_id"), table_name="user_api_key")
    op.drop_table("user_api_key")
    op.drop_index(op.f("ix_user_cch_user_id"), table_name="user")
    op.drop_index(op.f("ix_user_auth_source"), table_name="user")
    op.drop_column("user", "last_synced_at")
    op.drop_column("user", "disabled_reason")
    op.drop_column("user", "cch_user_id")
    op.drop_column("user", "auth_source")

    bind = op.get_bind()
    auth_source.drop(bind, checkfirst=True)
