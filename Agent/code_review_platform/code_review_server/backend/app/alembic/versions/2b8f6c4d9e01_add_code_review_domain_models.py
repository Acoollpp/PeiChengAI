"""add code review domain models

Revision ID: 2b8f6c4d9e01
Revises: fe56fa70289e
Create Date: 2026-05-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "2b8f6c4d9e01"
down_revision = "fe56fa70289e"
branch_labels = None
depends_on = None


user_role = postgresql.ENUM("admin", "user", name="userrole", create_type=False)
review_task_status = postgresql.ENUM(
    "created",
    "checking_environment",
    "running_codex",
    "uploading_report",
    "success",
    "failed",
    "environment_error",
    "cancelled",
    name="reviewtaskstatus",
    create_type=False,
)


def upgrade():
    bind = op.get_bind()
    user_role.create(bind, checkfirst=True)
    review_task_status.create(bind, checkfirst=True)

    op.add_column(
        "user",
        sa.Column("svn_username", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
    )
    op.add_column(
        "user",
        sa.Column(
            "role",
            user_role,
            server_default="user",
            nullable=False,
        ),
    )
    op.alter_column("user", "role", server_default=None)
    op.create_index(op.f("ix_user_svn_username"), "user", ["svn_username"], unique=True)
    op.create_index(op.f("ix_user_role"), "user", ["role"], unique=False)

    op.create_table(
        "user_svn_credential",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("encrypted_password", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "encryption_version",
            sqlmodel.sql.sqltypes.AutoString(length=64),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_user_svn_credential_user_id"),
        "user_svn_credential",
        ["user_id"],
        unique=True,
    )
    op.create_table(
        "review_task",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("svn_url", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=False),
        sa.Column(
            "old_revision",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            "new_revision",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column("status", review_task_status, nullable=False),
        sa.Column("report_path", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=True),
        sa.Column("error_message", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("client_hostname", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column("client_version", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("target_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["target_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("audit_log")
    op.drop_table("review_task")
    op.drop_index(
        op.f("ix_user_svn_credential_user_id"), table_name="user_svn_credential"
    )
    op.drop_table("user_svn_credential")
    op.drop_index(op.f("ix_user_role"), table_name="user")
    op.drop_index(op.f("ix_user_svn_username"), table_name="user")
    op.drop_column("user", "role")
    op.drop_column("user", "svn_username")

    bind = op.get_bind()
    review_task_status.drop(bind, checkfirst=True)
    user_role.drop(bind, checkfirst=True)
