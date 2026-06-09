"""add feedback screenshots

Revision ID: 4e9c1d7b2a65
Revises: 3f6b2d1a9c44
Create Date: 2026-06-09 00:00:00.000000

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "4e9c1d7b2a65"
down_revision = "3f6b2d1a9c44"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "feedback_screenshot",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="截图ID"),
        sa.Column("feedback_id", postgresql.UUID(as_uuid=True), nullable=False, comment="所属意见ID"),
        sa.Column(
            "file_path",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=False,
            comment="截图服务器存储路径",
        ),
        sa.Column(
            "file_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
            comment="截图原始文件名",
        ),
        sa.Column(
            "content_type",
            sqlmodel.sql.sqltypes.AutoString(length=128),
            nullable=False,
            comment="截图文件类型",
        ),
        sa.Column("file_size", sa.Integer(), nullable=False, comment="截图文件大小，单位字节"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0", comment="截图顺序，从0开始"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, comment="上传时间"),
        sa.ForeignKeyConstraint(["feedback_id"], ["feedback.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        comment="意见反馈截图附件表，记录每条意见上传的多张问题截图。",
    )
    op.alter_column("feedback_screenshot", "sort_order", server_default=None)
    op.create_index(
        op.f("ix_feedback_screenshot_feedback_id"),
        "feedback_screenshot",
        ["feedback_id"],
        unique=False,
    )
    op.create_index(
        "ix_feedback_screenshot_feedback_order",
        "feedback_screenshot",
        ["feedback_id", "sort_order"],
        unique=False,
    )
    op.execute(
        """
        insert into feedback_screenshot
            (id, feedback_id, file_path, file_name, content_type, file_size, sort_order, created_at)
        select
            gen_random_uuid(),
            id,
            screenshot_path,
            coalesce(screenshot_name, 'screenshot.png'),
            coalesce(screenshot_content_type, 'image/png'),
            coalesce(screenshot_size, 0),
            0,
            created_at
        from feedback
        where screenshot_path is not null
        """
    )


def downgrade():
    op.drop_index("ix_feedback_screenshot_feedback_order", table_name="feedback_screenshot")
    op.drop_index(op.f("ix_feedback_screenshot_feedback_id"), table_name="feedback_screenshot")
    op.drop_table("feedback_screenshot")
