# 重点审查方向后台增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强后台“重点审查方向”页面，支持 Tab 切换、方向库多部门归属、筛选、用户输入统计手动使用状态和 Excel 导出。

**Architecture:** 后端新增方向-部门关联表和用户输入统计状态表，方向库和统计接口统一支持服务端筛选。前端保留现有页面入口，将页面拆成两个 Tab，并新增部门多选、筛选栏、导出和状态标记操作。本期不改 Electron 客户端方向选择。

**Tech Stack:** FastAPI + SQLModel + Alembic + PostgreSQL；React + TanStack Query + Radix UI/shadcn 组件 + Playwright；OpenAPI 生成前端 SDK。

---

## 文件结构

后端：

- 修改 `code_review_server/backend/app/models.py`
  - 新增 `ReviewFocusDirectionDepartment`。
  - 新增 `ReviewFocusDirectionUsageState`。
  - 扩展 `ReviewFocusDirectionCreate`、`ReviewFocusDirectionUpdate`、`ReviewFocusDirectionPublic`、`ReviewFocusDirectionUsageStatPublic`。
  - 新增 `ReviewFocusDirectionUsageStateUpdate`。
- 新增 `code_review_server/backend/app/alembic/versions/20260622_review_focus_admin_enhancement.py`
  - `down_revision = "20260615reviewinputs"`。
  - 新建关联表和统计状态表。
  - 迁移旧 `review_focus_direction.department_id` 数据到新关联表。
  - 新表和新增字段全部添加中文备注。
- 修改 `code_review_server/backend/app/api/routes/review_focus_directions.py`
  - 方向库查询支持关键词、部门、状态筛选。
  - 创建 / 更新方向支持 `department_ids`。
  - 统计查询支持关键词、部门、使用状态筛选。
  - 新增统计项手动标记接口。
  - 新增统计 Excel 导出接口。
- 修改 `code_review_server/backend/app/api/routes/departments.py`
  - 部门删除保护检查新的方向-部门关联表。
- 修改 `code_review_server/backend/pyproject.toml` 和 `code_review_server/uv.lock`
  - 增加 `openpyxl` 用于生成 Excel。
- 修改 `code_review_server/backend/tests/api/routes/test_review_focus_directions.py`
  - 覆盖多部门、筛选、使用状态和导出。
- 修改 `code_review_server/backend/tests/api/routes/test_departments.py`
  - 覆盖有关联方向的部门不能删除。

前端：

- 生成修改 `code_review_server/frontend/src/client/types.gen.ts`
- 生成修改 `code_review_server/frontend/src/client/schemas.gen.ts`
- 生成修改 `code_review_server/frontend/src/client/sdk.gen.ts`
- 新增 `code_review_server/frontend/src/components/Departments/DepartmentMultiSelect.tsx`
  - 部门多选，空数组表示全局。
- 修改 `code_review_server/frontend/src/components/Admin/ReviewFocusDirectionsPage.tsx`
  - 两个 Tab。
  - 方向库 Tab 内放 `新增方向`。
  - 方向库筛选。
  - 用户输入统计筛选、导出、标记已使用。
  - `沉淀为方向` 文案改为 `沉淀`。
- 修改 `code_review_server/frontend/tests/review-focus-directions.spec.ts`
  - 覆盖 Tab、筛选、多部门、沉淀、标记、导出。

---

### Task 1: 后端模型、迁移和中文备注

**Files:**
- Modify: `code_review_server/backend/app/models.py`
- Create: `code_review_server/backend/app/alembic/versions/20260622_review_focus_admin_enhancement.py`
- Modify: `code_review_server/backend/tests/api/routes/test_review_focus_directions.py`
- Modify: `code_review_server/backend/tests/api/routes/test_departments.py`

- [ ] **Step 1: 写失败测试 - 多部门方向创建和返回**

在 `code_review_server/backend/tests/api/routes/test_review_focus_directions.py` 增加测试：

```python
def test_admin_can_create_focus_direction_with_multiple_departments(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department_a = _create_department(db, "多部门A-" + random_lower_string())
    department_b = _create_department(db, "多部门B-" + random_lower_string())

    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json={
            "title": "多部门方向",
            "content": "检查跨部门公共逻辑",
            "department_ids": [str(department_a.id), str(department_b.id)],
            "is_active": True,
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["title"] == "多部门方向"
    assert content["department_id"] is None
    assert content["department_name"] is None
    assert {item["id"] for item in content["departments"]} == {
        str(department_a.id),
        str(department_b.id),
    }
    assert {item["name"] for item in content["departments"]} == {
        department_a.name,
        department_b.name,
    }
```

- [ ] **Step 2: 写失败测试 - 全局方向返回空 departments**

在同一测试文件增加：

```python
def test_admin_can_create_global_focus_direction_with_empty_department_ids(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json={
            "title": "全局方向",
            "content": "检查所有部门通用风险",
            "department_ids": [],
            "is_active": True,
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["department_id"] is None
    assert content["department_name"] is None
    assert content["departments"] == []
```

- [ ] **Step 3: 写失败测试 - 部门删除保护检查新关联表**

在 `code_review_server/backend/tests/api/routes/test_departments.py` 增加：

```python
def test_delete_department_linked_by_focus_direction_department_returns_409(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department_payload = _create_department(client, superuser_token_headers)
    response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json={
            "title": "关联部门方向",
            "content": "检查部门关联删除保护",
            "department_ids": [department_payload["id"]],
            "is_active": True,
        },
    )
    assert response.status_code == 200

    delete_response = client.delete(
        f"{settings.API_V1_STR}/departments/{department_payload['id']}",
        headers=superuser_token_headers,
    )

    assert delete_response.status_code == 409
    assert (
        delete_response.json()["detail"]
        == "该部门已关联用户、任务或重点审查方向，不能删除，请先停用。"
    )
```

- [ ] **Step 4: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
source ../.env
export POSTGRES_SERVER=127.0.0.1
export POSTGRES_PORT=15543
export CODE_REVIEW_TEST_POSTGRES_DB=review_inputs_manual_20260616_test
/Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_server/.venv/bin/python -m pytest \
  tests/api/routes/test_review_focus_directions.py::test_admin_can_create_focus_direction_with_multiple_departments \
  tests/api/routes/test_review_focus_directions.py::test_admin_can_create_global_focus_direction_with_empty_department_ids \
  tests/api/routes/test_departments.py::test_delete_department_linked_by_focus_direction_department_returns_409 \
  -q
```

Expected: 失败，原因是 `department_ids` / `departments` 尚未实现，或部门删除保护未检查新关联表。

- [ ] **Step 5: 修改模型**

在 `code_review_server/backend/app/models.py` 增加模型和字段。保留旧 `department_id` 字段作为兼容字段：

```python
class ReviewFocusDirectionDepartment(SQLModel, table=True):
    __tablename__ = "review_focus_direction_department"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    direction_id: uuid.UUID = Field(
        foreign_key="review_focus_direction.id",
        nullable=False,
        index=True,
    )
    department_id: uuid.UUID = Field(
        foreign_key="department.id",
        nullable=False,
        index=True,
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
```

增加使用状态表：

```python
class ReviewFocusDirectionUsageState(SQLModel, table=True):
    __tablename__ = "review_focus_direction_usage_state"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    normalized_content: str = Field(min_length=1, max_length=4096, unique=True, index=True)
    is_used: bool = Field(default=False, index=True)
    updated_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id")
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
```

扩展方向 schema：

```python
class ReviewFocusDirectionCreate(SQLModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=4096)
    department_id: uuid.UUID | None = None
    department_ids: list[uuid.UUID] | None = None
    is_active: bool = True


class ReviewFocusDirectionUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, min_length=1, max_length=4096)
    department_id: uuid.UUID | None = Field(default=None)
    department_ids: list[uuid.UUID] | None = None
    is_active: bool | None = None


class ReviewFocusDirectionPublic(SQLModel):
    id: uuid.UUID
    title: str
    content: str
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    departments: list[DepartmentPublic] = Field(default_factory=list)
    is_active: bool
    usage_count: int
    created_by_user_id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
```

扩展统计 schema：

```python
class ReviewFocusDirectionUsageStatPublic(SQLModel):
    content: str
    usage_count: int
    latest_used_at: datetime | None = None
    departments: list[str] = Field(default_factory=list)
    is_used: bool = False


class ReviewFocusDirectionUsageStateUpdate(SQLModel):
    content: str = Field(min_length=1, max_length=4096)
    is_used: bool
```

- [ ] **Step 6: 新增 Alembic 迁移**

创建 `code_review_server/backend/app/alembic/versions/20260622_review_focus_admin_enhancement.py`，使用 `down_revision = "20260615reviewinputs"`。

迁移必须包含表和字段中文备注。核心内容：

```python
"""enhance review focus admin

Revision ID: 20260622focusadmin
Revises: 20260615reviewinputs
Create Date: 2026-06-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy.dialects import postgresql


revision = "20260622focusadmin"
down_revision = "20260615reviewinputs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_focus_direction_department",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="重点审查方向与部门关联记录ID。"),
        sa.Column("direction_id", postgresql.UUID(as_uuid=True), nullable=False, comment="关联的重点审查方向ID。"),
        sa.Column("department_id", postgresql.UUID(as_uuid=True), nullable=False, comment="关联的部门ID，表示该方向适用于该部门。"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, comment="关联记录创建时间。"),
        sa.ForeignKeyConstraint(["department_id"], ["department.id"]),
        sa.ForeignKeyConstraint(["direction_id"], ["review_focus_direction.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("direction_id", "department_id", name="uq_review_focus_direction_department"),
        comment="重点审查方向与部门的多对多关联表。",
    )
    op.create_index(
        op.f("ix_review_focus_direction_department_direction_id"),
        "review_focus_direction_department",
        ["direction_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_review_focus_direction_department_department_id"),
        "review_focus_direction_department",
        ["department_id"],
        unique=False,
    )

    op.create_table(
        "review_focus_direction_usage_state",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="用户输入统计使用状态记录ID。"),
        sa.Column(
            "normalized_content",
            sqlmodel.sql.sqltypes.AutoString(length=4096),
            nullable=False,
            comment="规范化后的重点审查方向内容，用于和统计聚合结果匹配。",
        ),
        sa.Column("is_used", sa.Boolean(), nullable=False, server_default=sa.false(), comment="管理员是否已处理或使用该用户输入统计项。"),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True, comment="最后一次标记使用状态的管理员用户ID。"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, comment="使用状态记录创建时间。"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, comment="使用状态最后更新时间。"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        comment="用户输入统计项的人工使用状态表。",
    )
    op.create_index(
        op.f("ix_review_focus_direction_usage_state_normalized_content"),
        "review_focus_direction_usage_state",
        ["normalized_content"],
        unique=True,
    )
    op.create_index(
        op.f("ix_review_focus_direction_usage_state_is_used"),
        "review_focus_direction_usage_state",
        ["is_used"],
        unique=False,
    )

    op.execute(
        """
        INSERT INTO review_focus_direction_department (id, direction_id, department_id, created_at)
        SELECT gen_random_uuid(), id, department_id, created_at
        FROM review_focus_direction
        WHERE department_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_review_focus_direction_usage_state_is_used"),
        table_name="review_focus_direction_usage_state",
    )
    op.drop_index(
        op.f("ix_review_focus_direction_usage_state_normalized_content"),
        table_name="review_focus_direction_usage_state",
    )
    op.drop_table("review_focus_direction_usage_state")
    op.drop_index(
        op.f("ix_review_focus_direction_department_department_id"),
        table_name="review_focus_direction_department",
    )
    op.drop_index(
        op.f("ix_review_focus_direction_department_direction_id"),
        table_name="review_focus_direction_department",
    )
    op.drop_table("review_focus_direction_department")
```

- [ ] **Step 7: 更新测试清理**

在 `code_review_server/backend/tests/conftest.py` 导入并清理新表，顺序必须先删关联表和状态表，再删方向表。

增加 imports：

```python
ReviewFocusDirectionDepartment,
ReviewFocusDirectionUsageState,
```

在 cleanup 中加：

```python
if inspector.has_table("review_focus_direction_department"):
    session.exec(delete(ReviewFocusDirectionDepartment))
if inspector.has_table("review_focus_direction_usage_state"):
    session.exec(delete(ReviewFocusDirectionUsageState))
```

- [ ] **Step 8: 实现最小后端代码让测试通过**

先在 `review_focus_directions.py` 增加辅助函数：

```python
def _department_ids_from_input(direction_in: ReviewFocusDirectionCreate | ReviewFocusDirectionUpdate) -> list[uuid.UUID] | None:
    if direction_in.department_ids is not None:
        return direction_in.department_ids
    if direction_in.department_id is not None:
        return [direction_in.department_id]
    return None
```

增加读取部门：

```python
def _get_departments_or_400(*, session: SessionDep, department_ids: list[uuid.UUID]) -> list[Department]:
    if not department_ids:
        return []
    departments = session.exec(
        select(Department).where(col(Department.id).in_(department_ids))
    ).all()
    if len({department.id for department in departments}) != len(set(department_ids)):
        raise HTTPException(status_code=400, detail="部门不存在。")
    return departments
```

增加关联替换：

```python
def _replace_direction_departments(
    *,
    session: SessionDep,
    direction: ReviewFocusDirection,
    departments: list[Department],
) -> None:
    session.exec(
        delete(ReviewFocusDirectionDepartment).where(
            ReviewFocusDirectionDepartment.direction_id == direction.id
        )
    )
    for department in departments:
        session.add(
            ReviewFocusDirectionDepartment(
                direction_id=direction.id,
                department_id=department.id,
            )
        )
    if len(departments) == 1:
        direction.department_id = departments[0].id
    else:
        direction.department_id = None
```

更新 `_direction_public` 支持多部门：

```python
def _direction_public(
    direction: ReviewFocusDirection,
    departments: list[Department] | None = None,
) -> ReviewFocusDirectionPublic:
    departments = departments or []
    legacy_department = departments[0] if len(departments) == 1 else None
    return ReviewFocusDirectionPublic.model_validate(
        direction,
        update={
            "department_id": legacy_department.id if legacy_department else None,
            "department_name": legacy_department.name if legacy_department else None,
            "departments": [
                DepartmentPublic.model_validate(department)
                for department in departments
            ],
        },
    )
```

在创建、更新后调用 `_replace_direction_departments` 并返回 `_direction_public(direction, departments)`。

在 `departments.py` 删除保护中增加：

```python
exists().where(col(ReviewFocusDirectionDepartment.department_id) == department_id),
```

- [ ] **Step 9: 运行测试确认通过**

Run:

```bash
cd code_review_server/backend
source ../.env
export POSTGRES_SERVER=127.0.0.1
export POSTGRES_PORT=15543
export CODE_REVIEW_TEST_POSTGRES_DB=review_inputs_manual_20260616_test
/Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_server/.venv/bin/python -m pytest \
  tests/api/routes/test_review_focus_directions.py \
  tests/api/routes/test_departments.py \
  -q
```

Expected: 全部通过。

- [ ] **Step 10: 提交**

```bash
git add \
  code_review_server/backend/app/models.py \
  code_review_server/backend/app/alembic/versions/20260622_review_focus_admin_enhancement.py \
  code_review_server/backend/app/api/routes/review_focus_directions.py \
  code_review_server/backend/app/api/routes/departments.py \
  code_review_server/backend/tests/conftest.py \
  code_review_server/backend/tests/api/routes/test_review_focus_directions.py \
  code_review_server/backend/tests/api/routes/test_departments.py
git commit -m "新增重点审查方向多部门数据模型"
```

---

### Task 2: 后端筛选、统计状态和 Excel 导出

**Files:**
- Modify: `code_review_server/backend/pyproject.toml`
- Modify: `code_review_server/uv.lock`
- Modify: `code_review_server/backend/app/api/routes/review_focus_directions.py`
- Modify: `code_review_server/backend/tests/api/routes/test_review_focus_directions.py`

- [ ] **Step 1: 写失败测试 - 方向库关键词、部门、状态筛选**

在 `test_review_focus_directions.py` 增加：

```python
def test_admin_can_filter_focus_directions(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department_a = _create_department(db, "筛选部门A-" + random_lower_string())
    department_b = _create_department(db, "筛选部门B-" + random_lower_string())
    active_response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json={
            "title": "缓存穿透审查",
            "content": "检查缓存穿透和慢查询",
            "department_ids": [str(department_a.id)],
            "is_active": True,
        },
    )
    inactive_response = client.post(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        json={
            "title": "权限边界审查",
            "content": "检查权限边界",
            "department_ids": [str(department_b.id)],
            "is_active": False,
        },
    )
    assert active_response.status_code == 200
    assert inactive_response.status_code == 200

    response = client.get(
        f"{settings.API_V1_STR}/review-focus-directions",
        headers=superuser_token_headers,
        params={
            "search": "缓存",
            "department_scope": "department",
            "department_id": str(department_a.id),
            "is_active": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["title"] == "缓存穿透审查"
```

- [ ] **Step 2: 写失败测试 - 用户输入统计状态默认 false 和手动标记**

增加：

```python
def test_admin_can_mark_usage_stat_used_state(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department = _create_department(db, "统计状态部门-" + random_lower_string())
    _create_task_with_focus_snapshot(
        client=client,
        db=db,
        department=department,
        snapshot="检查空指针和越界",
        minutes_ago=1,
    )

    stats_response = client.get(
        f"{settings.API_V1_STR}/review-focus-directions/usage-stats",
        headers=superuser_token_headers,
        params={"search": "空指针"},
    )
    assert stats_response.status_code == 200
    stat = stats_response.json()["data"][0]
    assert stat["content"] == "检查空指针和越界"
    assert stat["is_used"] is False

    mark_response = client.patch(
        f"{settings.API_V1_STR}/review-focus-directions/usage-stats/state",
        headers=superuser_token_headers,
        json={"content": " 检查空指针和越界 ", "is_used": True},
    )
    assert mark_response.status_code == 200
    assert mark_response.json()["message"] == "使用状态更新成功"

    used_response = client.get(
        f"{settings.API_V1_STR}/review-focus-directions/usage-stats",
        headers=superuser_token_headers,
        params={"search": "空指针", "is_used": True},
    )
    assert used_response.status_code == 200
    assert used_response.json()["count"] == 1
    assert used_response.json()["data"][0]["is_used"] is True
```

- [ ] **Step 3: 写失败测试 - 用户输入统计按部门和使用状态筛选**

增加：

```python
def test_admin_can_filter_usage_stats_by_department_and_used_state(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department_a = _create_department(db, "统计筛选A-" + random_lower_string())
    department_b = _create_department(db, "统计筛选B-" + random_lower_string())
    _create_task_with_focus_snapshot(
        client=client,
        db=db,
        department=department_a,
        snapshot="检查状态机跳转",
        minutes_ago=2,
    )
    _create_task_with_focus_snapshot(
        client=client,
        db=db,
        department=department_b,
        snapshot="检查协议兼容",
        minutes_ago=1,
    )
    mark_response = client.patch(
        f"{settings.API_V1_STR}/review-focus-directions/usage-stats/state",
        headers=superuser_token_headers,
        json={"content": "检查状态机跳转", "is_used": True},
    )
    assert mark_response.status_code == 200

    response = client.get(
        f"{settings.API_V1_STR}/review-focus-directions/usage-stats",
        headers=superuser_token_headers,
        params={
            "department_scope": "department",
            "department_id": str(department_a.id),
            "is_used": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["content"] == "检查状态机跳转"
```

- [ ] **Step 4: 写失败测试 - Excel 导出当前筛选结果**

增加：

```python
def test_admin_can_export_filtered_usage_stats_excel(
    client: TestClient,
    db: Session,
    superuser_token_headers: dict[str, str],
) -> None:
    department = _create_department(db, "导出部门-" + random_lower_string())
    _create_task_with_focus_snapshot(
        client=client,
        db=db,
        department=department,
        snapshot="导出检查项",
        minutes_ago=1,
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-focus-directions/usage-stats/export",
        headers=superuser_token_headers,
        params={"search": "导出检查"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "重点审查方向用户输入统计_" in response.headers["content-disposition"]
    assert len(response.content) > 100
```

- [ ] **Step 5: 运行测试确认失败**

Run:

```bash
cd code_review_server/backend
source ../.env
export POSTGRES_SERVER=127.0.0.1
export POSTGRES_PORT=15543
export CODE_REVIEW_TEST_POSTGRES_DB=review_inputs_manual_20260616_test
/Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_server/.venv/bin/python -m pytest tests/api/routes/test_review_focus_directions.py -q
```

Expected: 失败，原因是筛选参数、状态接口、导出接口尚未实现。

- [ ] **Step 6: 添加 openpyxl 依赖**

Run:

```bash
cd code_review_server
uv add --project backend "openpyxl>=3.1.5,<4.0.0"
```

Expected: `backend/pyproject.toml` 增加 `openpyxl`，`uv.lock` 更新。

- [ ] **Step 7: 实现查询和统计辅助函数**

在 `review_focus_directions.py` 增加 imports：

```python
from io import BytesIO
from urllib.parse import quote
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import delete
```

增加 scope 类型和统计构建函数：

```python
DepartmentScope = Literal["all", "global", "department"]


def _normalize_search(search: str | None) -> str:
    return search.strip() if search else ""
```

把现有 `read_usage_stats` 的聚合逻辑抽成：

```python
def _build_usage_stats(
    *,
    session: SessionDep,
    search: str | None = None,
    department_scope: str = "all",
    department_id: uuid.UUID | None = None,
    is_used: bool | None = None,
) -> list[ReviewFocusDirectionUsageStatPublic]:
    normalized_search = _normalize_search(search).lower()
    rows = session.exec(
        select(
            ReviewTask.focus_direction_snapshot,
            ReviewTask.created_at,
            ReviewTask.department_id,
            ReviewTask.department_name,
        ).where(ReviewTask.focus_direction_snapshot.is_not(None))
    ).all()

    stats: dict[str, dict[str, Any]] = {}
    for snapshot, created_at, row_department_id, department_name in rows:
        if snapshot is None:
            continue
        content = _normalize_content(snapshot)
        if not content:
            continue
        if normalized_search and normalized_search not in content.lower():
            continue
        if department_scope == "global" and row_department_id is not None:
            continue
        if department_scope == "department" and department_id is not None and row_department_id != department_id:
            continue

        stat = stats.setdefault(
            content,
            {
                "usage_count": 0,
                "latest_used_at": None,
                "departments": set(),
                "department_ids": set(),
            },
        )
        stat["usage_count"] += 1
        if created_at is not None and (
            stat["latest_used_at"] is None or created_at > stat["latest_used_at"]
        ):
            stat["latest_used_at"] = created_at
        if department_name:
            stat["departments"].add(department_name)
        if row_department_id:
            stat["department_ids"].add(row_department_id)

    states = {}
    if stats:
        state_rows = session.exec(
            select(ReviewFocusDirectionUsageState).where(
                col(ReviewFocusDirectionUsageState.normalized_content).in_(stats.keys())
            )
        ).all()
        states = {state.normalized_content: state for state in state_rows}

    data = []
    for content, stat in stats.items():
        used = states.get(content).is_used if states.get(content) else False
        if is_used is not None and used != is_used:
            continue
        data.append(
            ReviewFocusDirectionUsageStatPublic(
                content=content,
                usage_count=stat["usage_count"],
                latest_used_at=stat["latest_used_at"],
                departments=sorted(stat["departments"]),
                is_used=used,
            )
        )

    return sorted(data, key=lambda item: (-item.usage_count, item.content))
```

实现要求：

- 从 `ReviewTask.focus_direction_snapshot`、`ReviewTask.created_at`、`ReviewTask.department_id`、`ReviewTask.department_name` 查询。
- 空白内容跳过。
- `search` 对规范化 content 做大小写不敏感包含匹配。
- `department_scope == "global"` 时只保留没有部门的统计项。
- `department_scope == "department"` 且有 `department_id` 时只保留该部门统计项。
- 从 `ReviewFocusDirectionUsageState` 一次性查询所有匹配 content 的状态。
- `is_used` 参数不为空时过滤结果。

- [ ] **Step 8: 实现方向库筛选**

更新 `read_review_focus_directions` 签名：

```python
def read_review_focus_directions(
    session: SessionDep,
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    department_scope: str = "all",
    department_id: uuid.UUID | None = None,
    is_active: bool | None = None,
) -> Any:
```

实现规则：

- `search` 同时匹配 `ReviewFocusDirection.title` 和 `ReviewFocusDirection.content`。
- `is_active` 非空时过滤启停。
- `department_scope == "global"`：返回没有任何关联部门的方向。
- `department_scope == "department"`：必须传 `department_id`，返回关联该部门的方向。
- `department_scope == "all"`：不按部门过滤。
- count 和 data 使用同一组 filters。

- [ ] **Step 9: 实现状态标记接口**

新增 route：

```python
@router.patch(
    "/usage-stats/state",
    dependencies=[Depends(_ensure_admin)],
    response_model=Message,
)
def update_usage_state(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    state_in: ReviewFocusDirectionUsageStateUpdate,
) -> Message:
    content = _normalize_content(state_in.content)
    if not content:
        raise HTTPException(status_code=400, detail="用户输入内容不能为空。")
    state = session.exec(
        select(ReviewFocusDirectionUsageState).where(
            ReviewFocusDirectionUsageState.normalized_content == content
        )
    ).first()
    now = get_datetime_utc()
    if state is None:
        state = ReviewFocusDirectionUsageState(
            normalized_content=content,
            is_used=state_in.is_used,
            updated_by_user_id=current_user.id,
            created_at=now,
            updated_at=now,
        )
    else:
        state.is_used = state_in.is_used
        state.updated_by_user_id = current_user.id
        state.updated_at = now
    session.add(state)
    session.commit()
    return Message(message="使用状态更新成功")
```

- [ ] **Step 10: 实现 Excel 导出接口**

新增 route：

```python
@router.get(
    "/usage-stats/export",
    dependencies=[Depends(_ensure_admin)],
)
def export_usage_stats(
    session: SessionDep,
    search: str | None = None,
    department_scope: str = "all",
    department_id: uuid.UUID | None = None,
    is_used: bool | None = None,
) -> StreamingResponse:
    stats = _build_usage_stats(
        session=session,
        search=search,
        department_scope=department_scope,
        department_id=department_id,
        is_used=is_used,
    )
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "用户输入统计"
    sheet.append(["内容", "使用次数", "涉及部门", "最新使用时间", "是否已使用"])
    for stat in stats:
        sheet.append([
            stat.content,
            stat.usage_count,
            "、".join(stat.departments) if stat.departments else "全局",
            stat.latest_used_at.isoformat() if stat.latest_used_at else "",
            "已使用" if stat.is_used else "未使用",
        ])
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    file_name = f"重点审查方向用户输入统计_{get_datetime_utc().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(file_name)}"},
    )
```

- [ ] **Step 11: 运行后端测试**

Run:

```bash
cd code_review_server/backend
source ../.env
export POSTGRES_SERVER=127.0.0.1
export POSTGRES_PORT=15543
export CODE_REVIEW_TEST_POSTGRES_DB=review_inputs_manual_20260616_test
/Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_server/.venv/bin/python -m pytest tests/api/routes/test_review_focus_directions.py tests/api/routes/test_departments.py -q
```

Expected: 全部通过。

- [ ] **Step 12: 提交**

```bash
git add \
  code_review_server/backend/pyproject.toml \
  code_review_server/uv.lock \
  code_review_server/backend/app/api/routes/review_focus_directions.py \
  code_review_server/backend/tests/api/routes/test_review_focus_directions.py
git commit -m "新增重点审查方向统计筛选和导出"
```

---

### Task 3: 生成前端客户端 SDK

**Files:**
- Modify: `code_review_server/frontend/src/client/types.gen.ts`
- Modify: `code_review_server/frontend/src/client/schemas.gen.ts`
- Modify: `code_review_server/frontend/src/client/sdk.gen.ts`
- Modify: `code_review_server/frontend/openapi.json`

- [ ] **Step 1: 生成 OpenAPI 客户端**

Run:

```bash
cd code_review_server
source .env
export POSTGRES_SERVER=127.0.0.1
export POSTGRES_PORT=15543
export POSTGRES_DB=review_inputs_manual_20260616
./scripts/generate-client.sh
```

Expected:

- `frontend/src/client/types.gen.ts` 中 `ReviewFocusDirectionPublic` 包含 `departments`。
- `ReviewFocusDirectionCreate` / `ReviewFocusDirectionUpdate` 包含 `department_ids`。
- `ReviewFocusDirectionUsageStatPublic` 包含 `is_used`。
- `ReviewFocusDirectionsService` 包含 `updateUsageState`；导出接口即使生成出 SDK 方法，前端页面也按 Task 5 Step 11 使用 `fetch` 下载二进制文件。

- [ ] **Step 2: 检查生成结果**

Run:

```bash
cd code_review_server/frontend
rg -n "department_ids|departments|is_used|usage-stats/state|usage-stats/export" src/client openapi.json
```

Expected: 能找到上述字段和接口。

- [ ] **Step 3: 提交**

```bash
git add \
  code_review_server/frontend/openapi.json \
  code_review_server/frontend/src/client/types.gen.ts \
  code_review_server/frontend/src/client/schemas.gen.ts \
  code_review_server/frontend/src/client/sdk.gen.ts
git commit -m "同步重点审查方向前端接口"
```

---

### Task 4: 前端部门多选组件

**Files:**
- Create: `code_review_server/frontend/src/components/Departments/DepartmentMultiSelect.tsx`
- Test: `code_review_server/frontend/tests/review-focus-directions.spec.ts`

- [ ] **Step 1: 写失败 E2E 断言 - 新增方向可选择多个部门**

更新 `review-focus-directions.spec.ts` 的创建测试，将单部门选择改成两个部门，并断言行内出现两个部门名：

```ts
const departmentNameA = `重点部门A${Date.now()}`
const departmentNameB = `重点部门B${Date.now()}`

await page.goto("/items")
await page.getByRole("button", { name: "新增部门" }).click()
await page.getByLabel("部门名称").fill(departmentNameA)
await page.getByRole("button", { name: "保存" }).click()
await expect(page.getByText("部门创建成功")).toBeVisible()

await page.getByRole("button", { name: "新增部门" }).click()
await page.getByLabel("部门名称").fill(departmentNameB)
await page.getByRole("button", { name: "保存" }).click()
await expect(page.getByText("部门创建成功")).toBeVisible()
```

在方向弹窗中预期使用复选框：

```ts
await page.getByRole("button", { name: "新增方向" }).click()
await page.getByLabel("标题").fill(title)
await page.getByLabel("内容").fill(content)
await page.getByRole("button", { name: "选择部门" }).click()
await page.getByRole("checkbox", { name: departmentNameA }).check()
await page.getByRole("checkbox", { name: departmentNameB }).check()
await page.keyboard.press("Escape")
await page.getByRole("button", { name: "保存" }).click()

const row = page.getByRole("row").filter({ hasText: title })
await expect(row.getByText(departmentNameA)).toBeVisible()
await expect(row.getByText(departmentNameB)).toBeVisible()
```

- [ ] **Step 2: 运行 E2E 确认失败**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/review-focus-directions.spec.ts --grep "Admin can create"
```

Expected: 失败，原因是 `选择部门` 多选控件尚未实现。

- [ ] **Step 3: 新增 DepartmentMultiSelect**

创建 `DepartmentMultiSelect.tsx`：

```tsx
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown } from "lucide-react"
import { useMemo, useState } from "react"

import { DepartmentsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface DepartmentMultiSelectProps {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

export function DepartmentMultiSelect({
  value,
  onChange,
  disabled = false,
}: DepartmentMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryFn: () => DepartmentsService.readDepartments({ limit: 1000 }),
    queryKey: ["departments", "multi-select"],
  })
  const departments = data?.data ?? []
  const selectedNames = useMemo(
    () =>
      departments
        .filter((department) => value.includes(department.id))
        .map((department) => department.name),
    [departments, value],
  )
  const label =
    selectedNames.length === 0 ? "全局" : selectedNames.join("、")

  const toggleDepartment = (departmentId: string) => {
    if (value.includes(departmentId)) {
      onChange(value.filter((item) => item !== departmentId))
      return
    }
    onChange([...value, departmentId])
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          disabled={disabled || isLoading}
          aria-label="选择部门"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onChange([])
          }}
        >
          <Checkbox checked={value.length === 0} className="mr-2" />
          全局
        </DropdownMenuItem>
        {departments.map((department) => (
          <DropdownMenuItem
            key={department.id}
            onSelect={(event) => {
              event.preventDefault()
              toggleDepartment(department.id)
            }}
          >
            <Checkbox
              checked={value.includes(department.id)}
              className="mr-2"
              aria-label={department.name}
            />
            <span className="flex-1 truncate">{department.name}</span>
            {value.includes(department.id) && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4: 临时接入表单**

在 `ReviewFocusDirectionsPage.tsx`：

- `DirectionFormState.department_id` 改为 `department_ids: string[]`。
- `emptyForm.department_ids = []`。
- 弹窗中 `DepartmentSelect` 替换为 `DepartmentMultiSelect`。
- 提交 payload 使用 `department_ids`。
- 编辑时用 `direction.departments?.map((department) => department.id) ?? []`。

关键替换：

```tsx
<DepartmentMultiSelect
  value={form.department_ids}
  onChange={(departmentIds) =>
    setForm((current) => ({
      ...current,
      department_ids: departmentIds,
    }))
  }
/>
```

- [ ] **Step 5: 运行前端 E2E 创建测试**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/review-focus-directions.spec.ts --grep "Admin can create"
```

Expected: 创建测试通过。

- [ ] **Step 6: 提交**

```bash
git add \
  code_review_server/frontend/src/components/Departments/DepartmentMultiSelect.tsx \
  code_review_server/frontend/src/components/Admin/ReviewFocusDirectionsPage.tsx \
  code_review_server/frontend/tests/review-focus-directions.spec.ts
git commit -m "新增方向库部门多选控件"
```

---

### Task 5: 前端 Tab、筛选、统计标记和导出

**Files:**
- Modify: `code_review_server/frontend/src/components/Admin/ReviewFocusDirectionsPage.tsx`
- Modify: `code_review_server/frontend/tests/review-focus-directions.spec.ts`

- [ ] **Step 1: 写失败 E2E - 页面默认方向库 Tab，统计 Tab 点击后切换**

更新 `Admin review focus directions page is accessible from sidebar`：

```ts
await expect(page.getByRole("tab", { name: "方向库" })).toHaveAttribute(
  "aria-selected",
  "true",
)
await expect(page.getByRole("tab", { name: "用户输入统计" })).toHaveAttribute(
  "aria-selected",
  "false",
)
await expect(page.getByRole("heading", { name: "方向库" })).toBeVisible()
await expect(page.getByRole("heading", { name: "用户输入统计" })).not.toBeVisible()

await page.getByRole("tab", { name: "用户输入统计" }).click()
await expect(page.getByRole("heading", { name: "用户输入统计" })).toBeVisible()
await expect(page.getByRole("heading", { name: "方向库" })).not.toBeVisible()
```

同时断言 `新增方向` 在方向库 Tab 中：

```ts
await page.getByRole("tab", { name: "方向库" }).click()
await expect(page.getByRole("button", { name: "新增方向" })).toBeVisible()
await page.getByRole("tab", { name: "用户输入统计" }).click()
await expect(page.getByRole("button", { name: "新增方向" })).not.toBeVisible()
```

- [ ] **Step 2: 写失败 E2E - 沉淀按钮文案**

更新统计沉淀测试：

```ts
await page.getByRole("tab", { name: "用户输入统计" }).click()
const statsSection = page.getByTestId("review-focus-usage-stats")
const settleButtons = statsSection.getByRole("button", { name: "沉淀" })
const count = await settleButtons.count()
test.skip(count === 0, "当前测试环境暂无用户输入统计")
await expect(statsSection.getByRole("button", { name: "沉淀为方向" })).toHaveCount(0)
```

- [ ] **Step 3: 写失败 E2E - 标记已使用/未使用**

增加测试：

```ts
test("Admin can mark usage stat used and unused", async ({ page }) => {
  await page.goto("/admin/review-focus-directions")
  await page.getByRole("tab", { name: "用户输入统计" }).click()

  const statsSection = page.getByTestId("review-focus-usage-stats")
  const markButtons = statsSection.getByRole("button", { name: "标记已使用" })
  const count = await markButtons.count()
  test.skip(count === 0, "当前测试环境暂无未使用统计")

  const firstRow = statsSection.getByRole("row").nth(1)
  await firstRow.getByRole("button", { name: "标记已使用" }).click()
  await expect(page.getByText("使用状态更新成功")).toBeVisible()
  await expect(firstRow.getByText("已使用")).toBeVisible()

  await firstRow.getByRole("button", { name: "标记未使用" }).click()
  await expect(page.getByText("使用状态更新成功")).toBeVisible()
  await expect(firstRow.getByText("未使用")).toBeVisible()
})
```

- [ ] **Step 4: 写失败 E2E - 导出按钮存在**

增加测试：

```ts
test("Admin can trigger usage stats Excel export", async ({ page }) => {
  await page.goto("/admin/review-focus-directions")
  await page.getByRole("tab", { name: "用户输入统计" }).click()

  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 Excel" }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toContain("重点审查方向用户输入统计_")
  expect(download.suggestedFilename()).toContain(".xlsx")
})
```

- [ ] **Step 5: 运行 E2E 确认失败**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/review-focus-directions.spec.ts
```

Expected: 失败，原因是 Tab、按钮文案、状态操作、导出尚未接入。

- [ ] **Step 6: 引入 Tabs 组件并拆分页面**

在 `ReviewFocusDirectionsPage.tsx` 引入：

```tsx
import { Download, Edit, Plus, Search, Trash2 } from "lucide-react"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
```

增加 state：

```tsx
const [activeTab, setActiveTab] = useState("directions")
```

页面骨架改为：

```tsx
<Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
  <TabsList>
    <TabsTrigger value="directions">方向库</TabsTrigger>
    <TabsTrigger value="usage-stats">用户输入统计</TabsTrigger>
  </TabsList>
  <TabsContent value="directions">
    {/* 方向库 Card */}
  </TabsContent>
  <TabsContent value="usage-stats">
    {/* 用户输入统计 Card */}
  </TabsContent>
</Tabs>
```

把 `新增方向` 按钮移动到方向库 CardHeader 或 CardContent 的工具栏内。

- [ ] **Step 7: 增加筛选状态**

增加方向库筛选 state：

```tsx
const [directionSearch, setDirectionSearch] = useState("")
const [directionDepartmentScope, setDirectionDepartmentScope] = useState("all")
const [directionDepartmentId, setDirectionDepartmentId] = useState<string | null>(null)
const [directionActiveFilter, setDirectionActiveFilter] = useState("all")
```

增加统计筛选 state：

```tsx
const [usageSearch, setUsageSearch] = useState("")
const [usageDepartmentScope, setUsageDepartmentScope] = useState("all")
const [usageDepartmentId, setUsageDepartmentId] = useState<string | null>(null)
const [usageUsedFilter, setUsageUsedFilter] = useState("all")
```

query key 和 queryFn 带参数：

```tsx
const directionsQuery = useQuery({
  queryFn: () =>
    ReviewFocusDirectionsService.readReviewFocusDirections({
      search: directionSearch || undefined,
      departmentScope: directionDepartmentScope,
      departmentId: directionDepartmentScope === "department" ? directionDepartmentId ?? undefined : undefined,
      isActive:
        directionActiveFilter === "all"
          ? undefined
          : directionActiveFilter === "active",
    }),
  queryKey: [
    "review-focus-directions",
    directionSearch,
    directionDepartmentScope,
    directionDepartmentId,
    directionActiveFilter,
  ],
})
```

统计 query 同理，`isUsed` 从 `usageUsedFilter` 转换。

- [ ] **Step 8: 实现筛选栏 UI**

方向库 CardContent 表格上方增加一行：

```tsx
<div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_160px_auto]">
  <Input
    aria-label="方向库关键词"
    placeholder="搜索标题或内容"
    value={directionSearch}
    onChange={(event) => setDirectionSearch(event.target.value)}
  />
  {/* department scope/select */}
  {/* active filter */}
  <Button type="button" variant="outline" onClick={resetDirectionFilters}>
    重置
  </Button>
</div>
```

用户输入统计筛选栏增加 `导出 Excel`：

```tsx
<Button type="button" onClick={() => void exportUsageStats()}>
  <Download />
  导出 Excel
</Button>
```

- [ ] **Step 9: 更新表格行**

`DirectionRows` 部门列改用多部门：

```tsx
const departmentNames =
  direction.departments?.map((department) => department.name) ?? []
const departmentText = departmentNames.length ? departmentNames.join("、") : "全局"
```

`UsageStatRows` 增加状态列和标记按钮：

```tsx
<TableCell>
  <Badge variant={stat.is_used ? "secondary" : "outline"}>
    {stat.is_used ? "已使用" : "未使用"}
  </Badge>
</TableCell>
<Button
  type="button"
  size="sm"
  variant="outline"
  onClick={() => onToggleUsed(stat)}
>
  {stat.is_used ? "标记未使用" : "标记已使用"}
</Button>
<Button type="button" size="sm" variant="outline" onClick={() => onSettle(stat)}>
  沉淀
</Button>
```

- [ ] **Step 10: 实现状态 mutation**

增加 mutation：

```tsx
const updateUsageStateMutation = useMutation({
  mutationFn: (stat: ReviewFocusDirectionUsageStatPublic) =>
    ReviewFocusDirectionsService.updateUsageState({
      requestBody: {
        content: stat.content,
        is_used: !stat.is_used,
      },
    }),
  onSuccess: async () => {
    showSuccessToast("使用状态更新成功")
    await queryClient.invalidateQueries({
      queryKey: ["review-focus-directions", "usage-stats"],
    })
  },
  onError: handleError.bind(showErrorToast),
})
```

`updateUsageState` 由后端函数名 `update_usage_state` 生成；Task 3 Step 2 必须确认 `sdk.gen.ts` 中存在该方法后再继续。

- [ ] **Step 11: 实现导出下载**

增加 URL 构造函数和导出函数。认证 token 按现有 `src/hooks/useAuth.ts` 实现从 `localStorage.getItem("access_token")` 读取：

```tsx
function buildUsageExportUrl({
  search,
  departmentScope,
  departmentId,
  isUsed,
}: {
  search: string
  departmentScope: string
  departmentId: string | null
  isUsed: string
}) {
  const params = new URLSearchParams()
  if (search.trim()) {
    params.set("search", search.trim())
  }
  params.set("department_scope", departmentScope)
  if (departmentScope === "department" && departmentId) {
    params.set("department_id", departmentId)
  }
  if (isUsed !== "all") {
    params.set("is_used", String(isUsed === "used"))
  }
  const query = params.toString()
  return `${OpenAPI.BASE}/api/v1/review-focus-directions/usage-stats/export${query ? `?${query}` : ""}`
}

const exportUsageStats = async () => {
  try {
    const token = localStorage.getItem("access_token")
    const response = await fetch(
      buildUsageExportUrl({
        search: usageSearch,
        departmentScope: usageDepartmentScope,
        departmentId: usageDepartmentId,
        isUsed: usageUsedFilter,
      }),
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    )
    if (!response.ok) {
      throw new Error("导出失败")
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `重点审查方向用户输入统计_${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .slice(0, 13)}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
  } catch {
    showErrorToast("导出失败，请稍后重试。")
  }
}
```

- [ ] **Step 12: 运行前端测试**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/review-focus-directions.spec.ts
```

Expected: 通过。

- [ ] **Step 13: 运行前端类型检查/构建**

Run:

```bash
cd code_review_server/frontend
bun run build
```

Expected: 构建通过。

- [ ] **Step 14: 提交**

```bash
git add \
  code_review_server/frontend/src/components/Admin/ReviewFocusDirectionsPage.tsx \
  code_review_server/frontend/tests/review-focus-directions.spec.ts
git commit -m "增强重点审查方向后台页面"
```

---

### Task 6: 全量验证和收尾

**Files:**
- No source edits expected unless verification exposes defects.

- [ ] **Step 1: 跑后端目标测试**

Run:

```bash
cd code_review_server/backend
source ../.env
export POSTGRES_SERVER=127.0.0.1
export POSTGRES_PORT=15543
export CODE_REVIEW_TEST_POSTGRES_DB=review_inputs_manual_20260616_test
/Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_server/.venv/bin/python -m pytest \
  tests/api/routes/test_review_focus_directions.py \
  tests/api/routes/test_departments.py \
  -q
```

Expected: 全部通过。

- [ ] **Step 2: 跑前端目标测试**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/review-focus-directions.spec.ts
```

Expected: 全部通过。

- [ ] **Step 3: 跑前端构建**

Run:

```bash
cd code_review_server/frontend
bun run build
```

Expected: 构建通过。

- [ ] **Step 4: 检查迁移 head**

Run:

```bash
cd code_review_server/backend
source ../.env
export POSTGRES_SERVER=127.0.0.1
export POSTGRES_PORT=15543
export CODE_REVIEW_TEST_POSTGRES_DB=review_inputs_manual_20260616_test
/Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_server/.venv/bin/python -m alembic heads
```

Expected: 只有一个 head，包含 `20260622focusadmin`。

- [ ] **Step 5: 检查数据库中文备注**

Run:

```bash
cd code_review_server/backend
source ../.env
export POSTGRES_SERVER=127.0.0.1
export POSTGRES_PORT=15543
export CODE_REVIEW_TEST_POSTGRES_DB=review_inputs_manual_20260616_test
/Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_server/.venv/bin/python - <<'PY'
from sqlmodel import Session, text
from app.core.db import engine

with Session(engine) as session:
    rows = session.exec(text("""
        select c.relname, d.description
        from pg_class c
        join pg_description d on d.objoid = c.oid and d.objsubid = 0
        where c.relname in (
            'review_focus_direction_department',
            'review_focus_direction_usage_state'
        )
        order by c.relname
    """)).all()
    print(rows)
    assert len(rows) == 2
    assert all(row[1] for row in rows)
PY
```

Expected: 输出两张表的中文备注，断言通过。

- [ ] **Step 6: 检查 git 状态**

Run:

```bash
git status --short
```

Expected: 只有预期改动；不要提交 `.local-test-data/`。

- [ ] **Step 7: 最终提交验证修复**

只有 Step 1-6 中产生验证修复改动时才执行本步骤。按实际修复范围添加文件，允许的文件范围如下：

```bash
git add \
  code_review_server/backend/app/models.py \
  code_review_server/backend/app/api/routes/review_focus_directions.py \
  code_review_server/backend/app/api/routes/departments.py \
  code_review_server/backend/tests/conftest.py \
  code_review_server/backend/tests/api/routes/test_review_focus_directions.py \
  code_review_server/backend/tests/api/routes/test_departments.py \
  code_review_server/frontend/src/components/Admin/ReviewFocusDirectionsPage.tsx \
  code_review_server/frontend/src/components/Departments/DepartmentMultiSelect.tsx \
  code_review_server/frontend/tests/review-focus-directions.spec.ts
git commit -m "修复重点审查方向后台增强验证问题"
```

没有修复改动时不执行本步骤。
