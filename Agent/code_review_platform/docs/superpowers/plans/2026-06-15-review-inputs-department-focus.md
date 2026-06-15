# 审查输入、部门和重点方向 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加产品开发需求表、重点审查方向、正式部门归属、方向库统计沉淀，并保持现有审查任务兼容。

**Architecture:** 后端先扩展数据模型、迁移和 API，保证旧 payload 与历史数据兼容；Web 管理端切到正式部门和重点方向管理；Electron 客户端新增可选输入、复制 Excel 到任务工作区、修改 prompt，并在服务端附件归档失败时继续审查。所有用户可见提示使用中文。

**Tech Stack:** FastAPI、SQLModel、Alembic、pytest、React、TanStack Router/Query、Hey API OpenAPI 客户端、Electron 39、Vitest。

---

## 文件结构

后端：

- Modify: `code_review_server/backend/app/models.py`
  - 新增 `Department`、`ReviewTaskRequirementFile`、`ReviewFocusDirection` 模型。
  - 扩展 `User`、`ReviewTask`、公开模型和创建/更新模型。
- Create: `code_review_server/backend/app/alembic/versions/20260615_add_departments_review_inputs.py`
  - 新增部门、方向库、需求表附件表。
  - 给 `user` 和 `review_task` 增加 nullable 字段。
  - 从旧 `item` 复制部门数据到 `department`。
- Create: `code_review_server/backend/app/api/routes/departments.py`
  - 正式部门 CRUD。
- Create: `code_review_server/backend/app/api/routes/review_focus_directions.py`
  - 方向库 CRUD、用户输入统计、统计沉淀。
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
  - 创建任务时保存部门和重点方向快照。
  - 增加需求表附件上传与删除清理。
- Modify: `code_review_server/backend/app/api/main.py`
  - 注册 `departments` 和 `review_focus_directions` 路由。
- Modify: `code_review_server/backend/app/api/routes/users.py`
  - 用户列表、创建、更新支持部门。
- Modify: `code_review_server/backend/app/services/report_service.py`
  - 增加需求表附件保存、hash 和删除函数。
- Test: `code_review_server/backend/tests/api/routes/test_departments.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_focus_directions.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`
- Test: `code_review_server/backend/tests/api/routes/test_users.py`

Web 前端：

- Regenerate: `code_review_server/frontend/src/client/*`
  - 后端 OpenAPI 更新后执行生成。
- Modify: `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`
  - 管理员菜单新增重点审查方向。
- Modify/Create: `code_review_server/frontend/src/routes/_layout/items.tsx`
  - 保留 `/items` 路径，内部改用 Department API。
- Modify/Create: `code_review_server/frontend/src/components/Departments/*`
  - 替换 `Items` 组件语义。
- Modify: `code_review_server/frontend/src/components/Admin/AddUser.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/EditUser.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/columns.tsx`
- Create: `code_review_server/frontend/src/routes/_layout/admin.review-focus-directions.tsx`
- Create: `code_review_server/frontend/src/components/ReviewFocusDirections/*`
- Test: `code_review_server/frontend/tests/items.spec.ts`
- Test: `code_review_server/frontend/tests/admin.spec.ts`
- Test: 新增 `code_review_server/frontend/tests/review-focus-directions.spec.ts`

Electron：

- Modify: `code_review_electron/src/shared/types.ts`
  - 扩展任务字段。
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
  - 扩展 `ExecuteTaskRequest` 和 API 能力。
- Modify: `code_review_electron/src/main/api-client.ts`
  - 扩展任务创建 payload，新增需求表附件上传。
- Modify: `code_review_electron/src/main/codex-runner.ts`
  - `buildReviewPrompt` 增加可选补充审查输入。
- Modify: `code_review_electron/src/main/task-agent.ts`
  - 复制 Excel 到任务工作区、上传附件失败不中断。
- Modify: `code_review_electron/src/main/ipc.ts`
  - 新增选择文件 IPC，注册附件上传依赖。
- Modify: `code_review_electron/src/preload/index.ts`
  - 暴露选择文件和粘贴文件路径能力。
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.tsx`
  - 新增产品开发需求表和重点审查方向输入。
- Modify: `code_review_electron/src/renderer/src/hooks/useTaskQueue.ts`
  - 保留新增字段并纳入新任务匹配。
- Test: `code_review_electron/src/main/__tests__/codex-runner.test.ts`
- Test: `code_review_electron/src/main/__tests__/task-agent.test.ts`
- Test: `code_review_electron/src/main/__tests__/ipc.test.ts`
- Test: `code_review_electron/src/preload/index.test.ts`
- Test: `code_review_electron/src/renderer/src/components/TaskForm.test.tsx`
- Test: `code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx`

## Task 1: 后端数据模型和迁移

**Files:**
- Modify: `code_review_server/backend/app/models.py`
- Create: `code_review_server/backend/app/alembic/versions/20260615_add_departments_review_inputs.py`
- Test: `code_review_server/backend/tests/api/routes/test_departments.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`
- Test: `code_review_server/backend/tests/api/routes/test_users.py`

- [ ] **Step 1: 写失败测试，验证旧任务 payload 仍兼容且返回新字段为空**

在 `code_review_server/backend/tests/api/routes/test_review_tasks.py` 增加：

```python
def test_create_review_task_legacy_payload_returns_new_fields_as_empty(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "svn://repo/project",
            "old_revision": "12",
            "new_revision": "14",
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["department_id"] is None
    assert content["department_name"] is None
    assert content["focus_direction_id"] is None
    assert content["focus_direction_snapshot"] is None
    assert content["requirement_file_name"] is None
    assert content["requirement_file_size"] is None
    assert content["requirement_file_sha256"] is None
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_review_tasks.py::test_create_review_task_legacy_payload_returns_new_fields_as_empty -q
```

Expected: FAIL，响应 JSON 不包含新增字段。

- [ ] **Step 3: 修改模型，加入部门、任务字段和附件/方向模型**

在 `code_review_server/backend/app/models.py` 中：

```python
class DepartmentBase(SQLModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    is_active: bool = True


class Department(DepartmentBase, table=True):
    __tablename__ = "department"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    is_active: bool | None = None


class DepartmentPublic(DepartmentBase):
    id: uuid.UUID
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DepartmentsPublic(SQLModel):
    data: list[DepartmentPublic]
    count: int
```

在 `User` 增加：

```python
department_id: uuid.UUID | None = Field(
    default=None, foreign_key="department.id", index=True
)
```

在 `UserCreate`、`UserUpdate`、`UserPublic` 增加 `department_id`，在 `UserPublic` 增加 `department_name`。

在 `ReviewTask` 增加：

```python
department_id: uuid.UUID | None = Field(default=None, foreign_key="department.id", index=True)
department_name: str | None = Field(default=None, max_length=255)
focus_direction_id: uuid.UUID | None = Field(default=None, foreign_key="review_focus_direction.id")
focus_direction_snapshot: str | None = Field(default=None, max_length=4096)
requirement_file_id: uuid.UUID | None = Field(default=None)
requirement_file_name: str | None = Field(default=None, max_length=255)
requirement_file_size: int | None = Field(default=None)
requirement_file_sha256: str | None = Field(default=None, max_length=64)
```

在 `ReviewTaskCreate` 增加：

```python
focus_direction_id: uuid.UUID | None = None
focus_direction_snapshot: str | None = Field(default=None, max_length=4096)
requirement_file_name: str | None = Field(default=None, max_length=255)
```

在 `ReviewTaskPublic` 增加同名公开字段。

新增：

```python
class ReviewTaskRequirementFile(SQLModel, table=True):
    __tablename__ = "review_task_requirement_file"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    task_id: uuid.UUID = Field(foreign_key="review_task.id", nullable=False, index=True)
    file_name: str = Field(max_length=255)
    file_path: str = Field(max_length=2048)
    content_type: str | None = Field(default=None, max_length=128)
    file_size: int
    sha256: str = Field(max_length=64, index=True)
    uploaded_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ReviewFocusDirection(SQLModel, table=True):
    __tablename__ = "review_focus_direction"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=4096)
    department_id: uuid.UUID | None = Field(default=None, foreign_key="department.id", index=True)
    is_active: bool = Field(default=True, index=True)
    usage_count: int = Field(default=0)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id")
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
```

- [ ] **Step 4: 新增 Alembic 迁移**

创建 `code_review_server/backend/app/alembic/versions/20260615_add_departments_review_inputs.py`：

```python
"""add departments review inputs

Revision ID: 20260615_add_departments_review_inputs
Revises: 20260612pdf01
Create Date: 2026-06-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy.dialects import postgresql


revision = "20260615_add_departments_review_inputs"
down_revision = "20260612pdf01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "department",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(length=1024), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_department_name"),
    )
    op.create_index(op.f("ix_department_name"), "department", ["name"], unique=False)

    op.execute(
        """
        INSERT INTO department (id, name, description, is_active, created_at, updated_at)
        SELECT id, title, description, true, created_at, created_at
        FROM item
        WHERE title IS NOT NULL
        ON CONFLICT (name) DO NOTHING
        """
    )

    op.add_column("user", sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_user_department_id", "user", "department", ["department_id"], ["id"])
    op.create_index(op.f("ix_user_department_id"), "user", ["department_id"], unique=False)

    op.create_table(
        "review_focus_direction",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("content", sqlmodel.sql.sqltypes.AutoString(length=4096), nullable=False),
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("usage_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["department_id"], ["department.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_review_focus_direction_department_id"), "review_focus_direction", ["department_id"], unique=False)
    op.create_index(op.f("ix_review_focus_direction_is_active"), "review_focus_direction", ["is_active"], unique=False)

    op.add_column("review_task", sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("review_task", sa.Column("department_name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True))
    op.add_column("review_task", sa.Column("focus_direction_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("review_task", sa.Column("focus_direction_snapshot", sqlmodel.sql.sqltypes.AutoString(length=4096), nullable=True))
    op.add_column("review_task", sa.Column("requirement_file_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("review_task", sa.Column("requirement_file_name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True))
    op.add_column("review_task", sa.Column("requirement_file_size", sa.Integer(), nullable=True))
    op.add_column("review_task", sa.Column("requirement_file_sha256", sqlmodel.sql.sqltypes.AutoString(length=64), nullable=True))
    op.create_foreign_key("fk_review_task_department_id", "review_task", "department", ["department_id"], ["id"])
    op.create_foreign_key("fk_review_task_focus_direction_id", "review_task", "review_focus_direction", ["focus_direction_id"], ["id"])
    op.create_index(op.f("ix_review_task_department_id"), "review_task", ["department_id"], unique=False)

    op.create_table(
        "review_task_requirement_file",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("file_path", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=False),
        sa.Column("content_type", sqlmodel.sql.sqltypes.AutoString(length=128), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["review_task.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_review_task_requirement_file_task_id"), "review_task_requirement_file", ["task_id"], unique=False)
    op.create_index(op.f("ix_review_task_requirement_file_sha256"), "review_task_requirement_file", ["sha256"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_review_task_requirement_file_sha256"), table_name="review_task_requirement_file")
    op.drop_index(op.f("ix_review_task_requirement_file_task_id"), table_name="review_task_requirement_file")
    op.drop_table("review_task_requirement_file")
    op.drop_index(op.f("ix_review_task_department_id"), table_name="review_task")
    op.drop_constraint("fk_review_task_focus_direction_id", "review_task", type_="foreignkey")
    op.drop_constraint("fk_review_task_department_id", "review_task", type_="foreignkey")
    for column in (
        "requirement_file_sha256",
        "requirement_file_size",
        "requirement_file_name",
        "requirement_file_id",
        "focus_direction_snapshot",
        "focus_direction_id",
        "department_name",
        "department_id",
    ):
        op.drop_column("review_task", column)
    op.drop_index(op.f("ix_review_focus_direction_is_active"), table_name="review_focus_direction")
    op.drop_index(op.f("ix_review_focus_direction_department_id"), table_name="review_focus_direction")
    op.drop_table("review_focus_direction")
    op.drop_index(op.f("ix_user_department_id"), table_name="user")
    op.drop_constraint("fk_user_department_id", "user", type_="foreignkey")
    op.drop_column("user", "department_id")
    op.drop_index(op.f("ix_department_name"), table_name="department")
    op.drop_table("department")
```

- [ ] **Step 5: 运行测试确认新增字段兼容**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_review_tasks.py::test_create_review_task_legacy_payload_returns_new_fields_as_empty -q
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add code_review_server/backend/app/models.py code_review_server/backend/app/alembic/versions/20260615_add_departments_review_inputs.py code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "新增部门和审查输入数据模型"
```

## Task 2: 后端部门 API

**Files:**
- Create: `code_review_server/backend/app/api/routes/departments.py`
- Modify: `code_review_server/backend/app/api/main.py`
- Test: `code_review_server/backend/tests/api/routes/test_departments.py`

- [ ] **Step 1: 写失败测试，验证管理员可维护部门、普通用户不可维护**

创建 `code_review_server/backend/tests/api/routes/test_departments.py`：

```python
import uuid

from fastapi.testclient import TestClient

from app.core.config import settings


def test_admin_can_create_and_list_departments(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/departments",
        headers=superuser_token_headers,
        json={"name": "研发一部", "description": "BMS 研发"},
    )

    assert response.status_code == 200
    created = response.json()
    assert created["name"] == "研发一部"
    assert created["description"] == "BMS 研发"
    assert created["is_active"] is True

    list_response = client.get(
        f"{settings.API_V1_STR}/departments",
        headers=superuser_token_headers,
    )
    assert list_response.status_code == 200
    assert any(item["id"] == created["id"] for item in list_response.json()["data"])


def test_normal_user_cannot_create_department(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/departments",
        headers=normal_user_token_headers,
        json={"name": "无权限部门"},
    )

    assert response.status_code == 403


def test_admin_can_update_department(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    created = client.post(
        f"{settings.API_V1_STR}/departments",
        headers=superuser_token_headers,
        json={"name": "测试部"},
    ).json()

    response = client.patch(
        f"{settings.API_V1_STR}/departments/{created['id']}",
        headers=superuser_token_headers,
        json={"name": "测试部更新", "is_active": False},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["name"] == "测试部更新"
    assert content["is_active"] is False


def test_delete_missing_department_returns_404(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/departments/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "部门不存在"
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_departments.py -q
```

Expected: FAIL，`/departments` 路由不存在。

- [ ] **Step 3: 实现部门路由**

创建 `code_review_server/backend/app/api/routes/departments.py`：

```python
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import col, func, select

from app.api.deps import SessionDep, get_current_active_admin
from app.models import (
    Department,
    DepartmentCreate,
    DepartmentPublic,
    DepartmentsPublic,
    DepartmentUpdate,
    Message,
    ReviewFocusDirection,
    ReviewTask,
    User,
    get_datetime_utc,
)

router = APIRouter(prefix="/departments", tags=["departments"])


def _get_department(session: SessionDep, department_id: uuid.UUID) -> Department:
    department = session.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=404, detail="部门不存在")
    return department


@router.get("", dependencies=[Depends(get_current_active_admin)], response_model=DepartmentsPublic)
def read_departments(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    count = session.exec(select(func.count()).select_from(Department)).one()
    statement = (
        select(Department)
        .order_by(col(Department.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    return DepartmentsPublic(data=session.exec(statement).all(), count=count)


@router.post("", dependencies=[Depends(get_current_active_admin)], response_model=DepartmentPublic)
def create_department(*, session: SessionDep, department_in: DepartmentCreate) -> Any:
    existing = session.exec(
        select(Department).where(Department.name == department_in.name)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="部门名称已存在")
    department = Department.model_validate(department_in)
    session.add(department)
    session.commit()
    session.refresh(department)
    return department


@router.patch(
    "/{department_id}",
    dependencies=[Depends(get_current_active_admin)],
    response_model=DepartmentPublic,
)
def update_department(
    *, session: SessionDep, department_id: uuid.UUID, department_in: DepartmentUpdate
) -> Any:
    department = _get_department(session, department_id)
    update_data = department_in.model_dump(exclude_unset=True)
    if "name" in update_data:
        existing = session.exec(
            select(Department).where(Department.name == update_data["name"])
        ).first()
        if existing and existing.id != department.id:
            raise HTTPException(status_code=409, detail="部门名称已存在")
    department.sqlmodel_update(update_data)
    department.updated_at = get_datetime_utc()
    session.add(department)
    session.commit()
    session.refresh(department)
    return department


@router.delete("/{department_id}", dependencies=[Depends(get_current_active_admin)])
def delete_department(session: SessionDep, department_id: uuid.UUID) -> Message:
    department = _get_department(session, department_id)
    has_user = session.exec(select(User.id).where(User.department_id == department.id)).first()
    has_task = session.exec(
        select(ReviewTask.id).where(ReviewTask.department_id == department.id)
    ).first()
    has_direction = session.exec(
        select(ReviewFocusDirection.id).where(
            ReviewFocusDirection.department_id == department.id
        )
    ).first()
    if has_user or has_task or has_direction:
        raise HTTPException(
            status_code=409,
            detail="该部门已关联用户、任务或重点审查方向，不能删除，请先停用。",
        )
    session.delete(department)
    session.commit()
    return Message(message="部门删除成功")
```

修改 `code_review_server/backend/app/api/main.py`：

```python
from app.api.routes import departments

api_router.include_router(departments.router)
```

- [ ] **Step 4: 运行部门测试**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_departments.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add code_review_server/backend/app/api/routes/departments.py code_review_server/backend/app/api/main.py code_review_server/backend/tests/api/routes/test_departments.py
git commit -m "新增部门管理接口"
```

## Task 3: 用户部门和任务快照

**Files:**
- Modify: `code_review_server/backend/app/api/routes/users.py`
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Test: `code_review_server/backend/tests/api/routes/test_users.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`

- [ ] **Step 1: 写失败测试，验证用户可绑定部门**

在 `code_review_server/backend/tests/api/routes/test_users.py` 增加：

```python
from app.models import Department


def test_admin_can_create_user_with_department(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    department = Department(name="软件部", description="软件研发")
    db.add(department)
    db.commit()
    db.refresh(department)

    response = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json=_user_payload(department_id=str(department.id)),
    )

    assert response.status_code == 200
    content = response.json()
    assert content["department_id"] == str(department.id)
    assert content["department_name"] == "软件部"
```

- [ ] **Step 2: 写失败测试，验证任务保存部门和重点方向快照**

在 `code_review_server/backend/tests/api/routes/test_review_tasks.py` 增加：

```python
from app.models import Department


def test_create_review_task_stores_department_and_focus_snapshot(
    client: TestClient,
    db: Session,
) -> None:
    user, api_key = create_key_user(db)
    department = Department(name="储能软件部")
    db.add(department)
    db.commit()
    db.refresh(department)
    user.department_id = department.id
    db.add(user)
    db.commit()
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)

    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=headers,
        json={
            "svn_url": "svn://repo/project",
            "old_revision": "12",
            "new_revision": "14",
            "focus_direction_snapshot": "重点看 SOC 跳变和低电量禁放逻辑",
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["department_id"] == str(department.id)
    assert content["department_name"] == "储能软件部"
    assert content["focus_direction_snapshot"] == "重点看 SOC 跳变和低电量禁放逻辑"
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_users.py::test_admin_can_create_user_with_department tests/api/routes/test_review_tasks.py::test_create_review_task_stores_department_and_focus_snapshot -q
```

Expected: FAIL，部门名称未返回或任务未保存快照。

- [ ] **Step 4: 实现用户返回部门名称**

在 `code_review_server/backend/app/api/routes/users.py` 增加 helper：

```python
def _user_public(user: User, department_name: str | None = None) -> UserPublic:
    return UserPublic.model_validate(
        user,
        update={"department_name": department_name},
    )
```

在读取列表时改为 join 或批量查询部门名：

```python
department_ids = {user.department_id for user in users if user.department_id}
departments_by_id = {}
if department_ids:
    departments = session.exec(
        select(Department).where(col(Department.id).in_(department_ids))
    ).all()
    departments_by_id = {department.id: department.name for department in departments}
users_public = [
    _user_public(user, departments_by_id.get(user.department_id))
    for user in users
]
```

在创建和更新用户前验证部门存在：

```python
def _ensure_department_exists(
    *, session: SessionDep, department_id: uuid.UUID | None
) -> None:
    if department_id is None:
        return
    department = session.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=400, detail="部门不存在")
```

- [ ] **Step 5: 实现任务部门快照**

在 `code_review_server/backend/app/api/routes/review_tasks.py` 的 `create_review_task` 中：

```python
department_name = None
if current_user.department_id:
    department = session.get(Department, current_user.department_id)
    department_name = department.name if department else None

task = ReviewTask.model_validate(
    task_in,
    update={
        "user_id": current_user.id,
        "old_revision": old_revision,
        "new_revision": new_revision,
        "department_id": current_user.department_id,
        "department_name": department_name,
    },
)
```

- [ ] **Step 6: 运行测试**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_users.py::test_admin_can_create_user_with_department tests/api/routes/test_review_tasks.py::test_create_review_task_stores_department_and_focus_snapshot -q
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add code_review_server/backend/app/api/routes/users.py code_review_server/backend/app/api/routes/review_tasks.py code_review_server/backend/tests/api/routes/test_users.py code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "保存用户部门和任务审查方向快照"
```

## Task 4: 需求表附件上传和清理

**Files:**
- Modify: `code_review_server/backend/app/services/report_service.py`
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`

- [ ] **Step 1: 写失败测试，验证 Excel 附件上传**

在 `code_review_server/backend/tests/api/routes/test_review_tasks.py` 增加：

```python
def test_upload_requirement_file_updates_task_metadata(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)

    response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={
            "upload": (
                "产品开发需求表.xls",
                b"excel-content",
                "application/vnd.ms-excel",
            )
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["requirement_file_name"] == "产品开发需求表.xls"
    assert content["requirement_file_size"] == len(b"excel-content")
    assert len(content["requirement_file_sha256"]) == 64
```

再加非法类型测试：

```python
def test_upload_requirement_file_rejects_non_excel(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    task = _create_review_task(client, normal_user_token_headers)

    response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={"upload": ("note.txt", b"text", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "产品开发需求表仅支持 .xls 或 .xlsx 文件。"
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_review_tasks.py::test_upload_requirement_file_updates_task_metadata tests/api/routes/test_review_tasks.py::test_upload_requirement_file_rejects_non_excel -q
```

Expected: FAIL，上传接口不存在。

- [ ] **Step 3: 实现附件服务**

在 `code_review_server/backend/app/services/report_service.py` 增加：

```python
import hashlib
import re

ALLOWED_REQUIREMENT_EXTENSIONS = {".xls", ".xlsx"}


def _safe_filename(file_name: str | None, fallback: str) -> str:
    name = (file_name or fallback).strip()
    name = name.replace("\\", "_").replace("/", "_")
    name = re.sub(r"[\r\n\t]", "_", name)
    return name or fallback


def requirement_file_path_for_task(task_id: uuid.UUID, file_name: str) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / str(task_id) / "requirements" / file_name


async def save_requirement_upload(task_id: uuid.UUID, upload: UploadFile) -> tuple[Path, int, str, str]:
    original_name = _safe_filename(upload.filename, "产品开发需求表.xlsx")
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_REQUIREMENT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="产品开发需求表仅支持 .xls 或 .xlsx 文件。")

    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="产品开发需求表不能为空。")

    file_hash = hashlib.sha256(content).hexdigest()
    file_path = requirement_file_path_for_task(task_id, original_name)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(content)
    return file_path, len(content), file_hash, original_name
```

- [ ] **Step 4: 实现上传路由并更新任务元数据**

在 `code_review_server/backend/app/api/routes/review_tasks.py` 增加：

```python
from app.models import ReviewTaskRequirementFile


@router.post("/{task_id}/requirement-file", response_model=ReviewTaskPublic)
async def upload_review_task_requirement_file(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    upload: UploadFile = File(...),
) -> Any:
    task = _get_task_for_user(session=session, current_user=current_user, task_id=task_id)
    file_path, file_size, file_hash, file_name = await report_service.save_requirement_upload(
        task_id, upload
    )
    requirement_file = ReviewTaskRequirementFile(
        task_id=task.id,
        file_name=file_name,
        file_path=str(file_path),
        content_type=upload.content_type,
        file_size=file_size,
        sha256=file_hash,
    )
    session.add(requirement_file)
    session.flush()
    task.requirement_file_id = requirement_file.id
    task.requirement_file_name = file_name
    task.requirement_file_size = file_size
    task.requirement_file_sha256 = file_hash
    task.updated_at = _utcnow()
    session.add(task)
    session.commit()
    session.refresh(task)
    return task
```

在删除任务时删除 `ReviewTaskRequirementFile.file_path` 指向的文件；删除语义必须和现有 Markdown/PDF 报告保持一致：先删除磁盘文件，任一文件删除失败则返回 500 并中断，不删除数据库任务记录。捕获 `OSError` 时返回中文错误“产品开发需求表附件删除失败”。

实现时先查询任务附件：

```python
requirement_files = session.exec(
    select(ReviewTaskRequirementFile).where(
        ReviewTaskRequirementFile.task_id == task.id
    )
).all()
for requirement_file in requirement_files:
    requirement_path = Path(requirement_file.file_path)
    if requirement_path.is_file():
        try:
            requirement_path.unlink()
        except OSError as exc:
            raise HTTPException(
                status_code=500, detail="产品开发需求表附件删除失败"
            ) from exc
```

只有报告、PDF 和需求表附件文件都删除成功后，才执行 `session.delete(task)` 和 `session.commit()`。

- [ ] **Step 5: 运行附件测试**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_review_tasks.py::test_upload_requirement_file_updates_task_metadata tests/api/routes/test_review_tasks.py::test_upload_requirement_file_rejects_non_excel -q
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add code_review_server/backend/app/services/report_service.py code_review_server/backend/app/api/routes/review_tasks.py code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "新增产品开发需求表附件归档"
```

## Task 5: 重点审查方向库和统计沉淀 API

**Files:**
- Create: `code_review_server/backend/app/api/routes/review_focus_directions.py`
- Modify: `code_review_server/backend/app/api/main.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_focus_directions.py`

- [ ] **Step 1: 写失败测试，验证方向库 CRUD**

创建 `code_review_server/backend/tests/api/routes/test_review_focus_directions.py`：

```python
from fastapi.testclient import TestClient

from app.core.config import settings


def test_admin_can_create_and_list_focus_directions(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json={"title": "SOC审查", "content": "重点检查 SOC 跳变、校准和平滑策略。"},
    )

    assert response.status_code == 200
    created = response.json()
    assert created["title"] == "SOC审查"
    assert created["is_active"] is True

    list_response = client.get(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
    )
    assert list_response.status_code == 200
    assert any(item["id"] == created["id"] for item in list_response.json()["data"])


def test_normal_user_cannot_create_focus_direction(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=normal_user_token_headers,
        json={"title": "无权限", "content": "无权限创建"},
    )

    assert response.status_code == 403
```

- [ ] **Step 2: 写失败测试，验证统计和沉淀**

同文件增加：

```python
def test_admin_can_read_focus_direction_usage_stats_and_create_from_usage(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    for old_revision in ("10", "11"):
        response = client.post(
            f"{settings.API_V1_STR}/review-tasks",
            headers=normal_user_token_headers,
            json={
                "svn_url": "svn://repo/project",
                "old_revision": old_revision,
                "new_revision": "20",
                "focus_direction_snapshot": " 重点检查 SOC 跳变\\n和低电量禁放逻辑 ",
            },
        )
        assert response.status_code == 200

    stats_response = client.get(
        f"{settings.API_V1_STR}/review-focus-directions/usage-stats",
        headers=superuser_token_headers,
    )
    assert stats_response.status_code == 200
    stats = stats_response.json()["data"]
    stat = next(item for item in stats if "SOC 跳变" in item["content"])
    assert stat["usage_count"] == 2

    create_response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions/from-usage",
        headers=superuser_token_headers,
        json={"title": "SOC与低电量", "content": stat["content"]},
    )
    assert create_response.status_code == 200
    assert create_response.json()["title"] == "SOC与低电量"
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_review_focus_directions.py -q
```

Expected: FAIL，路由不存在。

- [ ] **Step 4: 补充公开模型**

在 `code_review_server/backend/app/models.py` 增加：

```python
class ReviewFocusDirectionCreate(SQLModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=4096)
    department_id: uuid.UUID | None = None
    is_active: bool = True


class ReviewFocusDirectionUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, min_length=1, max_length=4096)
    department_id: uuid.UUID | None = None
    is_active: bool | None = None


class ReviewFocusDirectionPublic(SQLModel):
    id: uuid.UUID
    title: str
    content: str
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    is_active: bool
    usage_count: int
    created_by_user_id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ReviewFocusDirectionsPublic(SQLModel):
    data: list[ReviewFocusDirectionPublic]
    count: int


class ReviewFocusDirectionUsageStatPublic(SQLModel):
    content: str
    usage_count: int
    latest_used_at: datetime | None = None
    departments: list[str] = Field(default_factory=list)


class ReviewFocusDirectionUsageStatsPublic(SQLModel):
    data: list[ReviewFocusDirectionUsageStatPublic]
    count: int
```

- [ ] **Step 5: 实现方向库路由**

创建 `code_review_server/backend/app/api/routes/review_focus_directions.py`，包含：

```python
import re
import uuid
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, get_current_active_admin
from app.models import (
    Department,
    ReviewFocusDirection,
    ReviewFocusDirectionCreate,
    ReviewFocusDirectionPublic,
    ReviewFocusDirectionsPublic,
    ReviewFocusDirectionUpdate,
    ReviewFocusDirectionUsageStatPublic,
    ReviewFocusDirectionUsageStatsPublic,
    ReviewTask,
    get_datetime_utc,
)

router = APIRouter(prefix="/review-focus-directions", tags=["review-focus-directions"])


def _normalize_content(content: str) -> str:
    return re.sub(r"\s+", " ", content.strip())


def _public(direction: ReviewFocusDirection, department_name: str | None = None) -> ReviewFocusDirectionPublic:
    return ReviewFocusDirectionPublic.model_validate(
        direction,
        update={"department_name": department_name},
    )
```

实现 `GET/POST/PATCH/DELETE`。删除可采用软删除：

```python
direction.is_active = False
direction.updated_at = get_datetime_utc()
```

统计接口：

```python
@router.get(
    "/usage-stats",
    dependencies=[Depends(get_current_active_admin)],
    response_model=ReviewFocusDirectionUsageStatsPublic,
)
def read_usage_stats(session: SessionDep) -> Any:
    rows = session.exec(
        select(
            ReviewTask.focus_direction_snapshot,
            ReviewTask.department_name,
            ReviewTask.created_at,
        ).where(ReviewTask.focus_direction_snapshot.is_not(None))
    ).all()
    grouped: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"usage_count": 0, "latest_used_at": None, "departments": set()}
    )
    for snapshot, department_name, created_at in rows:
        content = _normalize_content(snapshot or "")
        if not content:
            continue
        item = grouped[content]
        item["usage_count"] += 1
        if created_at and (
            item["latest_used_at"] is None or created_at > item["latest_used_at"]
        ):
            item["latest_used_at"] = created_at
        if department_name:
            item["departments"].add(department_name)
    data = [
        ReviewFocusDirectionUsageStatPublic(
            content=content,
            usage_count=value["usage_count"],
            latest_used_at=value["latest_used_at"],
            departments=sorted(value["departments"]),
        )
        for content, value in grouped.items()
    ]
    data.sort(key=lambda item: (-item.usage_count, item.content))
    return ReviewFocusDirectionUsageStatsPublic(data=data, count=len(data))
```

`from-usage` 复用 create 逻辑创建方向库条目。

在 `api/main.py` 注册路由。

- [ ] **Step 6: 运行方向库测试**

Run:

```bash
cd code_review_server/backend
pytest tests/api/routes/test_review_focus_directions.py -q
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add code_review_server/backend/app/models.py code_review_server/backend/app/api/routes/review_focus_directions.py code_review_server/backend/app/api/main.py code_review_server/backend/tests/api/routes/test_review_focus_directions.py
git commit -m "新增重点审查方向库和统计接口"
```

## Task 6: Web 客户端生成和部门管理页面

**Files:**
- Regenerate: `code_review_server/frontend/src/client/*`
- Modify: `code_review_server/frontend/src/routes/_layout/items.tsx`
- Create/Modify: `code_review_server/frontend/src/components/Departments/*`
- Test: `code_review_server/frontend/tests/items.spec.ts`

- [ ] **Step 1: 生成 OpenAPI 文件和前端客户端**

Run:

```bash
cd code_review_server
./scripts/generate-client.sh
cd frontend
npm run generate-client
```

Expected: `src/client` 中出现 `DepartmentsService`、`ReviewFocusDirectionsService` 和新增类型。

- [ ] **Step 2: 改写部门页面使用 Department API**

将 `code_review_server/frontend/src/routes/_layout/items.tsx` 中查询改为：

```tsx
function getDepartmentsQueryOptions() {
  return {
    queryFn: () => DepartmentsService.readDepartments({ skip: 0, limit: 100 }),
    queryKey: ["departments"],
  }
}
```

页面文本保留中文：

```tsx
<h1 className="text-2xl font-bold tracking-tight">部门管理</h1>
<p className="text-muted-foreground">创建并管理部门信息</p>
```

- [ ] **Step 3: 新建 Departments 组件并替换 Items 组件引用**

创建 `code_review_server/frontend/src/components/Departments/AddDepartment.tsx`，表单字段：

```tsx
const formSchema = z.object({
  name: z.string().min(1, { message: "请填写部门名称" }),
  description: z.string().optional(),
  is_active: z.boolean(),
})
```

提交：

```tsx
DepartmentsService.createDepartment({ requestBody: data })
```

成功提示：

```tsx
showSuccessToast("部门创建成功")
queryClient.invalidateQueries({ queryKey: ["departments"] })
```

创建 `EditDepartment.tsx`、`DeleteDepartment.tsx`、`columns.tsx`，字段使用 `name/description/is_active`。

所有 Department 组件和页面统一使用 `["departments"]` 作为 query key：

```tsx
queryClient.invalidateQueries({ queryKey: ["departments"] })
```

不要保留旧 `["items"]` key，否则新增、编辑、删除部门后列表不会刷新。

`columns.tsx` 必须显示启用状态列：

```tsx
{
  accessorKey: "is_active",
  header: "状态",
  cell: ({ row }) => row.original.is_active ? "启用" : "停用",
}
```

- [ ] **Step 4: 更新 Playwright 部门测试**

修改 `code_review_server/frontend/tests/items.spec.ts`，断言仍使用中文：

```ts
await expect(page.getByRole("heading", { name: "部门管理" })).toBeVisible()
await page.getByRole("button", { name: "新增部门" }).click()
await page.getByLabel("部门名称").fill(title)
await page.getByRole("button", { name: "保存" }).click()
await expect(page.getByText("部门创建成功")).toBeVisible()
```

- [ ] **Step 5: 运行前端类型检查和部门测试**

Run:

```bash
cd code_review_server/frontend
npm run build
bunx playwright test tests/items.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add code_review_server/frontend/src/client code_review_server/frontend/src/routes/_layout/items.tsx code_review_server/frontend/src/components/Departments code_review_server/frontend/tests/items.spec.ts
git commit -m "切换正式部门管理页面"
```

## Task 7: Web 用户管理和重点方向页面

**Files:**
- Modify: `code_review_server/frontend/src/components/Admin/AddUser.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/EditUser.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/columns.tsx`
- Modify: `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`
- Create: `code_review_server/frontend/src/routes/_layout/admin.review-focus-directions.tsx`
- Create: `code_review_server/frontend/src/components/ReviewFocusDirections/ReviewFocusDirectionsPage.tsx`
- Test: `code_review_server/frontend/tests/admin.spec.ts`
- Test: `code_review_server/frontend/tests/review-focus-directions.spec.ts`

- [ ] **Step 1: 用户管理新增部门字段**

在 `AddUser.tsx` 和 `EditUser.tsx` 中加载部门：

```tsx
const { data: departments } = useQuery({
  queryKey: ["departments", "active"],
  queryFn: () => DepartmentsService.readDepartments({ skip: 0, limit: 100 }),
})
```

表单 schema 增加：

```tsx
department_id: z.string().optional(),
```

选择器：

```tsx
<FormField
  control={form.control}
  name="department_id"
  render={({ field }) => (
    <FormItem>
      <FormLabel>部门</FormLabel>
      <Select value={field.value ?? ""} onValueChange={field.onChange}>
        <FormControl>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="不绑定部门" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {(departments?.data ?? [])
            .filter((department) => department.is_active)
            .map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

提交时空字符串转 `null`：

```tsx
department_id: data.department_id || null,
```

用户列表列增加：

```tsx
{
  accessorKey: "department_name",
  header: "部门",
  cell: ({ row }) => (
    <span className="text-muted-foreground">
      {row.original.department_name || "-"}
    </span>
  ),
}
```

- [ ] **Step 2: 新增重点审查方向页面**

创建 `ReviewFocusDirectionsPage.tsx`，用两个 tab：

```tsx
<Tabs defaultValue="library">
  <TabsList>
    <TabsTrigger value="library">方向库</TabsTrigger>
    <TabsTrigger value="stats">用户输入统计</TabsTrigger>
  </TabsList>
  <TabsContent value="library">...</TabsContent>
  <TabsContent value="stats">...</TabsContent>
</Tabs>
```

方向库查询：

```tsx
ReviewFocusDirectionsService.readReviewFocusDirections({ skip: 0, limit: 100 })
```

统计查询：

```tsx
ReviewFocusDirectionsService.readUsageStats()
```

沉淀按钮调用：

```tsx
ReviewFocusDirectionsService.createReviewFocusDirectionFromUsage({
  requestBody: {
    title,
    content,
    department_id: selectedDepartmentId || null,
  },
})
```

- [ ] **Step 3: 注册路由和菜单**

创建 `code_review_server/frontend/src/routes/_layout/admin.review-focus-directions.tsx`：

```tsx
import { createFileRoute } from "@tanstack/react-router"

import { ReviewFocusDirectionsPage } from "@/components/ReviewFocusDirections/ReviewFocusDirectionsPage"
import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/review-focus-directions")({
  component: ReviewFocusDirectionsPage,
  beforeLoad: async () => {
    await requireAdminUser()
  },
  head: () => ({
    meta: [{ title: "重点审查方向 - 沛城科技代码审查平台" }],
  }),
})
```

在 `AppSidebar.tsx` 管理员菜单新增：

```tsx
{ icon: ListChecks, title: "重点审查方向", path: "/admin/review-focus-directions" },
```

- [ ] **Step 4: 写 Playwright 测试**

创建 `code_review_server/frontend/tests/review-focus-directions.spec.ts`：

```ts
import { expect, test } from "@playwright/test"

test("Admin can open review focus direction page", async ({ page }) => {
  await page.goto("/admin/review-focus-directions")
  await expect(page.getByRole("heading", { name: "重点审查方向" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "方向库" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "用户输入统计" })).toBeVisible()
})
```

- [ ] **Step 5: 运行前端验证**

Run:

```bash
cd code_review_server/frontend
npm run build
bunx playwright test tests/admin.spec.ts tests/review-focus-directions.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add code_review_server/frontend/src/components/Admin code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx code_review_server/frontend/src/components/ReviewFocusDirections code_review_server/frontend/src/routes/_layout/admin.review-focus-directions.tsx code_review_server/frontend/tests/admin.spec.ts code_review_server/frontend/tests/review-focus-directions.spec.ts
git commit -m "新增用户部门选择和重点审查方向页面"
```

## Task 8: Electron Prompt、API 和任务工作区

**Files:**
- Modify: `code_review_electron/src/shared/types.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `code_review_electron/src/main/api-client.ts`
- Modify: `code_review_electron/src/main/codex-runner.ts`
- Modify: `code_review_electron/src/main/task-agent.ts`
- Modify: `code_review_electron/src/main/report-uploader.ts`
- Test: `code_review_electron/src/main/__tests__/codex-runner.test.ts`
- Test: `code_review_electron/src/main/__tests__/task-agent.test.ts`

- [ ] **Step 1: 写失败测试，验证 prompt 可选输入**

在 `code_review_electron/src/main/__tests__/codex-runner.test.ts` 增加：

```ts
it('includes optional requirement file and focus direction when provided', () => {
  const prompt = buildReviewPrompt({
    svnUrl: 'svn://example.com/repo/project',
    oldRevision: '123',
    newRevision: '130',
    reportPath: '/tmp/review/代码审查报告.md',
    imagesDir: '/tmp/review/images',
    skillName: '通用-代码审查-模版二',
    requirementFilePath: '/tmp/workspaces/task-1/requirements/产品开发需求表.xls',
    focusDirectionSnapshot: '重点检查 SOC 跳变和低电量禁放逻辑'
  })

  expect(prompt).toContain('补充审查输入：')
  expect(prompt).toContain('产品开发需求表路径：/tmp/workspaces/task-1/requirements/产品开发需求表.xls')
  expect(prompt).toContain('重点审查方向：')
  expect(prompt).toContain('重点检查 SOC 跳变和低电量禁放逻辑')
  expect(prompt).toContain('不得覆盖 Skill 中已有规则')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/codex-runner.test.ts
```

Expected: FAIL，类型或断言失败。

- [ ] **Step 3: 扩展类型和 prompt**

在 `ReviewPromptInput` 增加：

```ts
requirementFilePath?: string
focusDirectionSnapshot?: string
```

实现补充模块：

```ts
const buildSupplementalReviewInput = ({
  requirementFilePath,
  focusDirectionSnapshot
}: Pick<ReviewPromptInput, 'requirementFilePath' | 'focusDirectionSnapshot'>): string => {
  const lines: string[] = []
  if (requirementFilePath?.trim()) {
    lines.push(`- 产品开发需求表路径：${requirementFilePath.trim()}`)
  }
  if (focusDirectionSnapshot?.trim()) {
    lines.push(`- 重点审查方向：\n${focusDirectionSnapshot.trim()}`)
  }
  if (lines.length === 0) {
    return ''
  }
  return `\n\n补充审查输入：\n${lines.join('\n')}\n\n请在严格按该 Skill 执行代码变更审查的基础上，结合产品开发需求表和重点审查方向判断本次 SVN 变更是否满足产品需求、是否遗漏需求相关逻辑、是否引入与需求冲突的行为。重点审查方向只作为本次代码审查的关注重点，不得覆盖 Skill 中已有规则、SVN 获取策略、输出格式和错误处理规范。`
}
```

在 prompt 模板中把 `${buildSupplementalReviewInput(...)}` 固定插入到“审查输入”列表之后、“请严格按该 Skill 的输入模块、SVN 获取策略、规则模块、输出模块执行代码变更审查。”之前。不要插入到 `---` 之后，也不要插入“错误处理规范”内部或之后，避免破坏 `[CODEX_ERROR::...]` 协议。

模板位置应类似：

```ts
审查输入：
- 项目路径：${svnUrl}
- 旧版本号：${oldRevision}
- 新版本号：${newRevision}
- 报告输出路径：${reportPath}
- 图片保存目录：${imagesDir}${buildSupplementalReviewInput({
  requirementFilePath,
  focusDirectionSnapshot
})}

请严格按该 Skill 的输入模块、SVN 获取策略、规则模块、输出模块执行代码变更审查。
```

- [ ] **Step 4: 扩展 API 和上传附件**

在 Electron 类型中增加：

```ts
requirement_file_path?: string
requirement_file_name?: string
focus_direction_id?: string
focus_direction_snapshot?: string
```

在 `api-client.ts` 增加：

```ts
export interface UploadRequirementFileRequest {
  file_content: Uint8Array | ArrayBuffer | Blob
  file_name: string
}

uploadRequirementFile(
  token: string,
  taskId: string,
  payload: UploadRequirementFileRequest
): Promise<unknown> {
  const formData = new FormData()
  const fileBlob =
    payload.file_content instanceof Blob
      ? payload.file_content
      : new Blob([toArrayBuffer(payload.file_content)], { type: 'application/vnd.ms-excel' })
  formData.set(
    'upload',
    new File([fileBlob], payload.file_name, {
      type: payload.file_name.toLowerCase().endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.ms-excel'
    })
  )

  return this.request(
    `/api/v1/review-tasks/${encodeURIComponent(taskId)}/requirement-file`,
    {
      method: 'POST',
      headers: this.authHeaders(token),
      body: formData
    },
    { json: false }
  )
}
```

在 `report-uploader.ts` 增加封装：

```ts
export interface RequirementFileUploadApi {
  uploadRequirementFile: ApiClient['uploadRequirementFile']
}

export const uploadRequirementFile = async (
  api: RequirementFileUploadApi,
  token: string,
  taskId: string,
  filePath: string
): Promise<unknown> => {
  const content = await readFile(filePath)
  return api.uploadRequirementFile(token, taskId, {
    file_content: content,
    file_name: basename(filePath)
  })
}
```

- [ ] **Step 5: 实现工作区复制和非阻塞归档**

在 `task-agent.ts` 增加：

```ts
export interface PreparedWorkspace {
  cwd: string
  reportPath: string
  imagesDir: string
  requirementFilePath?: string
}
```

在 `TaskAgentDependencies` 增加必需归档依赖，避免可选链静默跳过服务端附件归档：

```ts
uploadRequirementFile: (token: string, taskId: string, filePath: string) => Promise<unknown>
```

在 `createTaskAgentDependencies` 中接入：

```ts
uploadRequirementFile: (token, taskId, filePath) =>
  uploadRequirementFile(api, token, taskId, filePath),
```

增加 helper：

```ts
const allowedRequirementExtensions = new Set(['.xls', '.xlsx'])

export const prepareRequirementFile = async (
  sourcePath: string | undefined,
  destinationDir: string
): Promise<string | undefined> => {
  const trimmed = sourcePath?.trim()
  if (!trimmed) return undefined
  const sourceStat = await stat(trimmed).catch(() => {
    throw new Error('产品开发需求表不存在，请检查文件路径。')
  })
  if (!sourceStat.isFile()) {
    throw new Error('产品开发需求表路径不是文件，请重新选择。')
  }
  if (sourceStat.size <= 0) {
    throw new Error('产品开发需求表为空，请重新选择。')
  }
  const extension = extname(trimmed).toLowerCase()
  if (!allowedRequirementExtensions.has(extension)) {
    throw new Error('产品开发需求表仅支持 .xls 或 .xlsx 文件。')
  }
  await mkdir(destinationDir, { recursive: true })
  const targetPath = join(destinationDir, basename(trimmed))
  await copyFile(trimmed, targetPath).catch((error) => {
    throw new Error(`产品开发需求表复制失败，请检查文件权限后重试。${error instanceof Error ? error.message : ''}`)
  })
  return targetPath
}
```

`defaultPrepareWorkspace` 调用该 helper，目标目录为 `join(cwd, 'requirements')`。

在 `executeReviewTask` 成功创建 task 后、运行 Codex 前尝试归档：

```ts
if (workspace.requirementFilePath) {
  try {
    await dependencies.uploadRequirementFile(input.token, task.id, workspace.requirementFilePath)
  } catch (error) {
    emitStage(
      onProgress,
      task.id,
      input.clientTaskId,
      'preparing_workspace',
      '产品开发需求表归档失败，审查将继续执行。'
    )
  }
}
```

在 `ipc.ts` 的 `IpcHandlerDependencies` 增加：

```ts
uploadRequirementFile?: TaskAgentDependencies['uploadRequirementFile']
```

在 `task:execute` 调用 `executeReviewTask` 的 dependencies 对象中注入：

```ts
uploadRequirementFile:
  dependencies.uploadRequirementFile ??
  ((token, taskId, filePath) => uploadRequirementFile(taskApi, token, taskId, filePath)),
```

这一步必须和 `TaskAgentDependencies` 同步修改；不允许使用 `?.` 可选调用，否则附件归档失败会被静默跳过。

- [ ] **Step 6: 运行 Electron 主进程测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/codex-runner.test.ts src/main/__tests__/task-agent.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add code_review_electron/src/shared/types.ts code_review_electron/src/renderer/src/code-review-api.ts code_review_electron/src/main/api-client.ts code_review_electron/src/main/codex-runner.ts code_review_electron/src/main/task-agent.ts code_review_electron/src/main/report-uploader.ts code_review_electron/src/main/__tests__/codex-runner.test.ts code_review_electron/src/main/__tests__/task-agent.test.ts
git commit -m "新增审查补充输入和需求表工作区处理"
```

## Task 9: Electron 表单、粘贴文件和队列匹配

**Files:**
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Modify: `code_review_electron/src/preload/index.test.ts`
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.test.tsx`
- Modify: `code_review_electron/src/renderer/src/hooks/useTaskQueue.ts`
- Modify: `code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx`

- [ ] **Step 1: 写失败测试，验证 TaskForm 提交新增字段**

在 `TaskForm.test.tsx` 增加：

```tsx
it('提交时包含产品开发需求表路径和重点审查方向', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn(async () => undefined)
  render(<TaskForm disabled={false} onSubmit={onSubmit} />)

  await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
  await user.type(screen.getByLabelText('旧版本号'), '12')
  await user.type(screen.getByLabelText('新版本号'), '14')
  await user.type(screen.getByLabelText('产品开发需求表'), '/tmp/产品开发需求表.xls')
  await user.type(screen.getByLabelText('重点审查方向'), '重点检查 SOC 跳变')
  await user.click(screen.getByRole('button', { name: '开始审查' }))

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      requirement_file_path: '/tmp/产品开发需求表.xls',
      focus_direction_snapshot: '重点检查 SOC 跳变'
    })
  )
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskForm.test.tsx
```

Expected: FAIL，找不到新增输入。

- [ ] **Step 3: 新增选择文件和粘贴文件 IPC，并同步测试 mock**

在 `ipc.ts` 引入 `dialog`：

```ts
import { dialog, ipcMain, shell } from 'electron'
```

注册：

```ts
ipcMain.handle('requirement-file:select', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Excel 文件', extensions: ['xls', 'xlsx'] }]
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { status: 'cancelled' as const }
  }
  return { status: 'selected' as const, filePath: result.filePaths[0] }
})
```

在 preload 暴露：

```ts
selectRequirementFile: (): Promise<SelectRequirementFileResult> =>
  ipcRenderer.invoke('requirement-file:select'),
getPathForPastedFile: (file: File): string => webUtils.getPathForFile(file),
```

在 preload 中直接从 `electron` 引入 `webUtils`：

```ts
import { contextBridge, ipcRenderer, webUtils } from 'electron'
```

同步更新 `code_review_electron/src/main/__tests__/ipc.test.ts`：

- 在 `vi.mock('electron', ...)` 中补充 `dialog.showOpenDialog` mock。
- 在 `registers only the renderer-facing IPC channels` 的 `toEqual([...])` 数组中，按实际注册位置加入 `'requirement-file:select'`。建议放在 `'task:report'` 之后、`'codex:install'` 之前，和 `ipc.ts` 中注册顺序一致。
- 新增测试覆盖选择文件成功和取消：

```ts
const showOpenDialogMock = vi.fn()

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: showOpenDialogMock
  },
  // 保留现有 mock 字段
}))

it('selects a requirement Excel file through IPC', async () => {
  showOpenDialogMock.mockResolvedValue({
    canceled: false,
    filePaths: ['/tmp/产品开发需求表.xls']
  })
  const { registerIpcHandlers } = await import('../ipc')
  registerIpcHandlers()

  const handler = handleMock.mock.calls.find(
    ([channel]) => channel === 'requirement-file:select'
  )?.[1]

  await expect(handler()).resolves.toEqual({
    status: 'selected',
    filePath: '/tmp/产品开发需求表.xls'
  })
})

it('returns cancelled when requirement file dialog is cancelled', async () => {
  showOpenDialogMock.mockResolvedValue({
    canceled: true,
    filePaths: []
  })
  const { registerIpcHandlers } = await import('../ipc')
  registerIpcHandlers()

  const handler = handleMock.mock.calls.find(
    ([channel]) => channel === 'requirement-file:select'
  )?.[1]

  await expect(handler()).resolves.toEqual({
    status: 'cancelled'
  })
})
```

同步更新 `code_review_electron/src/preload/index.test.ts`：

- 在 electron mock 中补充 `webUtils.getPathForFile`。
- 新增测试确认 `api.getPathForPastedFile(file)` 会调用 `webUtils.getPathForFile(file)`。

```ts
const getPathForFileMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock
  },
  ipcRenderer: {
    invoke: invokeMock,
    on: vi.fn(),
    removeListener: vi.fn()
  },
  webUtils: {
    getPathForFile: getPathForFileMock
  }
}))

it('reads pasted file path through Electron webUtils', async () => {
  getPathForFileMock.mockReturnValue('/tmp/产品开发需求表.xlsx')
  await import('./index')
  const api = exposeInMainWorldMock.mock.calls[0][1]
  const file = new File(['x'], '产品开发需求表.xlsx')

  expect(api.getPathForPastedFile(file)).toBe('/tmp/产品开发需求表.xlsx')
  expect(getPathForFileMock).toHaveBeenCalledWith(file)
})
```

- [ ] **Step 4: 更新 TaskForm**

新增 state：

```tsx
const [requirementFilePath, setRequirementFilePath] = useState('')
const [focusDirectionSnapshot, setFocusDirectionSnapshot] = useState('')
const [requirementFileError, setRequirementFileError] = useState('')
```

新增输入：

```tsx
<label className="field">
  <span>产品开发需求表</span>
  <input
    aria-label="产品开发需求表"
    value={requirementFilePath}
    placeholder="选择、粘贴 Excel 文件或粘贴本机路径"
    onPaste={handleRequirementFilePaste}
    onChange={(event) => setRequirementFilePath(event.target.value)}
  />
</label>
<button type="button" className="secondary-button" onClick={handleSelectRequirementFile}>
  选择文件
</button>
{requirementFileError && <p className="form-error">{requirementFileError}</p>}

<label className="field">
  <span>重点审查方向</span>
  <textarea
    aria-label="重点审查方向"
    maxLength={4096}
    value={focusDirectionSnapshot}
    onChange={(event) => setFocusDirectionSnapshot(event.target.value)}
  />
</label>
```

粘贴 handler：

```tsx
const handleRequirementFilePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
  const file = Array.from(event.clipboardData.files).find((item) =>
    /\.(xls|xlsx)$/i.test(item.name)
  )
  if (!file) return
  event.preventDefault()
  try {
    const filePath = window.codeReview.getPathForPastedFile(file)
    if (!filePath) {
      setRequirementFileError('无法读取粘贴文件路径，请使用选择文件按钮。')
      return
    }
    setRequirementFilePath(filePath)
    setRequirementFileError('')
  } catch {
    setRequirementFileError('无法读取粘贴文件路径，请使用选择文件按钮。')
  }
}
```

提交 payload 增加：

```tsx
requirement_file_path: requirementFilePath.trim() || undefined,
requirement_file_name: requirementFilePath.trim() ? basenameLike(requirementFilePath.trim()) : undefined,
focus_direction_snapshot: focusDirectionSnapshot.trim() || undefined,
```

实现 `basenameLike`：

```tsx
const basenameLike = (value: string): string =>
  value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
```

- [ ] **Step 5: 更新队列匹配**

在 `useTaskQueue.ts` 的本地 task 增加新字段：

```ts
requirement_file_path: payload.requirement_file_path,
requirement_file_name: payload.requirement_file_name,
focus_direction_id: payload.focus_direction_id,
focus_direction_snapshot: payload.focus_direction_snapshot,
```

`startTask` 调用 `executeTask` 时传递这些字段。

`isMatchingUnboundLocalTask` 增加比较：

```ts
(localTask.focus_direction_snapshot ?? undefined) === (serverTask.focus_direction_snapshot ?? undefined) &&
(localTask.requirement_file_name ?? undefined) === (serverTask.requirement_file_name ?? undefined)
```

执行时必须保证 `requirement_file_name` 在提交前已经过同一套安全文件名规则处理，至少要去掉目录分隔符并取 basename。`TaskForm` 的 `basenameLike` 输出要和后端 `save_requirement_upload` 的 `_safe_filename` 对普通 Windows/macOS 路径产生相同结果，避免同一任务因为文件名不一致而无法绑定服务端任务。

- [ ] **Step 6: 运行 Electron 渲染层测试**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskForm.test.tsx src/renderer/src/hooks/useTaskQueue.test.tsx src/preload/index.test.ts src/main/__tests__/ipc.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add code_review_electron/src/main/ipc.ts code_review_electron/src/preload/index.ts code_review_electron/src/preload/index.test.ts code_review_electron/src/renderer/src/components/TaskForm.tsx code_review_electron/src/renderer/src/components/TaskForm.test.tsx code_review_electron/src/renderer/src/hooks/useTaskQueue.ts code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx
git commit -m "新增客户端需求表和重点审查方向输入"
```

## Task 10: 全量验证和兼容回归

**Files:**
- Test: backend, frontend, electron suites.
- Modify: only files directly required to fix failures found by the commands in this task.

- [ ] **Step 1: 后端全量测试**

Run:

```bash
cd code_review_server/backend
pytest -q
```

Expected: PASS。

- [ ] **Step 2: Web 前端构建**

Run:

```bash
cd code_review_server/frontend
npm run build
```

Expected: PASS。

- [ ] **Step 3: Electron 测试和类型检查**

Run:

```bash
cd code_review_electron
npm test
npm run typecheck
```

Expected: PASS。

- [ ] **Step 4: 手工联调检查**

Run server and client using the repo's normal development commands. Verify:

```text
1. 不填写产品开发需求表和重点审查方向，仍可提交任务。
2. 粘贴 Excel 路径后提交任务，Codex prompt 包含工作区副本路径。
3. 填写重点审查方向后提交任务，服务端任务详情包含该快照。
4. 服务端附件上传失败时，Electron 显示中文归档失败提示并继续审查。
5. 管理员可创建部门、给用户绑定部门。
6. 管理员可查看重点审查方向统计，并沉淀为方向库条目。
7. 历史任务没有新字段时仍可查看 Markdown 和 PDF。
```

- [ ] **Step 5: 提交验证修复或记录无需修复**

如果 Step 1-4 暴露真实回归，先修复对应业务或测试夹具文件，然后提交：

```bash
git status --short
git add code_review_server code_review_electron
git commit -m "修复审查输入功能回归问题"
```

如果 Step 1-4 全部通过，运行：

```bash
git status --short
```

Expected: 没有未提交的测试修复文件；不创建空提交。

## 自检清单

- Spec 覆盖：
  - 产品开发需求表路径、粘贴文件、工作区复制、服务端附件归档：Task 4、Task 8、Task 9。
  - 重点审查方向自由输入、任务快照、统计和沉淀：Task 3、Task 5、Task 7、Task 9。
  - 正式部门、用户部门、任务部门快照、预留部门管理员扩展：Task 1、Task 2、Task 3、Task 6、Task 7。
  - 中文错误提示：Task 2、Task 4、Task 8、Task 9。
  - 旧客户端和历史任务兼容：Task 1、Task 3、Task 10。
- 类型一致：
  - 后端字段使用 `department_id`、`department_name`、`focus_direction_id`、`focus_direction_snapshot`、`requirement_file_name`、`requirement_file_size`、`requirement_file_sha256`。
  - Electron 本地路径字段使用 `requirement_file_path`，服务端归档字段使用 `requirement_file_*` 元数据。
  - 方向库路径统一为 `/api/v1/review-focus-directions`。
- 验证命令：
  - 后端：`pytest -q`。
  - Web：`npm run build`、`bunx playwright test ...`。
  - Electron：`npm test`、`npm run typecheck`。
