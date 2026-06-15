"""add departments and review inputs

Revision ID: 20260615_add_departments_review_inputs
Revises: 20260612pdf01
Create Date: 2026-06-15 20:30:00.000000
"""

from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy.dialects import postgresql


revision = "20260615_add_departments_review_inputs"
down_revision = "20260612pdf01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=32),
        type_=sa.String(length=64),
        existing_nullable=False,
    )
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    op.create_table(
        "department",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=1024),
            nullable=True,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_department_name"), "department", ["name"], unique=False)
    op.create_index(
        op.f("ix_department_is_active"), "department", ["is_active"], unique=False
    )
    op.create_index(
        op.f("ix_department_sort_order"), "department", ["sort_order"], unique=False
    )

    op.create_table(
        "review_focus_direction",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=True,
        ),
        sa.Column(
            "content",
            sqlmodel.sql.sqltypes.AutoString(length=8192),
            nullable=True,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["department_id"], ["department.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_review_focus_direction_department_id"),
        "review_focus_direction",
        ["department_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_focus_direction_name"),
        "review_focus_direction",
        ["name"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_focus_direction_is_active"),
        "review_focus_direction",
        ["is_active"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_focus_direction_sort_order"),
        "review_focus_direction",
        ["sort_order"],
        unique=False,
    )

    op.create_table(
        "review_task_requirement_file",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "file_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            "file_path",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=False,
        ),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column(
            "file_sha256",
            sqlmodel.sql.sqltypes.AutoString(length=64),
            nullable=False,
        ),
        sa.Column(
            "content_type",
            sqlmodel.sql.sqltypes.AutoString(length=128),
            nullable=True,
        ),
        sa.Column("uploaded_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_review_task_requirement_file_file_sha256"),
        "review_task_requirement_file",
        ["file_sha256"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_task_requirement_file_uploaded_by_user_id"),
        "review_task_requirement_file",
        ["uploaded_by_user_id"],
        unique=False,
    )

    op.add_column(
        "user",
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(op.f("ix_user_department_id"), "user", ["department_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_user_department_id_department"),
        "user",
        "department",
        ["department_id"],
        ["id"],
    )

    op.add_column(
        "review_task",
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column(
            "department_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
        ),
    )
    op.add_column(
        "review_task",
        sa.Column("focus_direction_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column(
            "focus_direction_snapshot",
            sqlmodel.sql.sqltypes.AutoString(length=8192),
            nullable=True,
        ),
    )
    op.add_column(
        "review_task",
        sa.Column("requirement_file_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column(
            "requirement_file_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
        ),
    )
    op.add_column(
        "review_task",
        sa.Column("requirement_file_size", sa.Integer(), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column(
            "requirement_file_sha256",
            sqlmodel.sql.sqltypes.AutoString(length=64),
            nullable=True,
        ),
    )
    op.create_index(
        op.f("ix_review_task_department_id"),
        "review_task",
        ["department_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_task_focus_direction_id"),
        "review_task",
        ["focus_direction_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_task_requirement_file_id"),
        "review_task",
        ["requirement_file_id"],
        unique=False,
    )
    op.create_foreign_key(
        op.f("fk_review_task_department_id_department"),
        "review_task",
        "department",
        ["department_id"],
        ["id"],
    )
    op.create_foreign_key(
        op.f("fk_review_task_focus_direction_id_review_focus_direction"),
        "review_task",
        "review_focus_direction",
        ["focus_direction_id"],
        ["id"],
    )
    op.create_foreign_key(
        op.f("fk_review_task_requirement_file_id_review_task_requirement_file"),
        "review_task",
        "review_task_requirement_file",
        ["requirement_file_id"],
        ["id"],
    )

    op.execute(
        """
        INSERT INTO department (id, name, description, is_active, sort_order, created_at, updated_at)
        SELECT uuid_generate_v4(), item.title, item.description, TRUE, 0, item.created_at, item.created_at
        FROM item
        WHERE item.title IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_review_task_requirement_file_id_review_task_requirement_file"),
        "review_task",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_review_task_focus_direction_id_review_focus_direction"),
        "review_task",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_review_task_department_id_department"),
        "review_task",
        type_="foreignkey",
    )
    op.drop_index(op.f("ix_review_task_requirement_file_id"), table_name="review_task")
    op.drop_index(op.f("ix_review_task_focus_direction_id"), table_name="review_task")
    op.drop_index(op.f("ix_review_task_department_id"), table_name="review_task")
    op.drop_column("review_task", "requirement_file_sha256")
    op.drop_column("review_task", "requirement_file_size")
    op.drop_column("review_task", "requirement_file_name")
    op.drop_column("review_task", "requirement_file_id")
    op.drop_column("review_task", "focus_direction_snapshot")
    op.drop_column("review_task", "focus_direction_id")
    op.drop_column("review_task", "department_name")
    op.drop_column("review_task", "department_id")

    op.drop_constraint(
        op.f("fk_user_department_id_department"), "user", type_="foreignkey"
    )
    op.drop_index(op.f("ix_user_department_id"), table_name="user")
    op.drop_column("user", "department_id")

    op.drop_index(
        op.f("ix_review_task_requirement_file_uploaded_by_user_id"),
        table_name="review_task_requirement_file",
    )
    op.drop_index(
        op.f("ix_review_task_requirement_file_file_sha256"),
        table_name="review_task_requirement_file",
    )
    op.drop_table("review_task_requirement_file")

    op.drop_index(
        op.f("ix_review_focus_direction_sort_order"),
        table_name="review_focus_direction",
    )
    op.drop_index(
        op.f("ix_review_focus_direction_is_active"),
        table_name="review_focus_direction",
    )
    op.drop_index(
        op.f("ix_review_focus_direction_name"),
        table_name="review_focus_direction",
    )
    op.drop_index(
        op.f("ix_review_focus_direction_department_id"),
        table_name="review_focus_direction",
    )
    op.drop_table("review_focus_direction")

    op.drop_index(op.f("ix_department_sort_order"), table_name="department")
    op.drop_index(op.f("ix_department_is_active"), table_name="department")
    op.drop_index(op.f("ix_department_name"), table_name="department")
    op.drop_table("department")
