# 代码审查任务管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理端任务管理改为“任务管理 > 代码审查任务管理”的分级结构，并为代码审查任务列表增加用户姓名、SVN账号筛选和删除能力。

**Architecture:** 后端继续使用现有 `review_task` 表，通过关联 `user` 表补充任务创建人的真实姓名和 SVN 账号，不新增数据库迁移。前端将当前任务页迁移到 `/admin/tasks/review`，`/admin/tasks` 保持为重定向入口，侧边栏支持带子菜单的任务管理分组。

**Tech Stack:** FastAPI, SQLModel, pytest, React 19, TanStack Router, TanStack Query, shadcn/radix UI components, Playwright, Bun.

---

## 文件结构

- Modify: `backend/app/models.py`
  - 给 `ReviewTaskPublic` 增加 `user_name` 和 `svn_username` 两个 API 响应字段。
- Modify: `backend/app/api/routes/review_tasks.py`
  - 将任务列表查询改为关联 `User`。
  - 增加 `user_name`、`svn_username` 两个筛选参数。
  - 增加 `DELETE /api/v1/review-tasks/{task_id}`。
  - 抽出响应转换函数，避免列表、详情、状态更新、报告上传返回字段不一致。
- Modify: `backend/tests/api/routes/test_review_tasks.py`
  - 增加列表身份字段、筛选、权限隔离、删除任务和删除报告文件测试。
- Modify: `frontend/src/components/Sidebar/Main.tsx`
  - 支持普通菜单项和带 children 的分组菜单项。
- Modify: `frontend/src/components/Sidebar/AppSidebar.tsx`
  - 将 `任务管理` 改为分组，子项为 `代码审查任务管理`。
- Modify: `frontend/src/components/Admin/TasksPage.tsx`
  - 页面标题改为 `代码审查任务管理`。
  - 增加两个筛选输入框、搜索/重置按钮。
  - 展示 `用户名称`、`SVN账号`、`执行客户端`、`操作` 列。
  - 增加删除确认弹窗和删除后刷新。
- Modify: `frontend/src/routes/_layout/admin.tasks.tsx`
  - 将 `/admin/tasks` 改为重定向到 `/admin/tasks/review`。
- Create: `frontend/src/routes/_layout/admin.tasks.review.tsx`
  - 新增 `/admin/tasks/review` 页面路由。
- Modify: `frontend/tests/admin.spec.ts`
  - 更新任务管理页面和侧边栏 E2E 断言。

---

### Task 1: 后端任务响应包含用户姓名和 SVN 账号

**Files:**
- Modify: `backend/tests/api/routes/test_review_tasks.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/api/routes/review_tasks.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/api/routes/test_review_tasks.py` 末尾增加：

```python
def test_admin_task_list_includes_user_identity_fields(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    password = random_lower_string()
    user = crud.create_user(
        session=db,
        user_create=UserCreate(
            email=random_email(),
            password=password,
            full_name="张三",
        ),
    )
    user.svn_username = "zhangsan"
    db.add(user)
    db.commit()
    headers = user_authentication_headers(
        client=client, email=user.email, password=password
    )
    task = _create_review_task(client, headers, old_revision="11")

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    listed_task = next(
        item for item in response.json()["data"] if item["id"] == task["id"]
    )
    assert listed_task["user_name"] == "张三"
    assert listed_task["svn_username"] == "zhangsan"
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd backend
./scripts/test-local.sh tests/api/routes/test_review_tasks.py::test_admin_task_list_includes_user_identity_fields -q
```

Expected: FAIL，响应 JSON 中没有 `user_name` 或 `svn_username`。

- [ ] **Step 3: 修改响应模型**

在 `backend/app/models.py` 的 `ReviewTaskPublic` 中加入：

```python
class ReviewTaskPublic(SQLModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    svn_username: str | None = None
    svn_url: str
    old_revision: str
    new_revision: str
    status: ReviewTaskStatus
    report_path: str | None = None
    error_message: str | None = None
    client_hostname: str | None = None
    client_version: str | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime | None = None
```

- [ ] **Step 4: 增加任务响应转换函数并更新列表返回**

在 `backend/app/api/routes/review_tasks.py` 中加入：

```python
def _task_public(task: ReviewTask, user: User | None = None) -> ReviewTaskPublic:
    public = ReviewTaskPublic.model_validate(task)
    if user is not None:
        public.user_name = user.full_name
        public.svn_username = user.svn_username
    return public
```

将 `read_review_tasks` 中管理员和普通用户的查询都改为关联 `User`：

```python
@router.get("", response_model=ReviewTasksPublic)
def read_review_tasks(
    session: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100
) -> Any:
    if has_admin_privileges(current_user):
        count_statement = select(func.count()).select_from(ReviewTask)
        statement = select(ReviewTask, User).join(User, ReviewTask.user_id == User.id)
    else:
        count_statement = (
            select(func.count())
            .select_from(ReviewTask)
            .where(ReviewTask.user_id == current_user.id)
        )
        statement = (
            select(ReviewTask, User)
            .join(User, ReviewTask.user_id == User.id)
            .where(ReviewTask.user_id == current_user.id)
        )

    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(ReviewTask.created_at).desc()).offset(skip).limit(limit)
    ).all()
    return ReviewTasksPublic(
        data=[_task_public(task, user) for task, user in rows],
        count=count,
    )
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
cd backend
./scripts/test-local.sh tests/api/routes/test_review_tasks.py::test_admin_task_list_includes_user_identity_fields -q
```

Expected: PASS。

- [ ] **Step 6: 跑现有任务列表权限测试**

Run:

```bash
cd backend
./scripts/test-local.sh tests/api/routes/test_review_tasks.py::test_admin_or_superuser_can_list_all_tasks -q
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add backend/app/models.py backend/app/api/routes/review_tasks.py backend/tests/api/routes/test_review_tasks.py
git commit -m "feat: expose review task user identity"
```

---

### Task 2: 后端列表增加用户姓名和 SVN 账号筛选

**Files:**
- Modify: `backend/tests/api/routes/test_review_tasks.py`
- Modify: `backend/app/api/routes/review_tasks.py`

- [ ] **Step 1: 写筛选测试**

在 `backend/tests/api/routes/test_review_tasks.py` 末尾增加：

```python
def _create_named_svn_user_task(
    *,
    client: TestClient,
    db: Session,
    full_name: str,
    svn_username: str,
    old_revision: str,
) -> dict:
    password = random_lower_string()
    user = crud.create_user(
        session=db,
        user_create=UserCreate(
            email=random_email(),
            password=password,
            full_name=full_name,
        ),
    )
    user.svn_username = svn_username
    db.add(user)
    db.commit()
    headers = user_authentication_headers(
        client=client, email=user.email, password=password
    )
    return _create_review_task(client, headers, old_revision=old_revision)


def test_admin_can_filter_review_tasks_by_user_name(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    matched = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="张三",
        svn_username="zhangsan",
        old_revision="21",
    )
    unmatched = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="李四",
        svn_username="lisi",
        old_revision="23",
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=superuser_token_headers,
        params={"user_name": "张"},
    )

    assert response.status_code == 200
    listed_ids = {task["id"] for task in response.json()["data"]}
    assert matched["id"] in listed_ids
    assert unmatched["id"] not in listed_ids


def test_admin_can_filter_review_tasks_by_svn_username(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    matched = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="王五",
        svn_username="wangwu",
        old_revision="25",
    )
    unmatched = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="赵六",
        svn_username="zhaoliu",
        old_revision="27",
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=superuser_token_headers,
        params={"svn_username": "wang"},
    )

    assert response.status_code == 200
    listed_ids = {task["id"] for task in response.json()["data"]}
    assert matched["id"] in listed_ids
    assert unmatched["id"] not in listed_ids


def test_review_task_filters_are_combined_with_and(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    matched = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="钱七",
        svn_username="qianqi",
        old_revision="29",
    )
    same_name_wrong_svn = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="钱七",
        svn_username="another-qian",
        old_revision="31",
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=superuser_token_headers,
        params={"user_name": "钱七", "svn_username": "qianqi"},
    )

    assert response.status_code == 200
    listed_ids = {task["id"] for task in response.json()["data"]}
    assert matched["id"] in listed_ids
    assert same_name_wrong_svn["id"] not in listed_ids
```

- [ ] **Step 2: 写权限隔离测试**

继续在同一文件末尾增加：

```python
def test_normal_user_filters_only_search_own_review_tasks(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    own_task = _create_review_task(
        client, normal_user_token_headers, old_revision="33"
    )
    other_task = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="普通用户可搜索不到的人",
        svn_username="hidden-user",
        old_revision="35",
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        params={"svn_username": "hidden"},
    )

    assert response.status_code == 200
    listed_ids = {task["id"] for task in response.json()["data"]}
    assert own_task["id"] not in listed_ids
    assert other_task["id"] not in listed_ids
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd backend
./scripts/test-local.sh tests/api/routes/test_review_tasks.py::test_admin_can_filter_review_tasks_by_user_name tests/api/routes/test_review_tasks.py::test_admin_can_filter_review_tasks_by_svn_username tests/api/routes/test_review_tasks.py::test_review_task_filters_are_combined_with_and tests/api/routes/test_review_tasks.py::test_normal_user_filters_only_search_own_review_tasks -q
```

Expected: FAIL，接口尚未接收或应用筛选参数。

- [ ] **Step 4: 实现筛选条件**

在 `backend/app/api/routes/review_tasks.py` 中把 `read_review_tasks` 签名改为：

```python
@router.get("", response_model=ReviewTasksPublic)
def read_review_tasks(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    user_name: str | None = None,
    svn_username: str | None = None,
) -> Any:
```

在函数内部构造条件：

```python
    filters = []
    if not has_admin_privileges(current_user):
        filters.append(ReviewTask.user_id == current_user.id)
    if user_name and user_name.strip():
        filters.append(col(User.full_name).ilike(f"%{user_name.strip()}%"))
    if svn_username and svn_username.strip():
        filters.append(col(User.svn_username).ilike(f"%{svn_username.strip()}%"))

    count_statement = (
        select(func.count())
        .select_from(ReviewTask)
        .join(User, ReviewTask.user_id == User.id)
    )
    statement = select(ReviewTask, User).join(User, ReviewTask.user_id == User.id)
    for filter_condition in filters:
        count_statement = count_statement.where(filter_condition)
        statement = statement.where(filter_condition)
```

保留原有排序、分页和返回逻辑：

```python
    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(ReviewTask.created_at).desc()).offset(skip).limit(limit)
    ).all()
    return ReviewTasksPublic(
        data=[_task_public(task, user) for task, user in rows],
        count=count,
    )
```

- [ ] **Step 5: 运行筛选测试确认通过**

Run:

```bash
cd backend
./scripts/test-local.sh tests/api/routes/test_review_tasks.py::test_admin_can_filter_review_tasks_by_user_name tests/api/routes/test_review_tasks.py::test_admin_can_filter_review_tasks_by_svn_username tests/api/routes/test_review_tasks.py::test_review_task_filters_are_combined_with_and tests/api/routes/test_review_tasks.py::test_normal_user_filters_only_search_own_review_tasks -q
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/app/api/routes/review_tasks.py backend/tests/api/routes/test_review_tasks.py
git commit -m "feat: filter review tasks by user identity"
```

---

### Task 3: 后端删除任务并清理报告文件

**Files:**
- Modify: `backend/tests/api/routes/test_review_tasks.py`
- Modify: `backend/app/api/routes/review_tasks.py`

- [ ] **Step 1: 写删除任务测试**

在 `backend/tests/api/routes/test_review_tasks.py` 末尾增加：

```python
def test_delete_review_task_removes_task_row(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    task = _create_review_task(client, normal_user_token_headers, old_revision="41")

    delete_response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert delete_response.status_code == 200
    assert delete_response.json() == {"message": "Review task deleted"}

    read_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )
    assert read_response.status_code == 404
```

- [ ] **Step 2: 写报告文件清理测试**

继续在同一文件末尾增加：

```python
def test_delete_review_task_removes_existing_report_file(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers, old_revision="43")
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/report",
        headers=normal_user_token_headers,
        files={"upload": ("report.md", b"# Report\n", "text/markdown")},
    )
    assert upload_response.status_code == 200
    report_path = Path(upload_response.json()["report_path"])
    assert report_path.is_file()

    delete_response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert delete_response.status_code == 200
    assert not report_path.exists()


def test_delete_review_task_succeeds_when_report_file_is_missing(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers, old_revision="45")
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/report",
        headers=normal_user_token_headers,
        files={"upload": ("report.md", b"# Report\n", "text/markdown")},
    )
    assert upload_response.status_code == 200
    report_path = Path(upload_response.json()["report_path"])
    report_path.unlink()

    delete_response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert delete_response.status_code == 200
    assert delete_response.json() == {"message": "Review task deleted"}
```

- [ ] **Step 3: 写权限测试**

继续在同一文件末尾增加：

```python
def test_normal_user_cannot_delete_other_user_task(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    other_headers = authentication_token_from_email(
        client=client, email=random_email(), db=db
    )
    task = _create_review_task(client, other_headers, old_revision="47")

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"
```

- [ ] **Step 4: 运行测试确认失败**

Run:

```bash
cd backend
./scripts/test-local.sh tests/api/routes/test_review_tasks.py::test_delete_review_task_removes_task_row tests/api/routes/test_review_tasks.py::test_delete_review_task_removes_existing_report_file tests/api/routes/test_review_tasks.py::test_delete_review_task_succeeds_when_report_file_is_missing tests/api/routes/test_review_tasks.py::test_normal_user_cannot_delete_other_user_task -q
```

Expected: FAIL，删除接口尚不存在。

- [ ] **Step 5: 实现删除接口**

在 `backend/app/api/routes/review_tasks.py` 的报告下载接口前增加：

```python
@router.delete("/{task_id}")
def delete_review_task(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> dict[str, str]:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = Path(task.report_path) if task.report_path else None
    if report_path and report_path.exists():
        try:
            report_path.unlink()
        except OSError:
            raise HTTPException(
                status_code=500, detail="Failed to delete review task report"
            )

    session.delete(task)
    session.commit()
    return {"message": "Review task deleted"}
```

- [ ] **Step 6: 运行删除测试确认通过**

Run:

```bash
cd backend
./scripts/test-local.sh tests/api/routes/test_review_tasks.py::test_delete_review_task_removes_task_row tests/api/routes/test_review_tasks.py::test_delete_review_task_removes_existing_report_file tests/api/routes/test_review_tasks.py::test_delete_review_task_succeeds_when_report_file_is_missing tests/api/routes/test_review_tasks.py::test_normal_user_cannot_delete_other_user_task -q
```

Expected: PASS。

- [ ] **Step 7: 运行后端任务接口测试全集**

Run:

```bash
cd backend
./scripts/test-local.sh tests/api/routes/test_review_tasks.py -q
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add backend/app/api/routes/review_tasks.py backend/tests/api/routes/test_review_tasks.py
git commit -m "feat: delete review tasks with reports"
```

---

### Task 4: 前端路由改为 `/admin/tasks/review`

**Files:**
- Modify: `frontend/src/routes/_layout/admin.tasks.tsx`
- Create: `frontend/src/routes/_layout/admin.tasks.review.tsx`
- Modify: `frontend/tests/admin.spec.ts`

- [ ] **Step 1: 更新 E2E 断言**

在 `frontend/tests/admin.spec.ts` 中把 `Admin tasks page is accessible` 测试改为：

```ts
test("Admin review tasks page is accessible", async ({ page }) => {
  await page.goto("/admin/tasks")
  await expect(page).toHaveURL(/\/admin\/tasks\/review/)
  await expect(
    page.getByRole("heading", { name: "代码审查任务管理" }),
  ).toBeVisible()
  const tasksTable = page.getByRole("table").first()
  await expect(
    tasksTable.getByRole("columnheader", { name: "用户名称" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "SVN账号" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "SVN地址" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "版本" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "状态" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "执行客户端" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "报告" }),
  ).toBeVisible()
  await expect(
    tasksTable.getByRole("columnheader", { name: "操作" }),
  ).toBeVisible()
})
```

- [ ] **Step 2: 运行 E2E 确认失败**

Run:

```bash
cd frontend
bunx playwright test tests/admin.spec.ts -g "Admin review tasks page is accessible"
```

Expected: FAIL，当前 `/admin/tasks` 还没有跳转，页面标题和列名也未更新。

- [ ] **Step 3: 修改旧路由为重定向**

将 `frontend/src/routes/_layout/admin.tasks.tsx` 替换为：

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router"

import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/tasks")({
  beforeLoad: async () => {
    await requireAdminUser()
    throw redirect({
      to: "/admin/tasks/review",
    })
  },
})
```

- [ ] **Step 4: 创建新页面路由**

创建 `frontend/src/routes/_layout/admin.tasks.review.tsx`：

```tsx
import { createFileRoute } from "@tanstack/react-router"

import { AdminTasksPage } from "@/components/Admin/TasksPage"
import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/tasks/review")({
  component: AdminTasksPage,
  beforeLoad: async () => {
    await requireAdminUser()
  },
  head: () => ({
    meta: [
      {
        title: "代码审查任务管理 - 沛城科技代码审查平台",
      },
    ],
  }),
})
```

- [ ] **Step 5: 先做最小页面标题和列名修改**

在 `frontend/src/components/Admin/TasksPage.tsx` 中：

```tsx
<TableHead>用户名称</TableHead>
<TableHead>SVN账号</TableHead>
<TableHead>SVN地址</TableHead>
<TableHead>版本</TableHead>
<TableHead>状态</TableHead>
<TableHead>执行客户端</TableHead>
<TableHead>报告</TableHead>
<TableHead>操作</TableHead>
```

并把标题区域改为：

```tsx
<h1 className="text-2xl font-bold tracking-tight">代码审查任务管理</h1>
<p className="text-muted-foreground">查看代码审查任务状态和报告。</p>
```

- [ ] **Step 6: 重新生成路由树**

Run:

```bash
cd frontend
bunx vite --host 127.0.0.1 --clearScreen false
```

Expected: Vite 启动后自动更新 `frontend/src/routeTree.gen.ts`。看到启动成功后停止进程。

- [ ] **Step 7: 运行 E2E 确认路由测试通过**

Run:

```bash
cd frontend
bunx playwright test tests/admin.spec.ts -g "Admin review tasks page is accessible"
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/routes/_layout/admin.tasks.tsx frontend/src/routes/_layout/admin.tasks.review.tsx frontend/src/components/Admin/TasksPage.tsx frontend/src/routeTree.gen.ts frontend/tests/admin.spec.ts
git commit -m "feat: route review task management page"
```

---

### Task 5: 前端侧边栏支持任务管理分组

**Files:**
- Modify: `frontend/src/components/Sidebar/Main.tsx`
- Modify: `frontend/src/components/Sidebar/AppSidebar.tsx`
- Modify: `frontend/tests/admin.spec.ts`

- [ ] **Step 1: 更新侧边栏 E2E 断言**

在 `frontend/tests/admin.spec.ts` 中把 `Admin sidebar entries are visible` 测试改为：

```ts
test("Admin sidebar entries are visible", async ({ page }) => {
  await page.goto("/admin")
  await expect(page.getByRole("link", { name: "用户管理" })).toBeVisible()
  await expect(page.getByText("任务管理")).toBeVisible()
  await expect(
    page.getByRole("link", { name: "代码审查任务管理" }),
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Skill库" })).toBeVisible()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd frontend
bunx playwright test tests/admin.spec.ts -g "Admin sidebar entries are visible"
```

Expected: FAIL，当前侧边栏没有 `代码审查任务管理` 子项。

- [ ] **Step 3: 扩展 Sidebar item 类型并渲染子菜单**

将 `frontend/src/components/Sidebar/Main.tsx` 替换为：

```tsx
import { Link as RouterLink, useRouterState } from "@tanstack/react-router"
import { ChevronDown } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export type Item = {
  icon: LucideIcon
  title: string
  path?: string
  children?: Array<{
    icon: LucideIcon
    title: string
    path: string
  }>
}

interface MainProps {
  items: Item[]
}

export function Main({ items }: MainProps) {
  const { isMobile, setOpenMobile } = useSidebar()
  const router = useRouterState()
  const currentPath = router.location.pathname

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isGroupActive = item.children?.some(
              (child) => currentPath === child.path,
            )

            if (item.children) {
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isGroupActive}
                    className="cursor-default"
                  >
                    <item.icon />
                    <span>{item.title}</span>
                    <ChevronDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                  <div className="mt-1 space-y-1 pl-7 group-data-[collapsible=icon]:hidden">
                    {item.children.map((child) => (
                      <SidebarMenuButton
                        key={child.title}
                        tooltip={child.title}
                        isActive={currentPath === child.path}
                        asChild
                      >
                        <RouterLink to={child.path} onClick={handleMenuClick}>
                          <child.icon />
                          <span>{child.title}</span>
                        </RouterLink>
                      </SidebarMenuButton>
                    ))}
                  </div>
                </SidebarMenuItem>
              )
            }

            if (!item.path) return null
            const isActive = currentPath === item.path

            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive}
                  asChild
                >
                  <RouterLink to={item.path} onClick={handleMenuClick}>
                    <item.icon />
                    <span>{item.title}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
```

- [ ] **Step 4: 更新管理端菜单数据**

在 `frontend/src/components/Sidebar/AppSidebar.tsx` 中保留 import，并让任务管理变成分组：

```tsx
const items = hasAdminPrivileges(currentUser)
  ? [
      ...baseItems,
      { icon: Users, title: "用户管理", path: "/admin/users" },
      {
        icon: ListChecks,
        title: "任务管理",
        children: [
          {
            icon: ListChecks,
            title: "代码审查任务管理",
            path: "/admin/tasks/review",
          },
        ],
      },
      { icon: Library, title: "Skill库", path: "/admin/skills" },
    ]
  : baseItems
```

- [ ] **Step 5: 运行侧边栏测试**

Run:

```bash
cd frontend
bunx playwright test tests/admin.spec.ts -g "Admin sidebar entries are visible"
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/Sidebar/Main.tsx frontend/src/components/Sidebar/AppSidebar.tsx frontend/tests/admin.spec.ts
git commit -m "feat: group task management navigation"
```

---

### Task 6: 前端任务页增加筛选、身份列和删除操作

**Files:**
- Modify: `frontend/src/components/Admin/TasksPage.tsx`
- Modify: `frontend/tests/admin.spec.ts`

- [ ] **Step 1: 更新任务页面 E2E 断言**

在 `frontend/tests/admin.spec.ts` 中新增：

```ts
test("Admin review tasks page has user filters", async ({ page }) => {
  await page.goto("/admin/tasks/review")
  await expect(page.getByPlaceholder("用户姓名")).toBeVisible()
  await expect(page.getByPlaceholder("SVN账号")).toBeVisible()
  await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
  await expect(page.getByRole("button", { name: "重置" })).toBeVisible()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd frontend
bunx playwright test tests/admin.spec.ts -g "Admin review tasks page has user filters"
```

Expected: FAIL，页面还没有筛选区。

- [ ] **Step 3: 修改任务类型和读取函数**

在 `frontend/src/components/Admin/TasksPage.tsx` 中更新 `ReviewTask` 类型：

```tsx
type ReviewTask = {
  id: string
  user_name?: string | null
  svn_username?: string | null
  svn_url: string
  old_revision: string
  new_revision: string
  status: string
  report_path?: string | null
  client_hostname?: string | null
  client_version?: string | null
}
```

增加筛选类型并修改读取函数：

```tsx
type ReviewTaskFilters = {
  userName: string
  svnUsername: string
}

async function readReviewTasks(
  filters: ReviewTaskFilters,
): Promise<ReviewTasksResponse> {
  const token = localStorage.getItem("access_token")
  const params = new URLSearchParams({ limit: "100" })
  if (filters.userName.trim()) {
    params.set("user_name", filters.userName.trim())
  }
  if (filters.svnUsername.trim()) {
    params.set("svn_username", filters.svnUsername.trim())
  }

  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks?${params.toString()}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )

  if (!response.ok) {
    throw new Error("Failed to load review tasks")
  }

  return response.json()
}

function getReviewTasksQueryOptions(filters: ReviewTaskFilters) {
  return {
    queryFn: () => readReviewTasks(filters),
    queryKey: ["review-tasks", "admin", filters],
  }
}
```

- [ ] **Step 4: 增加删除 API 函数**

在 `frontend/src/components/Admin/TasksPage.tsx` 中增加：

```tsx
async function deleteReviewTask(task: ReviewTask) {
  const token = localStorage.getItem("access_token")
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks/${task.id}`,
    {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )

  if (!response.ok) {
    throw new Error("Failed to delete review task")
  }
}
```

- [ ] **Step 5: 实现筛选区、表格列和删除弹窗**

将 `ReviewTasksTable` 和 `ReviewTasksSection` 改为接收 filters，并在 `AdminTasksPage` 中管理草稿筛选值和已提交筛选值。使用现有 `Input`、`Button`、`Dialog`、`toast`：

```tsx
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Download, ExternalLink, Search, Trash2, X } from "lucide-react"
import { Suspense, useState } from "react"
import { toast } from "sonner"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
```

表格行中新增身份列和操作列：

```tsx
<TableCell>{task.user_name || "-"}</TableCell>
<TableCell>{task.svn_username || "-"}</TableCell>
<TableCell className="max-w-sm truncate font-medium">
  {task.svn_url}
</TableCell>
```

操作列：

```tsx
<TableCell>
  <Button
    type="button"
    variant="ghost"
    size="icon-sm"
    aria-label="删除任务"
    onClick={() => setDeletingTask(task)}
  >
    <Trash2 />
  </Button>
</TableCell>
```

删除确认：

```tsx
<Dialog
  open={Boolean(deletingTask)}
  onOpenChange={(open) => {
    if (!open) setDeletingTask(null)
  }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>删除代码审查任务</DialogTitle>
      <DialogDescription>
        删除后会同时删除任务记录和已上传的报告文件，此操作不可撤销。
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        onClick={() => setDeletingTask(null)}
      >
        取消
      </Button>
      <Button
        type="button"
        variant="destructive"
        onClick={() => void handleDelete()}
      >
        删除
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

删除处理：

```tsx
const handleDelete = async () => {
  if (!deletingTask) return
  try {
    await deleteReviewTask(deletingTask)
    toast.success("代码审查任务已删除")
    setDeletingTask(null)
    await queryClient.invalidateQueries({ queryKey: ["review-tasks"] })
  } catch {
    toast.error("删除代码审查任务失败")
  }
}
```

筛选区：

```tsx
<div className="flex flex-col gap-3 md:flex-row md:items-center">
  <Input
    placeholder="用户姓名"
    value={draftFilters.userName}
    onChange={(event) =>
      setDraftFilters((current) => ({
        ...current,
        userName: event.target.value,
      }))
    }
  />
  <Input
    placeholder="SVN账号"
    value={draftFilters.svnUsername}
    onChange={(event) =>
      setDraftFilters((current) => ({
        ...current,
        svnUsername: event.target.value,
      }))
    }
  />
  <Button type="button" onClick={() => setFilters(draftFilters)}>
    <Search />
    搜索
  </Button>
  <Button
    type="button"
    variant="outline"
    onClick={() => {
      setDraftFilters({ userName: "", svnUsername: "" })
      setFilters({ userName: "", svnUsername: "" })
    }}
  >
    <X />
    重置
  </Button>
</div>
```

- [ ] **Step 6: 运行筛选区测试**

Run:

```bash
cd frontend
bunx playwright test tests/admin.spec.ts -g "Admin review tasks page has user filters"
```

Expected: PASS。

- [ ] **Step 7: 运行任务页面可访问测试**

Run:

```bash
cd frontend
bunx playwright test tests/admin.spec.ts -g "Admin review tasks page is accessible"
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/components/Admin/TasksPage.tsx frontend/tests/admin.spec.ts
git commit -m "feat: manage review task filters and deletion"
```

---

### Task 7: 最终验证和收尾

**Files:**
- Verify only.

- [ ] **Step 1: 运行后端任务接口测试全集**

Run:

```bash
cd backend
./scripts/test-local.sh tests/api/routes/test_review_tasks.py -q
```

Expected: PASS。

- [ ] **Step 2: 运行前端管理页 E2E 测试**

Run:

```bash
cd frontend
bunx playwright test tests/admin.spec.ts
```

Expected: PASS。

- [ ] **Step 3: 运行前端构建**

Run:

```bash
cd frontend
bun run build
```

Expected: PASS，TypeScript 编译和 Vite 构建成功。

- [ ] **Step 4: 检查工作区只包含本功能相关改动**

Run:

```bash
git status --short
```

Expected: 本功能提交后没有未提交的相关文件；如果仓库中仍有进入本任务前已存在的未提交文件，不要回滚它们。
