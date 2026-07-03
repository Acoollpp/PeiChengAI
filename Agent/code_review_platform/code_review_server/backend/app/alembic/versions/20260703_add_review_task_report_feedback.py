"""add review task report feedback

Revision ID: 20260703reportfeedback
Revises: 20260623deptadmin
Create Date: 2026-07-03 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "20260703reportfeedback"
down_revision = "20260623deptadmin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_task_report_feedback",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="报告反馈ID",
        ),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="代码审查任务ID",
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="提交人用户ID",
        ),
        sa.Column(
            "helpful",
            sa.Boolean(),
            nullable=False,
            comment="报告是否有帮助",
        ),
        sa.Column(
            "useful_issues_text",
            sa.String(length=4096),
            nullable=True,
            comment="有帮助时记录的有用信息",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="提交时间",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="更新时间",
        ),
        sa.ForeignKeyConstraint(["task_id"], ["review_task.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        comment="代码审查报告反馈表，记录用户对具体审查任务报告是否有帮助以及报告中的有用信息。",
    )
    op.create_index(
        op.f("ix_review_task_report_feedback_task_id"),
        "review_task_report_feedback",
        ["task_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_review_task_report_feedback_user_id"),
        "review_task_report_feedback",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_task_report_feedback_helpful"),
        "review_task_report_feedback",
        ["helpful"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_task_report_feedback_created_at"),
        "review_task_report_feedback",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_review_task_report_feedback_helpful_created_at",
        "review_task_report_feedback",
        ["helpful", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_review_task_report_feedback_helpful_created_at",
        table_name="review_task_report_feedback",
    )
    op.drop_index(
        op.f("ix_review_task_report_feedback_created_at"),
        table_name="review_task_report_feedback",
    )
    op.drop_index(
        op.f("ix_review_task_report_feedback_helpful"),
        table_name="review_task_report_feedback",
    )
    op.drop_index(
        op.f("ix_review_task_report_feedback_user_id"),
        table_name="review_task_report_feedback",
    )
    op.drop_index(
        op.f("ix_review_task_report_feedback_task_id"),
        table_name="review_task_report_feedback",
    )
    op.drop_table("review_task_report_feedback")
