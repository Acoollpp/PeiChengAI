"""add feedback

Revision ID: 3f6b2d1a9c44
Revises: 8d6f0c2b7a31
Create Date: 2026-06-09 00:00:00.000000

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "3f6b2d1a9c44"
down_revision = "8d6f0c2b7a31"
branch_labels = None
depends_on = None


feedback_status = postgresql.ENUM(
    "pending",
    "processing",
    "resolved",
    name="feedbackstatus",
    create_type=False,
)


def upgrade():
    bind = op.get_bind()
    feedback_status.create(bind, checkfirst=True)

    op.create_table(
        "feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="意见ID"),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="提交人用户ID",
        ),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=4096),
            nullable=False,
            comment="问题描述",
        ),
        sa.Column(
            "screenshot_path",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=True,
            comment="问题截图服务器存储路径",
        ),
        sa.Column(
            "screenshot_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
            comment="问题截图原始文件名",
        ),
        sa.Column(
            "screenshot_content_type",
            sqlmodel.sql.sqltypes.AutoString(length=128),
            nullable=True,
            comment="问题截图文件类型",
        ),
        sa.Column(
            "screenshot_size",
            sa.Integer(),
            nullable=True,
            comment="问题截图文件大小，单位字节",
        ),
        sa.Column(
            "status",
            feedback_status,
            nullable=False,
            server_default="pending",
            comment="解决状态",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="上传时间",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="更新时间",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        comment="用户意见反馈表，记录用户提交的问题描述、可选截图和解决状态。",
    )
    op.alter_column("feedback", "status", server_default=None)
    op.create_index(op.f("ix_feedback_user_id"), "feedback", ["user_id"], unique=False)
    op.create_index(op.f("ix_feedback_status"), "feedback", ["status"], unique=False)
    op.create_index(
        op.f("ix_feedback_created_at"),
        "feedback",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_feedback_user_id_status",
        "feedback",
        ["user_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_feedback_status_created_at",
        "feedback",
        ["status", "created_at"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_feedback_status_created_at", table_name="feedback")
    op.drop_index("ix_feedback_user_id_status", table_name="feedback")
    op.drop_index(op.f("ix_feedback_created_at"), table_name="feedback")
    op.drop_index(op.f("ix_feedback_status"), table_name="feedback")
    op.drop_index(op.f("ix_feedback_user_id"), table_name="feedback")
    op.drop_table("feedback")
    bind = op.get_bind()
    feedback_status.drop(bind, checkfirst=True)
