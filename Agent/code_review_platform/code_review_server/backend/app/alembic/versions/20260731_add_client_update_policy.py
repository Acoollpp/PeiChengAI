"""新增客户端最低支持版本策略

Revision ID: 20260731updatepolicy
Revises: 20260729issuedrafts
Create Date: 2026-07-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260731updatepolicy"
down_revision: str | None = "20260729issuedrafts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "client_update_policy",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
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
            "minimum_supported_release_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "updated_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["minimum_supported_release_id"], ["client_release.id"]
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "platform", "arch", name="uq_client_update_policy_platform_arch"
        ),
    )
    op.create_index(
        op.f("ix_client_update_policy_platform"),
        "client_update_policy",
        ["platform"],
        unique=False,
    )
    op.create_index(
        op.f("ix_client_update_policy_arch"),
        "client_update_policy",
        ["arch"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_client_update_policy_arch"), table_name="client_update_policy"
    )
    op.drop_index(
        op.f("ix_client_update_policy_platform"), table_name="client_update_policy"
    )
    op.drop_table("client_update_policy")
