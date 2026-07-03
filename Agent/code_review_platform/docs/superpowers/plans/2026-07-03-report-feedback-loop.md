# 报告反馈闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增绑定代码审查任务的报告反馈闭环，让 Electron 在打开 PDF 前强制提交报告反馈，并在 Web 任务管理页展示“是否有帮助”和“有用信息”。

**Architecture:** 后端新增 `review_task_report_feedback` 专用表、模型、Schema 和任务子路由，并在任务列表/详情中左连接聚合展示字段。Electron 新增专用 JSON IPC/API 链路，Renderer 在 `TaskPage` 的 PDF 打开流程前做反馈拦截，主进程 `report:open-pdf` 保持现有 fallback 不变。Web 任务管理页只做任务表两列展示和局部宽屏优化，不新增独立管理页面。

**Tech Stack:** FastAPI、SQLModel、Alembic、PostgreSQL、Pytest、React、TypeScript、Electron IPC、Vitest、Testing Library、Playwright、Tailwind CSS。

---

## File Structure

后端：

- Create: `code_review_server/backend/app/alembic/versions/20260703_add_review_task_report_feedback.py`
  - 创建 `review_task_report_feedback` 表、索引和中文注释。
- Modify: `code_review_server/backend/app/models.py`
  - 新增 `ReviewTaskReportFeedback`、`ReviewTaskReportFeedbackCreate`、`ReviewTaskReportFeedbackPublic`。
  - 扩展 `ReviewTaskPublic`，增加 `report_feedback_helpful`、`report_feedback_useful_issues_text`。
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
  - 新增提交报告反馈接口。
  - 任务列表/详情左连接反馈表。
  - 删除任务时显式删除反馈记录。
- Modify: `code_review_server/backend/app/api/routes/users.py`
  - 删除用户时先删除其任务对应报告反馈，避免外键约束失败。
- Modify: `code_review_server/backend/tests/conftest.py`
  - 测试清理时删除 `ReviewTaskReportFeedback`。
- Modify: `code_review_server/backend/tests/api/routes/test_review_tasks.py`
  - 覆盖提交、权限、重复提交、无报告错误、列表/详情展示字段、删除任务同步删除反馈。
- Modify: `code_review_server/backend/tests/api/routes/test_users.py`
  - 覆盖删除用户时同步清理报告反馈。

Web：

- Modify: `code_review_server/frontend/src/routes/_layout.tsx`
  - 对 `/tasks/review` 路由做内容容器级宽度放宽，宽度仍基于 `SidebarInset` 内容区，不使用 `100vw`。
- Modify: `code_review_server/frontend/src/client/types.gen.ts`
  - 重新生成或手动同步 `ReviewTaskPublic` 新字段。
- Modify: `code_review_server/frontend/src/client/schemas.gen.ts`
  - 重新生成或手动同步 schema 字段。
- Modify: `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`
  - 新增两列表格展示。
  - 有用信息截断 + 原生 `title`。
  - 局部宽屏布局。
  - 空状态 `colSpan` 同步。
- Modify: `code_review_server/frontend/tests/tasks.spec.ts`
  - 覆盖两列展示、title 完整内容、宽屏局部布局不破坏导航。

Electron 主进程/Preload/类型：

- Modify: `code_review_electron/src/shared/types.ts`
  - `ReviewTask` 新增反馈字段。
- Modify: `code_review_electron/src/main/api-client.ts`
  - 新增 `SubmitReportFeedbackRequest`、`ReportFeedbackResult` 和 `submitReportFeedback`。
- Modify: `code_review_electron/src/main/ipc.ts`
  - 新增 `report-feedback:submit` IPC handler。
  - 不改 `report:open-pdf`。
- Modify: `code_review_electron/src/preload/index.ts`
  - 暴露 `submitReportFeedback`，纯 JSON 透传。
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
  - 新增 Renderer 侧类型和 API 方法。
- Modify: `code_review_electron/src/main/__tests__/api-client.test.ts`
  - 覆盖 JSON POST。
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`
  - 覆盖 IPC 注册顺序和 handler 调用。
- Modify: `code_review_electron/src/preload/index.test.ts`
  - 覆盖 preload 透传，不走截图序列化。

Electron Renderer：

- Modify: `code_review_electron/src/renderer/src/components/MarkdownPreview.tsx`
  - 支持在有帮助状态下提取并渲染可勾选详细标题。
- Modify: `code_review_electron/src/renderer/src/components/MarkdownPreview.test.tsx`
  - 覆盖标题提取、跳过代码块、勾选回调。
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
  - PDF 打开前反馈拦截。
  - 有帮助/没帮助流程。
  - 本地乐观更新反馈状态。
  - `report_feedback_exists` 冲突后拉取任务详情。
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
  - 覆盖反馈闭环主流程和错误路径。
- Modify: `code_review_electron/src/renderer/src/hooks/useTaskQueue.ts`
  - 新任务完成时保留服务端反馈字段默认值。
  - 新增 `updateTask`，用于反馈提交成功后本地乐观更新任务反馈字段。
- Modify: `code_review_electron/src/renderer/src/styles.css`
  - 新增报告反馈工具条、输入框、勾选标题样式。

---

### Task 1: 后端数据模型、迁移和测试清理

**Files:**
- Create: `code_review_server/backend/app/alembic/versions/20260703_add_review_task_report_feedback.py`
- Modify: `code_review_server/backend/app/models.py`
- Modify: `code_review_server/backend/tests/conftest.py`

- [ ] **Step 1: Write the failing model/import cleanup test**

在 `code_review_server/backend/tests/api/routes/test_review_tasks.py` 顶部先加入即将使用的模型导入，后续测试会依赖它：

```python
from app.models import (
    Department,
    ReviewTask,
    ReviewTaskReportFeedback,
    ReviewTaskRequirementFile,
    ReviewTaskStatus,
    User,
    UserRole,
)
```

不要删除已有导入，只把 `ReviewTaskReportFeedback` 合并进现有 `from app.models import (...)` 块。

- [ ] **Step 2: Run import check to verify it fails**

Run:

```bash
cd code_review_server/backend
python -m pytest tests/api/routes/test_review_tasks.py -q
```

Expected: FAIL with `ImportError` or `cannot import name 'ReviewTaskReportFeedback'` because the model does not exist yet.

If this repo is being run in Docker, equivalent command is:

```bash
cd code_review_server
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_review_tasks.py -q
```

- [ ] **Step 3: Add SQLModel table and public schemas**

In `code_review_server/backend/app/models.py`, add this model after `ReviewTask` and before `Feedback`:

```python
class ReviewTaskReportFeedback(SQLModel, table=True):
    __tablename__ = "review_task_report_feedback"
    __table_args__ = (
        Index(
            "ix_review_task_report_feedback_helpful_created_at",
            "helpful",
            "created_at",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    task_id: uuid.UUID = Field(
        foreign_key="review_task.id", nullable=False, unique=True, index=True
    )
    user_id: uuid.UUID = Field(foreign_key="user.id", nullable=False, index=True)
    helpful: bool = Field(nullable=False, index=True)
    useful_issues_text: str | None = Field(default=None, max_length=4096)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        index=True,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
```

Add request/response schemas near existing `ReviewTaskPublic` schemas:

```python
class ReviewTaskReportFeedbackCreate(SQLModel):
    helpful: bool
    useful_issues_text: str | None = Field(default=None, max_length=4096)


class ReviewTaskReportFeedbackPublic(SQLModel):
    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    helpful: bool
    useful_issues_text: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
```

Extend `ReviewTaskPublic`:

```python
    report_feedback_helpful: bool | None = None
    report_feedback_useful_issues_text: str | None = None
```

Place the two fields near `report_name` / `pdf_report_name` so all report-related fields stay together.

- [ ] **Step 4: Add Alembic migration**

Create `code_review_server/backend/app/alembic/versions/20260703_add_review_task_report_feedback.py`:

```python
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
```

The `down_revision` is based on current migration graph where `20260623deptadmin` is the task/department branch head. If the migration graph changed by execution time, run `alembic heads` and update `down_revision` to the current head before committing.

- [ ] **Step 5: Update test cleanup**

In `code_review_server/backend/tests/conftest.py`, import `ReviewTaskReportFeedback`:

```python
from app.models import (
    AuditLog,
    ClientRelease,
    Department,
    Feedback,
    FeedbackScreenshot,
    Item,
    ReviewFocusDirection,
    ReviewFocusDirectionDepartment,
    ReviewFocusDirectionUsageState,
    ReviewTask,
    ReviewTaskReportFeedback,
    ReviewTaskRequirementFile,
    SkillPackage,
    User,
    UserApiKey,
    UserSvnCredential,
)
```

In cleanup before deleting `ReviewTaskRequirementFile` / `ReviewTask`, add:

```python
        if inspector.has_table("review_task_report_feedback"):
            statement = delete(ReviewTaskReportFeedback)
            session.execute(statement)
```

- [ ] **Step 6: Run model import test again**

Run:

```bash
cd code_review_server/backend
python -m pytest tests/api/routes/test_review_tasks.py -q
```

Expected: likely still FAIL because route/API is not implemented, but import errors for `ReviewTaskReportFeedback` are gone.

- [ ] **Step 7: Commit backend model foundation**

```bash
git add code_review_server/backend/app/models.py \
  code_review_server/backend/app/alembic/versions/20260703_add_review_task_report_feedback.py \
  code_review_server/backend/tests/conftest.py \
  code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "新增报告反馈数据模型"
```

### Task 2: 后端报告反馈 API、任务聚合字段和权限

**Files:**
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Modify: `code_review_server/backend/tests/api/routes/test_review_tasks.py`

- [ ] **Step 1: Add backend API tests**

Append these helpers to `code_review_server/backend/tests/api/routes/test_review_tasks.py` after `_set_review_task_pdf_report`:

```python
def _set_review_task_report(
    db: Session,
    task_id: str,
    *,
    report_path: str = "/tmp/report.md",
    pdf_report_path: str = "/tmp/report.pdf",
) -> None:
    db_task = db.get(ReviewTask, UUID(task_id))
    assert db_task is not None
    db_task.report_path = report_path
    db_task.report_name = "report.md"
    db_task.pdf_report_path = pdf_report_path
    db_task.pdf_report_name = "report.pdf"
    db_task.status = ReviewTaskStatus.success
    db.add(db_task)
    db.commit()


def _submit_report_feedback(
    client: TestClient,
    headers: dict[str, str],
    task_id: str,
    *,
    helpful: bool,
    useful_issues_text: str | None = None,
):
    return client.post(
        f"{settings.API_V1_STR}/review-tasks/{task_id}/report-feedback",
        headers=headers,
        json={
            "helpful": helpful,
            "useful_issues_text": useful_issues_text,
        },
    )
```

Append tests:

```python
def test_submit_report_feedback_helpful_requires_useful_text(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    task = _create_review_task(client, normal_user_token_headers)
    _set_review_task_report(db, task["id"])

    response = _submit_report_feedback(
        client,
        normal_user_token_headers,
        task["id"],
        helpful=True,
        useful_issues_text="   ",
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "有帮助时请至少填写一条有用信息"
    assert db.exec(select(ReviewTaskReportFeedback)).all() == []


def test_submit_report_feedback_helpful_success_and_task_public_fields(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    task = _create_review_task(client, normal_user_token_headers)
    _set_review_task_report(db, task["id"])

    response = _submit_report_feedback(
        client,
        normal_user_token_headers,
        task["id"],
        helpful=True,
        useful_issues_text="1. 空指针风险\n2. 越界访问风险",
    )

    assert response.status_code == 200
    content = response.json()
    assert content["task_id"] == task["id"]
    assert content["helpful"] is True
    assert content["useful_issues_text"] == "1. 空指针风险\n2. 越界访问风险"

    detail_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["report_feedback_helpful"] is True
    assert detail["report_feedback_useful_issues_text"] == "1. 空指针风险\n2. 越界访问风险"


def test_submit_report_feedback_not_helpful_allows_empty_text(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    task = _create_review_task(client, normal_user_token_headers)
    _set_review_task_report(db, task["id"])

    response = _submit_report_feedback(
        client,
        normal_user_token_headers,
        task["id"],
        helpful=False,
        useful_issues_text=None,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["helpful"] is False
    assert content["useful_issues_text"] in (None, "")


def test_submit_report_feedback_rejects_duplicate(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    task = _create_review_task(client, normal_user_token_headers)
    _set_review_task_report(db, task["id"])
    first_response = _submit_report_feedback(
        client,
        normal_user_token_headers,
        task["id"],
        helpful=False,
        useful_issues_text=None,
    )
    assert first_response.status_code == 200

    duplicate_response = _submit_report_feedback(
        client,
        normal_user_token_headers,
        task["id"],
        helpful=False,
        useful_issues_text=None,
    )

    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["detail"] == "report_feedback_exists"


def test_submit_report_feedback_requires_report_and_pdf(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    task = _create_review_task(client, normal_user_token_headers)

    response = _submit_report_feedback(
        client,
        normal_user_token_headers,
        task["id"],
        helpful=False,
        useful_issues_text=None,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "no_report"
```

Add permission tests:

```python
def test_report_feedback_department_admin_can_submit_same_department_task(
    client: TestClient, db: Session
) -> None:
    department = _create_department(db)
    member_headers, member = _create_department_user(
        client=client,
        db=db,
        department=department,
        full_name="成员",
    )
    admin_headers, _admin = _create_department_user(
        client=client,
        db=db,
        department=department,
        role=UserRole.department_admin,
        full_name="部门管理员",
    )
    task = _create_review_task(client, member_headers)
    _set_review_task_report(db, task["id"])

    response = _submit_report_feedback(
        client,
        admin_headers,
        task["id"],
        helpful=False,
        useful_issues_text=None,
    )

    assert response.status_code == 200
    assert response.json()["user_id"] != str(member.id)


def test_report_feedback_department_admin_cannot_submit_other_or_null_department_task(
    client: TestClient, db: Session
) -> None:
    own_department = _create_department(db, "本部门")
    other_department = _create_department(db, "其他部门")
    admin_headers, _admin = _create_department_user(
        client=client,
        db=db,
        department=own_department,
        role=UserRole.department_admin,
    )
    other_headers, _other_user = _create_department_user(
        client=client,
        db=db,
        department=other_department,
    )
    null_department_headers, _null_user = _create_department_user(
        client=client,
        db=db,
        department=None,
    )
    other_task = _create_review_task(client, other_headers)
    null_task = _create_review_task(client, null_department_headers)
    _set_review_task_report(db, other_task["id"])
    _set_review_task_report(db, null_task["id"])

    other_response = _submit_report_feedback(
        client,
        admin_headers,
        other_task["id"],
        helpful=False,
        useful_issues_text=None,
    )
    null_response = _submit_report_feedback(
        client,
        admin_headers,
        null_task["id"],
        helpful=False,
        useful_issues_text=None,
    )

    assert other_response.status_code == 403
    assert null_response.status_code == 403
```

Add list aggregation test:

```python
def test_review_task_list_includes_report_feedback_fields(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    first_task = _create_review_task(client, normal_user_token_headers)
    second_task = _create_review_task(client, normal_user_token_headers)
    _set_review_task_report(db, first_task["id"])
    _set_review_task_report(db, second_task["id"])
    feedback_response = _submit_report_feedback(
        client,
        normal_user_token_headers,
        first_task["id"],
        helpful=True,
        useful_issues_text="1. 有价值内容",
    )
    assert feedback_response.status_code == 200

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    by_id = {item["id"]: item for item in response.json()["data"]}
    assert by_id[first_task["id"]]["report_feedback_helpful"] is True
    assert by_id[first_task["id"]]["report_feedback_useful_issues_text"] == "1. 有价值内容"
    assert by_id[second_task["id"]]["report_feedback_helpful"] is None
    assert by_id[second_task["id"]]["report_feedback_useful_issues_text"] is None
```

- [ ] **Step 2: Run backend API tests to verify they fail**

Run:

```bash
cd code_review_server/backend
python -m pytest tests/api/routes/test_review_tasks.py -q
```

Expected: FAIL because `/report-feedback` route and response fields do not exist.

- [ ] **Step 3: Implement route imports and helper functions**

In `code_review_server/backend/app/api/routes/review_tasks.py`, update imports:

```python
from sqlalchemy.exc import IntegrityError
```

Add models to import list:

```python
    ReviewTaskReportFeedback,
    ReviewTaskReportFeedbackCreate,
    ReviewTaskReportFeedbackPublic,
```

Add helper after `_read_pdf_report_path`:

```python
def _ensure_task_has_reports(task: ReviewTask) -> None:
    if not task.report_path:
        raise HTTPException(status_code=409, detail="no_report")
    if not task.pdf_report_path:
        raise HTTPException(status_code=409, detail="no_pdf_report")


def _normalize_useful_issues_text(
    *, helpful: bool, useful_issues_text: str | None
) -> str | None:
    normalized = useful_issues_text.strip() if useful_issues_text else ""
    if helpful and not normalized:
        raise HTTPException(
            status_code=400, detail="有帮助时请至少填写一条有用信息"
        )
    return normalized or None
```

Change `_task_public` signature and body:

```python
def _task_public(
    task: ReviewTask,
    user: User | None = None,
    report_feedback: ReviewTaskReportFeedback | None = None,
) -> ReviewTaskPublic:
    return ReviewTaskPublic.model_validate(
        task,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
            "report_feedback_helpful": (
                report_feedback.helpful if report_feedback else None
            ),
            "report_feedback_useful_issues_text": (
                report_feedback.useful_issues_text if report_feedback else None
            ),
        },
    )
```

- [ ] **Step 4: Implement task list/detail aggregation**

In `read_review_tasks`, change count query unchanged, and change data query to outer join feedback:

```python
    statement = (
        select(ReviewTask, User, ReviewTaskReportFeedback)
        .join(User, ReviewTask.user_id == User.id)
        .outerjoin(
            ReviewTaskReportFeedback,
            ReviewTaskReportFeedback.task_id == ReviewTask.id,
        )
        .where(*filters)
    )
```

Change return:

```python
    return ReviewTasksPublic(
        data=[
            _task_public(task, user, report_feedback)
            for task, user, report_feedback in rows
        ],
        count=count,
    )
```

In `read_review_task`, replace direct return with:

```python
    task = _get_task_for_read(
        session=session, current_user=current_user, task_id=task_id
    )
    report_feedback = session.exec(
        select(ReviewTaskReportFeedback).where(
            ReviewTaskReportFeedback.task_id == task.id
        )
    ).first()
    return _task_public(task, session.get(User, task.user_id), report_feedback)
```

- [ ] **Step 5: Implement submit endpoint**

Add before `@router.get("/{task_id}", response_model=ReviewTaskPublic)` so route ordering keeps `/stats` and fixed routes safe:

```python
@router.post(
    "/{task_id}/report-feedback",
    response_model=ReviewTaskReportFeedbackPublic,
)
def submit_review_task_report_feedback(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    feedback_in: ReviewTaskReportFeedbackCreate,
) -> Any:
    task = _get_task_for_read(
        session=session, current_user=current_user, task_id=task_id
    )
    _ensure_task_has_reports(task)
    useful_issues_text = _normalize_useful_issues_text(
        helpful=feedback_in.helpful,
        useful_issues_text=feedback_in.useful_issues_text,
    )
    existing_feedback = session.exec(
        select(ReviewTaskReportFeedback).where(
            ReviewTaskReportFeedback.task_id == task.id
        )
    ).first()
    if existing_feedback:
        raise HTTPException(status_code=409, detail="report_feedback_exists")

    feedback = ReviewTaskReportFeedback(
        task_id=task.id,
        user_id=current_user.id,
        helpful=feedback_in.helpful,
        useful_issues_text=useful_issues_text,
        created_at=_utcnow(),
        updated_at=_utcnow(),
    )
    session.add(feedback)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="report_feedback_exists")
    session.refresh(feedback)
    return feedback
```

- [ ] **Step 6: Delete report feedback when deleting a task**

In `delete_review_task`, before deleting requirement files, add:

```python
    report_feedback_statement = delete(ReviewTaskReportFeedback).where(
        ReviewTaskReportFeedback.task_id == task.id
    )
    session.exec(report_feedback_statement)
```

Update the `sqlmodel` import in this file from:

```python
from sqlmodel import col, func, select
```

to:

```python
from sqlmodel import col, delete, func, select
```

- [ ] **Step 7: Run backend route tests**

Run:

```bash
cd code_review_server/backend
python -m pytest tests/api/routes/test_review_tasks.py -q
```

Expected: PASS for new report feedback tests and existing task tests.

- [ ] **Step 8: Commit backend API**

```bash
git add code_review_server/backend/app/api/routes/review_tasks.py \
  code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "新增报告反馈任务接口"
```

### Task 3: 后端删除用户与测试清理补齐

**Files:**
- Modify: `code_review_server/backend/app/api/routes/users.py`
- Modify: `code_review_server/backend/tests/api/routes/test_users.py`

- [ ] **Step 1: Write failing delete-user test**

In `code_review_server/backend/tests/api/routes/test_users.py`, add `ReviewTaskReportFeedback` to model imports.

Append the test near `test_delete_user_removes_review_task_requirement_files`:

```python
def test_delete_user_removes_review_task_report_feedback(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    user_id = user.id
    task = ReviewTask(
        user_id=user_id,
        svn_url="https://svn.example.com/delete/report-feedback",
        old_revision="r1",
        new_revision="r2",
        status=ReviewTaskStatus.success,
        report_path="/tmp/report.md",
        pdf_report_path="/tmp/report.pdf",
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    feedback = ReviewTaskReportFeedback(
        task_id=task.id,
        user_id=user_id,
        helpful=True,
        useful_issues_text="1. 有用信息",
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    task_id = task.id
    feedback_id = feedback.id

    response = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["message"] == "User deleted successfully"
    db.expire_all()
    assert db.get(User, user_id) is None
    assert db.get(ReviewTask, task_id) is None
    assert db.get(ReviewTaskReportFeedback, feedback_id) is None
```

- [ ] **Step 2: Run user test to verify it fails**

Run:

```bash
cd code_review_server/backend
python -m pytest tests/api/routes/test_users.py::test_delete_user_removes_review_task_report_feedback -q
```

Expected: FAIL because user deletion does not delete `ReviewTaskReportFeedback`.

- [ ] **Step 3: Implement user deletion cleanup**

In `code_review_server/backend/app/api/routes/users.py`, import `ReviewTaskReportFeedback`.

In `_delete_user_with_related_data`, after `review_task_ids` are loaded and before deleting `ReviewTaskRequirementFile`, add:

```python
    if review_task_ids:
        report_feedback_statement = delete(ReviewTaskReportFeedback).where(
            col(ReviewTaskReportFeedback.task_id).in_(review_task_ids)
        )
        session.exec(report_feedback_statement)
```

Keep the existing `ReviewTaskRequirementFile` cleanup below it.

- [ ] **Step 4: Run user deletion test**

Run:

```bash
cd code_review_server/backend
python -m pytest tests/api/routes/test_users.py::test_delete_user_removes_review_task_report_feedback -q
```

Expected: PASS.

- [ ] **Step 5: Commit delete cleanup**

```bash
git add code_review_server/backend/app/api/routes/users.py \
  code_review_server/backend/tests/api/routes/test_users.py
git commit -m "删除用户时清理报告反馈"
```

### Task 4: Electron 主进程、Preload 和跨端类型

**Files:**
- Modify: `code_review_electron/src/shared/types.ts`
- Modify: `code_review_electron/src/main/api-client.ts`
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Test: `code_review_electron/src/main/__tests__/api-client.test.ts`
- Test: `code_review_electron/src/main/__tests__/ipc.test.ts`
- Test: `code_review_electron/src/preload/index.test.ts`

- [ ] **Step 1: Write API client failing test**

Append to `code_review_electron/src/main/__tests__/api-client.test.ts`:

```ts
  it('submits report feedback as JSON with authorization header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'feedback-1',
          task_id: 'task-1',
          user_id: 'user-1',
          helpful: true,
          useful_issues_text: '1. 空指针风险'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const client = new ApiClient('https://server.example', fetchMock as typeof fetch)

    const result = await client.submitReportFeedback('token-123', 'task-1', {
      helpful: true,
      useful_issues_text: '1. 空指针风险'
    })

    expect(result).toMatchObject({
      id: 'feedback-1',
      task_id: 'task-1',
      helpful: true
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/review-tasks/task-1/report-feedback',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer token-123',
          'content-type': 'application/json'
        }),
        body: JSON.stringify({
          helpful: true,
          useful_issues_text: '1. 空指针风险'
        })
      })
    )
  })
```

- [ ] **Step 2: Write IPC/preload failing tests**

In `code_review_electron/src/main/__tests__/ipc.test.ts`, update channel order expectation by inserting `'report-feedback:submit'` after `'feedback:submit'` and before `'report:asset'`.

Add a handler test near existing feedback IPC tests:

```ts
  it('submits report feedback through authenticated API client', async () => {
    const submitReportFeedback = vi.fn(async () => ({
      id: 'report-feedback-1',
      task_id: 'task-1',
      user_id: 'user-1',
      helpful: false,
      useful_issues_text: null
    }))
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback } as never,
      authStore: {
        load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh' }))
      } as never
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:submit'
    )?.[1]

    await expect(
      handler({}, {
        taskId: 'task-1',
        helpful: false,
        useful_issues_text: ''
      })
    ).resolves.toMatchObject({ id: 'report-feedback-1', helpful: false })
    expect(submitReportFeedback).toHaveBeenCalledWith('token-123', 'task-1', {
      helpful: false,
      useful_issues_text: ''
    })
  })
```

In `code_review_electron/src/preload/index.test.ts`, add:

```ts
  it('invokes report feedback IPC without screenshot serialization', async () => {
    invokeMock.mockResolvedValue({
      id: 'report-feedback-1',
      task_id: 'task-1',
      user_id: 'user-1',
      helpful: true,
      useful_issues_text: '1. 有用信息'
    })

    await api.submitReportFeedback({
      taskId: 'task-1',
      helpful: true,
      useful_issues_text: '1. 有用信息'
    })

    expect(invokeMock).toHaveBeenCalledWith('report-feedback:submit', {
      taskId: 'task-1',
      helpful: true,
      useful_issues_text: '1. 有用信息'
    })
  })
```

- [ ] **Step 3: Run Electron IPC/API tests to verify they fail**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts src/preload/index.test.ts
```

Expected: FAIL because types/methods/channels do not exist.

- [ ] **Step 4: Implement shared and renderer API types**

In `code_review_electron/src/shared/types.ts`, extend `ReviewTask`:

```ts
  report_feedback_helpful?: boolean | null
  report_feedback_useful_issues_text?: string | null
```

In `code_review_electron/src/renderer/src/code-review-api.ts`, add:

```ts
export interface SubmitReportFeedbackPayload {
  taskId: string
  helpful: boolean
  useful_issues_text?: string | null
}

export interface SubmitReportFeedbackResult {
  id: string
  task_id: string
  user_id: string
  helpful: boolean
  useful_issues_text?: string | null
}
```

Add to `CodeReviewApi`:

```ts
  submitReportFeedback(payload: SubmitReportFeedbackPayload): Promise<SubmitReportFeedbackResult>
```

- [ ] **Step 5: Implement API client**

In `code_review_electron/src/main/api-client.ts`, add:

```ts
export interface SubmitReportFeedbackRequest {
  helpful: boolean
  useful_issues_text?: string | null
}

export interface ReportFeedbackResult {
  id: string
  task_id: string
  user_id: string
  helpful: boolean
  useful_issues_text?: string | null
}
```

Add method near `submitFeedback`:

```ts
  submitReportFeedback(
    token: string,
    taskId: string,
    payload: SubmitReportFeedbackRequest
  ): Promise<ReportFeedbackResult> {
    return this.request(
      `/api/v1/review-tasks/${encodeURIComponent(taskId)}/report-feedback`,
      {
        method: 'POST',
        headers: this.authHeaders(token),
        body: JSON.stringify(payload)
      }
    )
  }
```

- [ ] **Step 6: Implement IPC handler and preload bridge**

In `code_review_electron/src/main/ipc.ts`, import report feedback types:

```ts
  type ReportFeedbackResult,
  type SubmitReportFeedbackRequest,
```

Add IPC payload type:

```ts
interface SubmitReportFeedbackIpcPayload extends SubmitReportFeedbackRequest {
  taskId: string
}
```

Add handler after `feedback:submit`:

```ts
  ipcMain.handle(
    'report-feedback:submit',
    async (
      _event,
      payload: SubmitReportFeedbackIpcPayload
    ): Promise<ReportFeedbackResult> => {
      const tokens = await authStore.load()

      if (!tokens) {
        throw new Error('Not authenticated')
      }

      const api = await createApiClient()
      return api.submitReportFeedback(tokens.access_token, payload.taskId, {
        helpful: payload.helpful,
        useful_issues_text: payload.useful_issues_text ?? null
      })
    }
  )
```

Do not modify `report:open-pdf`.

In `code_review_electron/src/preload/index.ts`, import `SubmitReportFeedbackPayload` and `SubmitReportFeedbackResult`, then add:

```ts
  submitReportFeedback: (
    payload: SubmitReportFeedbackPayload
  ): Promise<SubmitReportFeedbackResult> =>
    ipcRenderer.invoke('report-feedback:submit', payload),
```

Place it near `submitFeedback`.

- [ ] **Step 7: Run Electron IPC/API tests**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts src/preload/index.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Electron IPC foundation**

```bash
git add code_review_electron/src/shared/types.ts \
  code_review_electron/src/main/api-client.ts \
  code_review_electron/src/main/ipc.ts \
  code_review_electron/src/preload/index.ts \
  code_review_electron/src/renderer/src/code-review-api.ts \
  code_review_electron/src/main/__tests__/api-client.test.ts \
  code_review_electron/src/main/__tests__/ipc.test.ts \
  code_review_electron/src/preload/index.test.ts
git commit -m "新增客户端报告反馈接口"
```

### Task 5: Markdown 标题勾选能力

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/MarkdownPreview.tsx`
- Modify: `code_review_electron/src/renderer/src/components/MarkdownPreview.test.tsx`

- [ ] **Step 1: Write MarkdownPreview failing tests**

Append to `MarkdownPreview.test.tsx`:

```ts
  it('renders detailed heading checkboxes when report feedback selection is enabled', async () => {
    const onUsefulIssueToggle = vi.fn()
    render(
      <MarkdownPreview
        markdown={[
          '# 审查报告',
          '## 高风险问题',
          '### 空指针风险',
          '正文',
          '### 越界访问风险',
          '正文',
          '```',
          '### 代码块标题不应识别',
          '```'
        ].join('\n')}
        usefulIssueSelection={{
          enabled: true,
          selectedIssues: ['空指针风险'],
          onToggle: onUsefulIssueToggle
        }}
      />
    )

    expect(screen.getByRole('checkbox', { name: '空指针风险' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '越界访问风险' })).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: '代码块标题不应识别' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: '越界访问风险' }))
    expect(onUsefulIssueToggle).toHaveBeenCalledWith('越界访问风险')
  })

  it('does not render report feedback checkboxes by default', () => {
    render(<MarkdownPreview markdown={'## 高风险问题\n\n### 空指针风险'} />)

    expect(screen.queryByRole('checkbox', { name: '空指针风险' })).not.toBeInTheDocument()
  })
```

Ensure `screen`, `userEvent`, and `vi` are imported if not already.

- [ ] **Step 2: Run MarkdownPreview tests to verify they fail**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/MarkdownPreview.test.tsx
```

Expected: FAIL because `usefulIssueSelection` prop does not exist.

- [ ] **Step 3: Implement heading extraction and props**

In `MarkdownPreview.tsx`, add types:

```ts
export type ReportHeadingOption = {
  id: string
  level: number
  text: string
}

type UsefulIssueSelection = {
  enabled: boolean
  selectedIssues: string[]
  onToggle: (issue: string) => void
}
```

Extend props:

```ts
type MarkdownPreviewProps = {
  markdown: string
  reportPath?: string
  usefulIssueSelection?: UsefulIssueSelection
}
```

Add helper functions before `MarkdownPreview`:

```ts
const headingLinePattern = /^(#{1,6})\s+(.+?)\s*$/

const stripMarkdownInline = (value: string): string =>
  value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()

export const extractDetailedHeadingOptions = (markdown: string): ReportHeadingOption[] => {
  const headings: ReportHeadingOption[] = []
  let inCodeBlock = false

  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock
      return
    }
    if (inCodeBlock) {
      return
    }
    const match = headingLinePattern.exec(line)
    if (!match) {
      return
    }
    const text = stripMarkdownInline(match[2])
    if (!text) {
      return
    }
    headings.push({
      id: `${index}-${text}`,
      level: match[1].length,
      text
    })
  })

  const leafHeadings = headings.filter((heading, index) => {
    const nextSameOrHigher = headings.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index && candidate.level <= heading.level
    )
    const children = headings.slice(
      index + 1,
      nextSameOrHigher === -1 ? headings.length : nextSameOrHigher
    )
    return children.length === 0
  })
  const detailed = leafHeadings.filter((heading) => heading.level >= 3)
  const fallback = leafHeadings.filter((heading) => heading.level >= 2)

  return detailed.length > 0 ? detailed : fallback
}
```

Render checkboxes inside `article` before `ReactMarkdown` when enabled:

```tsx
          {usefulIssueSelection?.enabled && (
            <div className="report-heading-options" aria-label="可标记的有用信息">
              {extractDetailedHeadingOptions(markdown).map((option) => (
                <label className="report-heading-option" key={option.id}>
                  <input
                    type="checkbox"
                    checked={usefulIssueSelection.selectedIssues.includes(option.text)}
                    onChange={() => usefulIssueSelection.onToggle(option.text)}
                  />
                  <span>{option.text}</span>
                </label>
              ))}
            </div>
          )}
```

Change function signature:

```ts
export function MarkdownPreview({
  markdown,
  reportPath,
  usefulIssueSelection
}: MarkdownPreviewProps): React.JSX.Element {
```

- [ ] **Step 4: Run MarkdownPreview tests**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/MarkdownPreview.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Markdown selection**

```bash
git add code_review_electron/src/renderer/src/components/MarkdownPreview.tsx \
  code_review_electron/src/renderer/src/components/MarkdownPreview.test.tsx
git commit -m "支持报告有用信息勾选"
```

### Task 6: Electron Renderer 报告反馈闭环

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
- Modify: `code_review_electron/src/renderer/src/hooks/useTaskQueue.ts`
- Modify: `code_review_electron/src/renderer/src/styles.css`

- [ ] **Step 1: Prepare existing TaskPage PDF tests for feedback gate**

In `TaskPage.test.tsx`, update existing historical-task PDF tests that should keep the old direct-open behavior by adding `report_feedback_helpful: false` to the selected historical task mocks.

In `历史任务查看PDF报告时按任务 ID 下载服务端 PDF`, add the field to `task-history-2`:

```ts
          report_path: '/app/reports/task-history-2.md',
          pdf_report_path: '/app/reports/task-history-2.pdf',
          pdf_report_name: 'r3_r4审查报告_20260615_143000.pdf',
          report_feedback_helpful: false
```

In `快速切换历史报告时忽略旧请求返回，避免覆盖当前 PDF 报告名`, add the field to both `task-history-a` and `task-history-b`:

```ts
          pdf_report_name: 'A审查报告_20260615_143000.pdf',
          report_feedback_helpful: false
```

```ts
          pdf_report_name: 'B审查报告_20260615_143000.pdf',
          report_feedback_helpful: false
```

Do not bypass feedback for the local-completion test `点击查看PDF报告时优先打开当前任务本地 PDF`. That test represents a newly generated task that has not submitted report feedback yet. Update it to submit the required lightweight feedback before asserting PDF open:

```ts
    window.codeReview.submitReportFeedback = vi.fn(async () => ({
      id: 'report-feedback-local-success',
      task_id: 'task-local-success',
      user_id: 'user-1',
      helpful: false,
      useful_issues_text: null
    }))
```

Change the click sequence in that test:

```ts
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
    await user.click(screen.getByRole('button', { name: '没帮助' }))
```

Add the feedback assertion before the existing `openPdfReport` assertion:

```ts
    expect(window.codeReview.submitReportFeedback).toHaveBeenCalledWith({
      taskId: 'task-local-success',
      helpful: false,
      useful_issues_text: ''
    })
```

Keep the existing `openPdfReport` assertion unchanged so it still proves the local PDF path is preferred:

```ts
    expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'task-local-success',
      localPdfPath: '/app/reports/task-local-success.pdf',
      pdfReportName: 'r7_r2审查报告_20260615_143000.pdf'
    })
```

Existing test `未选中任务时右侧显示当前审查模板，切换模板后不打开最新报告位置` does not need `report_feedback_helpful`, because `handleOpenPdfReport` returns on missing `taskId` before the feedback gate.

- [ ] **Step 2: Add TaskPage failing tests**

In `TaskPage.test.tsx`, update `setupCodeReviewApi` with:

```ts
    submitReportFeedback: vi.fn(async () => ({
      id: 'report-feedback-1',
      task_id: 'task-history-2',
      user_id: 'user-1',
      helpful: true,
      useful_issues_text: '1. 空指针风险'
    })),
```

Append tests:

```ts
  it('未反馈历史任务点击查看PDF时先展示报告反馈选择', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success',
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告\n\n### 空指针风险')

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))

    expect(screen.getByRole('button', { name: '有帮助' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '没帮助' })).toBeInTheDocument()
    expect(window.codeReview.openPdfReport).not.toHaveBeenCalled()
  })

  it('点击没帮助会提交报告反馈并打开PDF', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success',
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告')
    window.codeReview.submitReportFeedback = vi.fn(async () => ({
      id: 'report-feedback-1',
      task_id: 'task-history-1',
      user_id: 'user-1',
      helpful: false,
      useful_issues_text: null
    }))
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready',
      pdfPath: '/local/task-history.pdf'
    }))

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
    await user.click(screen.getByRole('button', { name: '没帮助' }))

    expect(window.codeReview.submitReportFeedback).toHaveBeenCalledWith({
      taskId: 'task-history-1',
      helpful: false,
      useful_issues_text: ''
    })
    await waitFor(() => expect(window.codeReview.openPdfReport).toHaveBeenCalled())
  })

  it('点击有帮助后必须至少选择或填写一条有用信息才能提交', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success',
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告\n\n### 空指针风险')

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
    await user.click(screen.getByRole('button', { name: '有帮助' }))

    expect(screen.getByRole('button', { name: '提交并打开PDF' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '空指针风险' }))
    expect(screen.getByRole('button', { name: '提交并打开PDF' })).toBeEnabled()
  })

  it('已反馈任务点击查看PDF报告直接打开PDF', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success',
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: false,
          report_feedback_useful_issues_text: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告')
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready',
      pdfPath: '/local/task-history.pdf'
    }))

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))

    expect(window.codeReview.submitReportFeedback).not.toHaveBeenCalled()
    expect(window.codeReview.openPdfReport).toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run TaskPage tests to verify they fail**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskPage.test.tsx
```

Expected: FAIL because feedback UI and submit flow do not exist.

- [ ] **Step 4: Add TaskPage state and formatting helpers**

In `TaskPage.tsx`, add types near `CompletionNotice`:

```ts
type ReportFeedbackStatus = 'idle' | 'choosing' | 'useful' | 'submitting'
```

Add state:

```ts
  const [reportFeedbackStatus, setReportFeedbackStatus] =
    useState<ReportFeedbackStatus>('idle')
  const [selectedUsefulIssues, setSelectedUsefulIssues] = useState<string[]>([])
  const [usefulIssuesText, setUsefulIssuesText] = useState('')
```

Add helpers before component or inside component before handlers:

```ts
const stripMarkerListPrefix = (value: string): string =>
  value.replace(/^\s*\d+[\.)、]\s*/, '').trim()

const parseUsefulIssuesText = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map(stripMarkerListPrefix)
    .filter(Boolean)

const formatUsefulIssues = (issues: string[]): string =>
  issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')

const uniqueIssues = (issues: string[]): string[] =>
  issues.filter((issue, index) => issues.indexOf(issue) === index)
```

When switching template or selected task, reset feedback UI:

```ts
      setReportFeedbackStatus('idle')
      setSelectedUsefulIssues([])
      setUsefulIssuesText('')
```

Add same reset in `handleViewReport` before loading the selected task.

- [ ] **Step 5: Track selected task and update feedback fields locally**

Add helper in `TaskPage.tsx`:

```ts
  const selectedTask = [...runningTasks, ...queuedTasks, ...historyTasks].find(
    (task) => task.id === selectedTaskId
  )
```

Extend `UseTaskQueueResult` in `useTaskQueue.ts` with `updateTask`:

```ts
  updateTask: (taskId: string, updater: (task: TaskViewItem) => TaskViewItem) => void
```

Implementation:

```ts
  const updateTask = useCallback(
    (taskId: string, updater: (task: TaskViewItem) => TaskViewItem): void => {
      setTasks((current) =>
        normalizeQueueIndexes(
          current.map((task) => (task.id === taskId ? updater(task) : task))
        )
      )
    },
    []
  )
```

Return it from `useTaskQueue` and destructure it in `TaskPage`.

Add helper:

```ts
  const markTaskFeedbackSubmitted = useCallback(
    (taskId: string, helpful: boolean, usefulText: string | null): void => {
      updateTask(taskId, (task) => ({
        ...task,
        report_feedback_helpful: helpful,
        report_feedback_useful_issues_text: usefulText
      }))
    },
    [updateTask]
  )
```

- [ ] **Step 6: Extract pure PDF open flow and implement submit flow**

In `TaskPage.tsx`, extract the existing PDF opening body from `handleOpenPdfReport` into `openSelectedPdfReport`. The extracted function must contain the current `window.codeReview.openPdfReport(...)`, success handling, and error handling. It must not check or mutate report feedback state:

```ts
  const openSelectedPdfReport = useCallback(async (): Promise<void> => {
    const taskId = selectedTaskIdRef.current

    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }

    setError('')
    try {
      const result = await window.codeReview.openPdfReport({
        taskId,
        localPdfPath: currentPdfPathRef.current,
        pdfReportName: currentPdfReportNameRef.current
      })
      if (!isMountedRef.current) {
        return
      }
      setReportMessage(`PDF报告位置：${result.pdfPath}`)
      setActivePdfPath(result.pdfPath)
    } catch (openError) {
      if (!isMountedRef.current) {
        return
      }
      const message = openError instanceof Error ? openError.message : 'PDF报告打开失败。'
      setError(message.includes('404') ? '该历史任务没有 PDF 报告，请查看 Markdown 或重新生成报告。' : message)
    }
  }, [setActivePdfPath])
```

Do not change `report:open-pdf` main-process behavior.

Then replace `handleOpenPdfReport` with the feedback gate plus the pure open call:

```ts
  const handleOpenPdfReport = useCallback(async (): Promise<void> => {
    const taskId = selectedTaskIdRef.current

    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }

    if (selectedTask?.report_feedback_helpful == null && reportFeedbackStatus === 'idle') {
      setReportFeedbackStatus('choosing')
      return
    }

    await openSelectedPdfReport()
  }, [openSelectedPdfReport, reportFeedbackStatus, selectedTask?.report_feedback_helpful])
```

Add:

```ts
  const handleReportNotUseful = async (): Promise<void> => {
    const taskId = selectedTaskIdRef.current
    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }
    setError('')
    setReportFeedbackStatus('submitting')
    try {
      await window.codeReview.submitReportFeedback({
        taskId,
        helpful: false,
        useful_issues_text: ''
      })
      markTaskFeedbackSubmitted(taskId, false, null)
      setReportFeedbackStatus('idle')
      await openSelectedPdfReport()
    } catch (submitError) {
      setReportFeedbackStatus('choosing')
      setError(submitError instanceof Error ? submitError.message : '报告反馈提交失败，请稍后重试。')
    }
  }

  const handleReportUseful = (): void => {
    setReportFeedbackStatus('useful')
  }

  const handleUsefulIssueToggle = (issue: string): void => {
    setSelectedUsefulIssues((current) => {
      const next = current.includes(issue)
        ? current.filter((item) => item !== issue)
        : [...current, issue]
      setUsefulIssuesText(formatUsefulIssues(next))
      return next
    })
  }

  const handleUsefulIssuesTextChange = (value: string): void => {
    setUsefulIssuesText(value)
    setSelectedUsefulIssues(uniqueIssues(parseUsefulIssuesText(value)))
  }

  const handleSubmitUsefulIssuesAndOpenPdf = async (): Promise<void> => {
    const taskId = selectedTaskIdRef.current
    const issues = uniqueIssues(parseUsefulIssuesText(usefulIssuesText))
    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }
    if (issues.length === 0) {
      setError('请至少标记或填写一条有用信息。')
      return
    }
    const formatted = formatUsefulIssues(issues)
    setError('')
    setReportFeedbackStatus('submitting')
    try {
      await window.codeReview.submitReportFeedback({
        taskId,
        helpful: true,
        useful_issues_text: formatted
      })
      markTaskFeedbackSubmitted(taskId, true, formatted)
      setReportFeedbackStatus('idle')
      await openSelectedPdfReport()
    } catch (submitError) {
      setReportFeedbackStatus('useful')
      setError(submitError instanceof Error ? submitError.message : '报告反馈提交失败，请稍后重试。')
    }
  }
```

- [ ] **Step 7: Render feedback toolbar and Markdown selection**

Replace toolbar button with conditional controls:

```tsx
          {selectedTask?.report_feedback_helpful != null ? (
            <button className="secondary-button" type="button" onClick={() => void handleOpenPdfReport()}>
              查看PDF报告
            </button>
          ) : reportFeedbackStatus === 'choosing' || reportFeedbackStatus === 'submitting' ? (
            <div className="report-feedback-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={reportFeedbackStatus === 'submitting'}
                onClick={handleReportUseful}
              >
                有帮助
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={reportFeedbackStatus === 'submitting'}
                onClick={() => void handleReportNotUseful()}
              >
                没帮助
              </button>
            </div>
          ) : reportFeedbackStatus === 'useful' ? (
            <div className="report-feedback-bar">
              <div className="report-feedback-copy">
                <strong>标记有用信息</strong>
                <span>勾选下方标题，或手动补充有价值内容。</span>
              </div>
              <span className="report-feedback-count">已选 {parseUsefulIssuesText(usefulIssuesText).length} 条</span>
              <textarea
                aria-label="有用信息"
                value={usefulIssuesText}
                onChange={(event) => handleUsefulIssuesTextChange(event.target.value)}
                placeholder="可补充报告中有价值的问题或建议点，每行一条"
              />
              <button
                className="secondary-button"
                type="button"
                disabled={parseUsefulIssuesText(usefulIssuesText).length === 0}
                onClick={() => void handleSubmitUsefulIssuesAndOpenPdf()}
              >
                提交并打开PDF
              </button>
            </div>
          ) : (
            <button className="secondary-button" type="button" onClick={() => void handleOpenPdfReport()}>
              查看PDF报告
            </button>
          )}
```

Pass selection props:

```tsx
        <MarkdownPreview
          markdown={markdown}
          reportPath={currentReportPath}
          usefulIssueSelection={{
            enabled: reportFeedbackStatus === 'useful',
            selectedIssues: selectedUsefulIssues,
            onToggle: handleUsefulIssueToggle
          }}
        />
```

- [ ] **Step 8: Add styles**

In `styles.css`, add near preview toolbar styles:

```css
.report-feedback-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.report-feedback-bar {
  display: grid;
  grid-template-columns: minmax(8rem, auto) auto minmax(16rem, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  width: min(100%, 44rem);
}

.report-feedback-copy {
  display: grid;
  gap: 0.15rem;
}

.report-feedback-copy strong {
  color: #f8fafc;
  font-size: 0.85rem;
}

.report-feedback-copy span,
.report-feedback-count {
  color: rgba(226, 232, 240, 0.72);
  font-size: 0.75rem;
}

.report-feedback-bar textarea {
  min-height: 2.5rem;
  max-height: 4.5rem;
  resize: vertical;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 0.5rem;
  background: rgba(15, 23, 42, 0.72);
  color: #e5edf7;
  padding: 0.55rem 0.7rem;
}

.report-heading-options {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.report-heading-option {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #dbeafe;
  font-weight: 600;
}
```

Add mobile adjustment inside existing media query:

```css
  .report-feedback-bar {
    grid-template-columns: 1fr;
    width: 100%;
  }
```

- [ ] **Step 9: Run TaskPage and hook tests**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskPage.test.tsx src/renderer/src/hooks/useTaskQueue.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit Electron renderer feedback loop**

```bash
git add code_review_electron/src/renderer/src/components/TaskPage.tsx \
  code_review_electron/src/renderer/src/components/TaskPage.test.tsx \
  code_review_electron/src/renderer/src/hooks/useTaskQueue.ts \
  code_review_electron/src/renderer/src/styles.css
git commit -m "实现客户端报告反馈闭环"
```

### Task 7: Web 任务管理两列展示和宽屏布局

**Files:**
- Modify: `code_review_server/frontend/src/routes/_layout.tsx`
- Modify: `code_review_server/frontend/src/client/types.gen.ts`
- Modify: `code_review_server/frontend/src/client/schemas.gen.ts`
- Modify: `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`
- Modify: `code_review_server/frontend/tests/tasks.spec.ts`

- [ ] **Step 1: Sync generated client types**

Preferred command after backend is running:

```bash
cd code_review_server/frontend
bun run generate-client
```

If generation is unavailable, manually update `code_review_server/frontend/src/client/types.gen.ts` `ReviewTaskPublic`:

```ts
    report_feedback_helpful?: boolean | null;
    report_feedback_useful_issues_text?: string | null;
```

If generation is unavailable, manually add the same fields to `ReviewTaskPublicSchema` in `schemas.gen.ts` after `pdf_report_name`:

```ts
        report_feedback_helpful: {
            anyOf: [
                {
                    type: 'boolean'
                },
                {
                    type: 'null'
                }
            ],
            title: 'Report Feedback Helpful'
        },
        report_feedback_useful_issues_text: {
            anyOf: [
                {
                    type: 'string'
                },
                {
                    type: 'null'
                }
            ],
            title: 'Report Feedback Useful Issues Text'
        },
```

- [ ] **Step 2: Add Web failing tests**

Append to `code_review_server/frontend/tests/tasks.spec.ts`:

```ts
  test("Admin task table shows report feedback columns and useful text title", async ({
    page,
  }) => {
    await logInWithKey(page, testApiKey)

    await page.route("**/api/v1/review-tasks?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              user_id: "22222222-2222-2222-2222-222222222222",
              user_name: "测试用户",
              svn_username: "test_svn",
              svn_url: "https://example.test/svn/project",
              old_revision: "r1",
              new_revision: "r2",
              status: "success",
              report_path: "/reports/task.md",
              pdf_report_path: "/reports/task.pdf",
              error_message: null,
              started_at: "2026-06-11T14:03:20",
              finished_at: "2026-06-11T14:08:20",
              report_feedback_helpful: true,
              report_feedback_useful_issues_text: "1. 空指针风险\n2. 越界访问风险",
            },
            {
              id: "33333333-3333-3333-3333-333333333333",
              user_id: "44444444-4444-4444-4444-444444444444",
              user_name: "未反馈用户",
              svn_username: "no_feedback",
              svn_url: "https://example.test/svn/project-2",
              old_revision: "r3",
              new_revision: "r4",
              status: "success",
              report_path: "/reports/task2.md",
              pdf_report_path: "/reports/task2.pdf",
              error_message: null,
              started_at: "2026-06-11T15:03:20",
              finished_at: "2026-06-11T15:08:20",
              report_feedback_helpful: null,
              report_feedback_useful_issues_text: null,
            },
          ],
          count: 2,
        },
      })
    })

    await page.goto("/tasks/review")

    await expect(page.getByRole("columnheader", { name: "是否有帮助" })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "有用信息" })).toBeVisible()
    await expect(page.getByText("有帮助")).toBeVisible()
    await expect(page.getByText("未反馈")).toBeVisible()
    const usefulCell = page.getByTitle("1. 空指针风险\n2. 越界访问风险")
    await expect(usefulCell).toBeVisible()

    await page.setViewportSize({ width: 1600, height: 900 })
    await expect(page.locator('[data-testid="review-tasks-content"]')).toHaveClass(
      /max-w-\[1600px\]/,
    )
    const hasPageHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasPageHorizontalOverflow).toBe(false)
  })
```

- [ ] **Step 3: Run Web task test to verify it fails**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/tasks.spec.ts --grep "report feedback columns"
```

Expected: FAIL because columns are missing.

- [ ] **Step 4: Implement display helpers and columns**

In `TasksPage.tsx`, add:

```ts
const REVIEW_TASK_TABLE_COLUMN_COUNT = 12
```

Add helper:

```tsx
function ReportFeedbackHelpfulBadge({
  helpful,
}: {
  helpful?: boolean | null
}) {
  if (helpful === true) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        有帮助
      </span>
    )
  }

  if (helpful === false) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        没帮助
      </span>
    )
  }

  return (
    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      未反馈
    </span>
  )
}

function formatUsefulIssuesSummary(value?: string | null) {
  if (!value?.trim()) {
    return "-"
  }
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("；")
}
```

Add table headers after `错误信息`:

```tsx
            <TableHead>是否有帮助</TableHead>
            <TableHead>有用信息</TableHead>
```

Add cells after error cell:

```tsx
                <TableCell>
                  <ReportFeedbackHelpfulBadge helpful={task.report_feedback_helpful} />
                </TableCell>
                <TableCell
                  className="max-w-xs truncate text-muted-foreground"
                  title={task.report_feedback_useful_issues_text || undefined}
                >
                  {task.report_feedback_helpful
                    ? formatUsefulIssuesSummary(task.report_feedback_useful_issues_text)
                    : "-"}
                </TableCell>
```

Change empty state:

```tsx
                colSpan={REVIEW_TASK_TABLE_COLUMN_COUNT}
```

- [ ] **Step 5: Implement route-scoped wide layout without viewport-width breakout**

In `code_review_server/frontend/src/routes/_layout.tsx`, change the import from:

```ts
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
```

to:

```ts
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router"
```

Inside `Layout`, add route detection:

```tsx
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isReviewTasksRoute = pathname === "/tasks/review"
```

Replace the existing content wrapper:

```tsx
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
```

with:

```tsx
          <div
            className={
              isReviewTasksRoute
                ? "mx-auto w-full max-w-[1600px]"
                : "mx-auto max-w-7xl"
            }
            data-testid={isReviewTasksRoute ? "review-tasks-content" : undefined}
          >
            <Outlet />
          </div>
```

This keeps the width based on `SidebarInset` / `<main>` available content area. Do not use `100vw`, `left-1/2`, or `translate-x-*` in `TasksPage`; those calculate against the full viewport and overlap the sidebar when it is expanded.

In `TasksPage`, keep the root container content-area relative:

```tsx
    <div className="flex flex-col gap-6">
```

No class change is required on the `TasksPage` root. The table already uses the shared `Table` wrapper with `w-full overflow-x-auto`, so horizontal scrolling stays inside the table container when the viewport is narrow. Do not add viewport-width breakout classes to `TasksPage`.

- [ ] **Step 6: Run Web task tests**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/tasks.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Web task table update**

```bash
git add code_review_server/frontend/src/client/types.gen.ts \
  code_review_server/frontend/src/client/schemas.gen.ts \
  code_review_server/frontend/src/components/Tasks/TasksPage.tsx \
  code_review_server/frontend/tests/tasks.spec.ts
git commit -m "任务管理展示报告反馈"
```

### Task 8: Final verification

**Files:**
- Verify only.

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
cd code_review_server/backend
python -m pytest tests/api/routes/test_review_tasks.py tests/api/routes/test_users.py -q
```

Expected: PASS.

If using Docker:

```bash
cd code_review_server
docker compose exec backend bash scripts/tests-start.sh tests/api/routes/test_review_tasks.py tests/api/routes/test_users.py -q
```

- [ ] **Step 2: Run Electron focused tests**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/MarkdownPreview.test.tsx src/renderer/src/components/TaskPage.test.tsx src/renderer/src/hooks/useTaskQueue.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run Web focused tests**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/tasks.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run type checks/builds**

Run:

```bash
cd code_review_electron
npm run typecheck
```

Expected: PASS.

Run:

```bash
cd code_review_server/frontend
bun run build
```

Expected: PASS.

- [ ] **Step 5: Run migration upgrade check**

Preferred in backend environment:

```bash
cd code_review_server/backend
alembic upgrade head
```

Expected: PASS and `review_task_report_feedback` table exists.

If only Docker is configured:

```bash
cd code_review_server
docker compose exec backend alembic upgrade head
```

Expected: PASS.

- [ ] **Step 6: Final status and commit if needed**

Run:

```bash
git status --short
```

Expected: clean working tree except unrelated pre-existing untracked files. If verification required fixes, stage only the files changed for this report feedback feature and commit with `git commit -m "完善报告反馈闭环验证"` after reviewing `git diff --staged`.
