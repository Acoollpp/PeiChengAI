"""enhance review focus admin

Revision ID: 20260622focusadmin
Revises: 20260615reviewinputs
Create Date: 2026-06-22 00:00:00.000000
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260622focusadmin"
down_revision = "20260615reviewinputs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_focus_direction_department",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="重点审查方向与部门关联记录ID。",
        ),
        sa.Column(
            "direction_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="关联的重点审查方向ID。",
        ),
        sa.Column(
            "department_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="关联的部门ID，表示该方向适用于该部门。",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="关联记录创建时间。",
        ),
        sa.ForeignKeyConstraint(["department_id"], ["department.id"]),
        sa.ForeignKeyConstraint(["direction_id"], ["review_focus_direction.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "direction_id",
            "department_id",
            name="uq_review_focus_direction_department",
        ),
        comment="重点审查方向与部门的多对多关联表。",
    )
    op.create_index(
        op.f("ix_review_focus_direction_department_department_id"),
        "review_focus_direction_department",
        ["department_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_focus_direction_department_direction_id"),
        "review_focus_direction_department",
        ["direction_id"],
        unique=False,
    )

    op.create_table(
        "review_focus_direction_usage_state",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="用户输入统计使用状态记录ID。",
        ),
        sa.Column(
            "normalized_content",
            sqlmodel.sql.sqltypes.AutoString(length=4096),
            nullable=False,
            comment="规范化后的重点审查方向内容，用于和统计聚合结果匹配。",
        ),
        sa.Column(
            "is_used",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment="管理员是否已处理或使用该用户输入统计项。",
        ),
        sa.Column(
            "updated_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="最后一次标记使用状态的管理员用户ID。",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="使用状态记录创建时间。",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="使用状态最后更新时间。",
        ),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        comment="用户输入统计项的人工使用状态表。",
    )
    op.create_index(
        op.f("ix_review_focus_direction_usage_state_is_used"),
        "review_focus_direction_usage_state",
        ["is_used"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_focus_direction_usage_state_normalized_content"),
        "review_focus_direction_usage_state",
        ["normalized_content"],
        unique=True,
    )

    op.execute(
        """
        INSERT INTO review_focus_direction_department
            (id, direction_id, department_id, created_at)
        SELECT gen_random_uuid(), id, department_id, created_at
        FROM review_focus_direction
        WHERE department_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_review_focus_direction_usage_state_normalized_content"),
        table_name="review_focus_direction_usage_state",
    )
    op.drop_index(
        op.f("ix_review_focus_direction_usage_state_is_used"),
        table_name="review_focus_direction_usage_state",
    )
    op.drop_table("review_focus_direction_usage_state")
    op.drop_index(
        op.f("ix_review_focus_direction_department_direction_id"),
        table_name="review_focus_direction_department",
    )
    op.drop_index(
        op.f("ix_review_focus_direction_department_department_id"),
        table_name="review_focus_direction_department",
    )
    op.drop_table("review_focus_direction_department")
