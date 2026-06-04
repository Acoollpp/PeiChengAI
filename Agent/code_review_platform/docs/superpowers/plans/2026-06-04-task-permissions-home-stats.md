# Task Permissions Home Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix normal-user navigation and task visibility, keep department management for admins, and add role-scoped task statistics to the home page.

**Architecture:** Keep authorization decisions on the backend wherever data scope matters: `/review-tasks` and the new `/review-tasks/stats` both derive scope from the authenticated user. The frontend exposes a shared task management route at `/tasks/review`, keeps admin-only pages under admin guards, and renders a home stats panel from the new stats endpoint using existing React, Tailwind, and shadcn-style UI primitives.

**Tech Stack:** FastAPI, SQLModel, pytest, React 19, TypeScript, TanStack Router, TanStack Query, Playwright, Tailwind CSS, lucide-react.

---

## File Structure

- Modify `code_review_server/backend/app/models.py`
  - Add `ReviewTaskStatsPublic` response model.
  - Keep all existing task public models unchanged.
- Modify `code_review_server/backend/app/api/routes/review_tasks.py`
  - Add status grouping constants.
  - Add `GET /api/v1/review-tasks/stats`.
  - Ensure `/stats` is registered before `/{task_id}`.
- Modify `code_review_server/backend/tests/api/routes/test_review_tasks.py`
  - Add backend tests for normal-user stats scope, admin stats scope, zero-filled statuses, and aggregate fields.
- Modify `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`
  - Change `仪表盘` to `主页`.
  - Remove `部门管理` from normal-user items.
  - Keep `部门管理` in admin items.
  - Point task management to `/tasks/review`.
- Modify `code_review_server/frontend/src/routes/_layout/items.tsx`
  - Add `beforeLoad` admin guard using `requireAdminUser()`.
  - Change tests to expect normal-user redirect.
- Create `code_review_server/frontend/src/routes/_layout/tasks.review.tsx`
  - Shared route for normal users and admins.
  - Render the task management component.
- Modify `code_review_server/frontend/src/routes/_layout/admin.tasks.tsx`
  - Redirect `/admin/tasks` to `/tasks/review` for admins.
- Modify `code_review_server/frontend/src/routes/_layout/admin.tasks.review.tsx`
  - Redirect `/admin/tasks/review` to `/tasks/review` for admins, preserving `/admin` guard.
- Create `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`
  - Move/adapt the current `AdminTasksPage` implementation into a shared task page.
  - Hide user filters for non-admins.
  - Keep report open, download, and delete actions.
- Modify `code_review_server/frontend/src/components/Admin/TasksPage.tsx`
  - Replace with a thin re-export of the shared `TasksPage` component.
- Create `code_review_server/frontend/src/components/Home/TaskStatsPanel.tsx`
  - Fetch `/api/v1/review-tasks/stats`.
  - Render summary cards and a horizontal status count chart.
- Modify `code_review_server/frontend/src/routes/_layout/index.tsx`
  - Rename page metadata from `仪表盘` to `主页`.
  - Render `TaskStatsPanel` below the welcome text.
- Modify `code_review_server/frontend/tests/admin.spec.ts`
  - Update sidebar and admin task route expectations.
  - Add admin department menu expectation.
- Modify `code_review_server/frontend/tests/items.spec.ts`
  - Change normal-user items tests to assert redirect instead of CRUD access.
  - Keep admin items access test using default admin storage state.
- Create `code_review_server/frontend/tests/tasks.spec.ts`
  - Cover normal-user task route access and hidden filters.
  - Cover admin task route access, old admin route redirect, and visible filters.
- Create `code_review_server/frontend/tests/home.spec.ts`
  - Cover `主页` label and stats panel.

---

### Task 1: Add Backend Task Stats API

**Files:**
- Modify: `code_review_server/backend/app/models.py`
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`

- [ ] **Step 1: Write failing backend stats tests**

Append these tests near the existing review task list/filter tests in `code_review_server/backend/tests/api/routes/test_review_tasks.py`:

```python
def test_normal_user_task_stats_only_count_own_tasks(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    own_task = _create_review_task(client, normal_user_token_headers, old_revision="31")
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{own_task['id']}/status",
        headers=normal_user_token_headers,
        json={"status": "success"},
    )
    _, other_api_key = create_key_user(db)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
    )
    other_task = _create_review_task(client, other_headers, old_revision="32")
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{other_task['id']}/status",
        headers=other_headers,
        json={"status": "failed"},
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] == 1
    assert content["success"] == 1
    assert content["running"] == 0
    assert content["failed_or_error"] == 0
    assert content["by_status"]["success"] == 1
    assert content["by_status"]["failed"] == 0


def test_admin_task_stats_count_all_tasks(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    success_task = _create_review_task(
        client, normal_user_token_headers, old_revision="33"
    )
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{success_task['id']}/status",
        headers=normal_user_token_headers,
        json={"status": "success"},
    )
    _, other_api_key = create_key_user(db)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
    )
    running_task = _create_review_task(client, other_headers, old_revision="34")
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{running_task['id']}/status",
        headers=other_headers,
        json={"status": "running_codex"},
    )
    failed_task = _create_review_task(client, other_headers, old_revision="35")
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{failed_task['id']}/status",
        headers=other_headers,
        json={"status": "environment_error"},
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] >= 3
    assert content["success"] >= 1
    assert content["running"] >= 1
    assert content["failed_or_error"] >= 1
    assert content["by_status"]["success"] >= 1
    assert content["by_status"]["running_codex"] >= 1
    assert content["by_status"]["environment_error"] >= 1


def test_task_stats_include_all_status_keys_with_zero_counts(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert set(content["by_status"]) == {
        "created",
        "checking_environment",
        "running_codex",
        "uploading_report",
        "success",
        "failed",
        "environment_error",
        "cancelled",
    }
    for count in content["by_status"].values():
        assert isinstance(count, int)
        assert count >= 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py::test_normal_user_task_stats_only_count_own_tasks tests/api/routes/test_review_tasks.py::test_admin_task_stats_count_all_tasks tests/api/routes/test_review_tasks.py::test_task_stats_include_all_status_keys_with_zero_counts -v
```

Expected: FAIL with `404` for `/api/v1/review-tasks/stats`, because the endpoint does not exist yet.

- [ ] **Step 3: Add stats response model**

In `code_review_server/backend/app/models.py`, add this model immediately after `ReviewTasksPublic`:

```python
class ReviewTaskStatsPublic(SQLModel):
    total: int
    success: int
    running: int
    failed_or_error: int
    by_status: dict[ReviewTaskStatus, int]
```

- [ ] **Step 4: Add stats endpoint**

In `code_review_server/backend/app/api/routes/review_tasks.py`, add `ReviewTaskStatsPublic` to the import list from `app.models`:

```python
    ReviewTaskPublic,
    ReviewTasksPublic,
    ReviewTaskStatsPublic,
    ReviewTaskStatus,
```

Then add these constants after `_REVISION_RE`:

```python
_RUNNING_STATUSES = {
    ReviewTaskStatus.checking_environment,
    ReviewTaskStatus.running_codex,
    ReviewTaskStatus.uploading_report,
}

_FAILED_OR_ERROR_STATUSES = {
    ReviewTaskStatus.failed,
    ReviewTaskStatus.environment_error,
    ReviewTaskStatus.cancelled,
}
```

Add this route after `read_review_tasks()` and before `read_review_task()` so `/stats` is not captured as `{task_id}`:

```python
@router.get("/stats", response_model=ReviewTaskStatsPublic)
def read_review_task_stats(
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    filters = []
    if not has_admin_privileges(current_user):
        filters.append(ReviewTask.user_id == current_user.id)

    statement = select(ReviewTask.status, func.count()).where(*filters).group_by(
        ReviewTask.status
    )
    rows = session.exec(statement).all()
    by_status = {status: 0 for status in ReviewTaskStatus}
    for status, count in rows:
        by_status[status] = count

    return ReviewTaskStatsPublic(
        total=sum(by_status.values()),
        success=by_status[ReviewTaskStatus.success],
        running=sum(by_status[status] for status in _RUNNING_STATUSES),
        failed_or_error=sum(
            by_status[status] for status in _FAILED_OR_ERROR_STATUSES
        ),
        by_status=by_status,
    )
```

- [ ] **Step 5: Run backend stats tests**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py::test_normal_user_task_stats_only_count_own_tasks tests/api/routes/test_review_tasks.py::test_admin_task_stats_count_all_tasks tests/api/routes/test_review_tasks.py::test_task_stats_include_all_status_keys_with_zero_counts -v
```

Expected: PASS for all three tests.

- [ ] **Step 6: Run full review task API tests**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -v
```

Expected: PASS. Existing task list/detail/report/delete behavior remains unchanged.

- [ ] **Step 7: Commit backend stats API**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/backend/app/models.py code_review_server/backend/app/api/routes/review_tasks.py code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "feat: add role scoped review task stats"
```

Expected: Commit contains only backend stats model, endpoint, and tests.

---

### Task 2: Fix Sidebar and Route Permissions

**Files:**
- Modify: `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`
- Modify: `code_review_server/frontend/src/routes/_layout/items.tsx`
- Create: `code_review_server/frontend/src/routes/_layout/tasks.review.tsx`
- Modify: `code_review_server/frontend/src/routes/_layout/admin.tasks.tsx`
- Modify: `code_review_server/frontend/src/routes/_layout/admin.tasks.review.tsx`
- Modify: `code_review_server/frontend/tests/admin.spec.ts`
- Modify: `code_review_server/frontend/tests/items.spec.ts`
- Create: `code_review_server/frontend/tests/tasks.spec.ts`

- [ ] **Step 1: Update failing Playwright expectations**

Modify `code_review_server/frontend/tests/admin.spec.ts`.

Replace the current `Admin tasks page is accessible` test body with:

```ts
test("Admin tasks page redirects to shared task management", async ({ page }) => {
  await page.goto("/admin/tasks")
  await expect(page).toHaveURL(/\/tasks\/review/)
  await expect(
    page.getByRole("heading", { name: "代码审查任务管理" }),
  ).toBeVisible()
})
```

Replace the current `Admin sidebar entry is visible` test with:

```ts
test("Admin sidebar entries are visible", async ({ page }) => {
  await page.goto("/admin")
  await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
  await expect(page.getByRole("link", { name: "部门管理" })).toBeVisible()
  await expect(page.getByRole("link", { name: "用户管理" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Skill库" })).toBeVisible()
  const taskMenu = page.getByRole("button", { name: "任务管理" })
  await expect(taskMenu).toBeVisible()
  await expect(taskMenu).toHaveAttribute("aria-expanded", "false")
  await expect(
    page.getByRole("link", { name: "代码审查任务管理" }),
  ).not.toBeVisible()

  await taskMenu.click()
  await expect(taskMenu).toHaveAttribute("aria-expanded", "true")
  await expect(
    page.getByRole("link", { name: "代码审查任务管理" }),
  ).toBeVisible()

  await taskMenu.click()
  await expect(taskMenu).toHaveAttribute("aria-expanded", "false")
  await expect(
    page.getByRole("link", { name: "代码审查任务管理" }),
  ).not.toBeVisible()
})
```

Modify `code_review_server/frontend/tests/items.spec.ts`.

Keep this admin access test at top-level:

```ts
test("Admin can access items page and sees correct title", async ({ page }) => {
  await page.goto("/items")
  await expect(page.getByRole("heading", { name: "部门管理" })).toBeVisible()
  await expect(page.getByText("创建并管理部门信息")).toBeVisible()
  await expect(page.getByRole("button", { name: "新增部门" })).toBeVisible()
})
```

Replace normal-user CRUD tests in `items.spec.ts` with this access-control test:

```ts
test.describe("Items page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Normal user is redirected away from items page", async ({ page }) => {
    const svnUsername = uniqueSvnUsername()
    await createUser({ svnUsername })
    await logInWithSvn(page, svnUsername, testSvnPassword)

    await page.goto("/items")

    await expect(page).toHaveURL("/")
    await expect(
      page.getByRole("heading", { name: /你好，/ }),
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "部门管理" }),
    ).not.toBeVisible()
  })
})
```

Create `code_review_server/frontend/tests/tasks.spec.ts`:

```ts
import { expect, test } from "@playwright/test"
import { testApiKey, testSvnPassword } from "./config.ts"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { logInWithKey, logInWithSvn } from "./utils/user"

test.describe("Normal user task navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Normal user sees task management but not department management", async ({
    page,
  }) => {
    const svnUsername = uniqueSvnUsername()
    await createUser({ svnUsername })
    await logInWithSvn(page, svnUsername, testSvnPassword)

    await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
    await expect(
      page.getByRole("link", { name: "部门管理" }),
    ).not.toBeVisible()

    const taskMenu = page.getByRole("button", { name: "任务管理" })
    await expect(taskMenu).toBeVisible()
    await taskMenu.click()
    await page.getByRole("link", { name: "代码审查任务管理" }).click()

    await expect(page).toHaveURL(/\/tasks\/review/)
    await expect(
      page.getByRole("heading", { name: "代码审查任务管理" }),
    ).toBeVisible()
  })
})

test.describe("Admin task navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Admin can use shared task route and old admin route redirects", async ({
    page,
  }) => {
    await logInWithKey(page, testApiKey)

    await page.goto("/admin/tasks/review")
    await expect(page).toHaveURL(/\/tasks\/review/)
    await expect(
      page.getByRole("heading", { name: "代码审查任务管理" }),
    ).toBeVisible()
  })
})
```

- [ ] **Step 2: Run Playwright route tests to verify failures**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/tasks.spec.ts tests/items.spec.ts tests/admin.spec.ts --project=chromium
```

Expected: FAIL because `/tasks/review` does not exist, normal users still see `部门管理`, admin task routes still point to `/admin/tasks/review`, and `/items` lacks an admin guard.

- [ ] **Step 3: Update sidebar items**

Modify `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`:

```tsx
import { Briefcase, Home, Library, ListChecks, Users } from "lucide-react"

import { SidebarAppearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { hasAdminPrivileges } from "@/lib/authz"
import { type Item, Main } from "./Main"
import { User } from "./User"

const userItems: Item[] = [
  { icon: Home, title: "主页", path: "/" },
  {
    icon: ListChecks,
    title: "任务管理",
    children: [
      {
        icon: ListChecks,
        title: "代码审查任务管理",
        path: "/tasks/review",
      },
    ],
  },
]

const adminItems: Item[] = [
  { icon: Home, title: "主页", path: "/" },
  { icon: Briefcase, title: "部门管理", path: "/items" },
  { icon: Users, title: "用户管理", path: "/admin/users" },
  {
    icon: ListChecks,
    title: "任务管理",
    children: [
      {
        icon: ListChecks,
        title: "代码审查任务管理",
        path: "/tasks/review",
      },
    ],
  },
  { icon: Library, title: "Skill库", path: "/admin/skills" },
]

export function AppSidebar() {
  const { user: currentUser } = useAuth()
  const items = hasAdminPrivileges(currentUser) ? adminItems : userItems

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        <Main items={items} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarAppearance />
        <User user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
```

- [ ] **Step 4: Guard items route**

In `code_review_server/frontend/src/routes/_layout/items.tsx`, add the import:

```ts
import { requireAdminUser } from "@/lib/admin-route"
```

Update the route definition:

```tsx
export const Route = createFileRoute("/_layout/items")({
  component: Items,
  beforeLoad: async () => {
    await requireAdminUser()
  },
  head: () => ({
    meta: [
      {
        title: "部门管理 - 沛城科技代码审查平台",
      },
    ],
  }),
})
```

- [ ] **Step 5: Add shared task route**

Create `code_review_server/frontend/src/routes/_layout/tasks.review.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router"

import { TasksPage } from "@/components/Tasks/TasksPage"

export const Route = createFileRoute("/_layout/tasks/review")({
  component: TasksPage,
  head: () => ({
    meta: [
      {
        title: "代码审查任务管理 - 沛城科技代码审查平台",
      },
    ],
  }),
})
```

For this task only, create a temporary re-export file at `code_review_server/frontend/src/components/Tasks/TasksPage.tsx` so the route can compile before Task 3 migrates the component:

```tsx
export { AdminTasksPage as TasksPage } from "@/components/Admin/TasksPage"
```

- [ ] **Step 6: Redirect old admin task routes**

Modify `code_review_server/frontend/src/routes/_layout/admin.tasks.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router"

import { UsersService } from "@/client"
import { hasAdminPrivileges } from "@/lib/authz"

export const Route = createFileRoute("/_layout/admin/tasks")({
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!hasAdminPrivileges(user)) {
      throw redirect({
        to: "/",
      })
    }

    throw redirect({
      to: "/tasks/review",
    })
  },
})
```

Modify `code_review_server/frontend/src/routes/_layout/admin.tasks.review.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_layout/admin/tasks/review")({
  beforeLoad: () => {
    throw redirect({
      to: "/tasks/review",
    })
  },
})
```

- [ ] **Step 7: Build frontend to regenerate route tree**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run build
```

Expected: PASS. `src/routeTree.gen.ts` updates to include `/tasks/review`.

- [ ] **Step 8: Run route tests**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/tasks.spec.ts tests/items.spec.ts tests/admin.spec.ts --project=chromium
```

Expected: PASS for menu and route access. This task does not assert role-specific filters yet.

- [ ] **Step 9: Commit route and sidebar changes**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx code_review_server/frontend/src/routes/_layout/items.tsx code_review_server/frontend/src/routes/_layout/tasks.review.tsx code_review_server/frontend/src/routes/_layout/admin.tasks.tsx code_review_server/frontend/src/routes/_layout/admin.tasks.review.tsx code_review_server/frontend/src/components/Tasks/TasksPage.tsx code_review_server/frontend/src/routeTree.gen.ts code_review_server/frontend/tests/admin.spec.ts code_review_server/frontend/tests/items.spec.ts code_review_server/frontend/tests/tasks.spec.ts
git commit -m "feat: expose task management to normal users"
```

Expected: Commit contains sidebar, route, route tree, temporary task page re-export, and route tests.

---

### Task 3: Convert Admin Tasks Page to Shared Role-Aware Page

**Files:**
- Modify/Create: `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/TasksPage.tsx`
- Test: `code_review_server/frontend/tests/tasks.spec.ts`
- Test: `code_review_server/frontend/tests/admin.spec.ts`

- [ ] **Step 1: Add failing role-specific filter assertions**

Modify `code_review_server/frontend/tests/tasks.spec.ts`.

In the normal-user test, add these assertions after the heading assertion:

```ts
    await expect(page.getByPlaceholder("用户姓名")).not.toBeVisible()
    await expect(page.getByPlaceholder("SVN账号")).not.toBeVisible()
```

In the admin test, add these assertions after the heading assertion:

```ts
    await expect(page.getByPlaceholder("用户姓名")).toBeVisible()
    await expect(page.getByPlaceholder("SVN账号")).toBeVisible()
```

- [ ] **Step 2: Confirm current filter test fails for normal user**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/tasks.spec.ts --project=chromium
```

Expected before implementation: FAIL on normal-user assertions that `用户姓名` and `SVN账号` placeholders are not visible, because the current admin page always shows filters.

- [ ] **Step 3: Replace temporary shared task page with role-aware component**

Replace `code_review_server/frontend/src/components/Tasks/TasksPage.tsx` with:

```tsx
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Download, ExternalLink, Search, Trash2, X } from "lucide-react"
import { type FormEvent, Suspense, useState } from "react"
import { toast } from "sonner"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useAuth from "@/hooks/useAuth"
import { hasAdminPrivileges } from "@/lib/authz"

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

type ReviewTasksResponse = {
  data: ReviewTask[]
  count: number
}

type ReviewTaskFilters = {
  userName: string
  svnUsername: string
}

const emptyFilters: ReviewTaskFilters = {
  userName: "",
  svnUsername: "",
}

const statusLabels: Record<string, string> = {
  created: "待处理",
  checking_environment: "环境检查中",
  running_codex: "运行中",
  uploading_report: "上传报告中",
  success: "成功",
  failed: "失败",
  environment_error: "环境异常",
  cancelled: "已取消",
}

async function readReviewTasks(
  filters: ReviewTaskFilters,
  canFilterUsers: boolean,
): Promise<ReviewTasksResponse> {
  const token = localStorage.getItem("access_token")
  const searchParams = new URLSearchParams({ limit: "100" })

  if (canFilterUsers) {
    const userName = filters.userName.trim()
    const svnUsername = filters.svnUsername.trim()

    if (userName) {
      searchParams.set("user_name", userName)
    }

    if (svnUsername) {
      searchParams.set("svn_username", svnUsername)
    }
  }

  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/review-tasks?${searchParams}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  )

  if (!response.ok) {
    throw new Error("Failed to load review tasks")
  }

  return response.json()
}

function getReviewTasksQueryOptions(
  filters: ReviewTaskFilters,
  canFilterUsers: boolean,
) {
  return {
    queryFn: () => readReviewTasks(filters, canFilterUsers),
    queryKey: ["review-tasks", canFilterUsers ? "admin" : "me", filters],
  }
}

function reportUrl(task: ReviewTask, action: "report" | "download") {
  return `${OpenAPI.BASE}/api/v1/review-tasks/${task.id}/${action}`
}

async function fetchReport(task: ReviewTask, action: "report" | "download") {
  const token = localStorage.getItem("access_token")
  const response = await fetch(reportUrl(task, action), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })

  if (!response.ok) {
    throw new Error("Failed to load report")
  }

  return response.blob()
}

async function openReport(task: ReviewTask) {
  const blob = await fetchReport(task, "report")
  window.open(URL.createObjectURL(blob), "_blank", "noreferrer")
}

async function downloadReport(task: ReviewTask) {
  const blob = await fetchReport(task, "download")
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `review-task-${task.id}.md`
  link.click()
}

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

  return response.json()
}

function ReviewTasksTable({
  filters,
  canFilterUsers,
}: {
  filters: ReviewTaskFilters
  canFilterUsers: boolean
}) {
  const queryClient = useQueryClient()
  const [taskToDelete, setTaskToDelete] = useState<ReviewTask | null>(null)
  const { data: tasks } = useSuspenseQuery(
    getReviewTasksQueryOptions(filters, canFilterUsers),
  )
  const deleteMutation = useMutation({
    mutationFn: deleteReviewTask,
    onSuccess: async () => {
      toast.success("代码审查任务已删除")
      setTaskToDelete(null)
      await queryClient.invalidateQueries({ queryKey: ["review-tasks"] })
      await queryClient.invalidateQueries({ queryKey: ["review-task-stats"] })
    },
    onError: () => {
      toast.error("删除代码审查任务失败")
    },
  })

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>用户名称</TableHead>
            <TableHead>SVN账号</TableHead>
            <TableHead>SVN地址</TableHead>
            <TableHead>版本</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>执行客户端</TableHead>
            <TableHead>报告</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.data.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={8}
                className="h-32 text-center text-muted-foreground"
              >
                暂无审查任务
              </TableCell>
            </TableRow>
          ) : (
            tasks.data.map((task) => (
              <TableRow key={task.id}>
                <TableCell>{task.user_name || "-"}</TableCell>
                <TableCell>{task.svn_username || "-"}</TableCell>
                <TableCell className="max-w-sm truncate font-medium">
                  {task.svn_url}
                </TableCell>
                <TableCell>
                  {task.old_revision} → {task.new_revision}
                </TableCell>
                <TableCell>{statusLabels[task.status] ?? task.status}</TableCell>
                <TableCell className="text-muted-foreground">
                  {[task.client_hostname, task.client_version]
                    .filter(Boolean)
                    .join(" / ") || "-"}
                </TableCell>
                <TableCell>
                  {task.report_path ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="打开报告"
                        onClick={() => void openReport(task)}
                      >
                        <ExternalLink />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="下载报告"
                        onClick={() => void downloadReport(task)}
                      >
                        <Download />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="删除任务"
                    onClick={() => setTaskToDelete(task)}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Dialog
        open={taskToDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setTaskToDelete(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除代码审查任务</DialogTitle>
            <DialogDescription>
              此操作会同时删除任务记录和已上传报告文件，且不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending || taskToDelete === null}
              onClick={() => {
                if (taskToDelete) {
                  deleteMutation.mutate(taskToDelete)
                }
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ReviewTasksSection({
  filters,
  canFilterUsers,
}: {
  filters: ReviewTaskFilters
  canFilterUsers: boolean
}) {
  return (
    <Suspense fallback={<div className="text-muted-foreground">加载中...</div>}>
      <ReviewTasksTable filters={filters} canFilterUsers={canFilterUsers} />
    </Suspense>
  )
}

export function TasksPage() {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()
  const canFilterUsers = hasAdminPrivileges(currentUser)
  const [draftFilters, setDraftFilters] =
    useState<ReviewTaskFilters>(emptyFilters)
  const [filters, setFilters] = useState<ReviewTaskFilters>(emptyFilters)

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFilters({ ...draftFilters })
  }

  const handleReset = () => {
    setDraftFilters({ ...emptyFilters })
    setFilters({ ...emptyFilters })
    void queryClient.invalidateQueries({ queryKey: ["review-tasks"] })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">代码审查任务管理</h1>
        <p className="text-muted-foreground">
          {canFilterUsers
            ? "查看代码审查任务状态和报告。"
            : "查看自己提交的代码审查任务状态和报告。"}
        </p>
      </div>
      {canFilterUsers ? (
        <form
          className="flex flex-col gap-3 md:flex-row md:items-center"
          onSubmit={handleSearch}
        >
          <Input
            className="md:max-w-56"
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
            className="md:max-w-56"
            placeholder="SVN账号"
            value={draftFilters.svnUsername}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                svnUsername: event.target.value,
              }))
            }
          />
          <div className="flex items-center gap-2">
            <Button type="submit">
              <Search />
              搜索
            </Button>
            <Button type="button" variant="outline" onClick={handleReset}>
              <X />
              重置
            </Button>
          </div>
        </form>
      ) : null}
      <ReviewTasksSection filters={filters} canFilterUsers={canFilterUsers} />
    </div>
  )
}
```

- [ ] **Step 4: Re-export old AdminTasksPage**

Replace `code_review_server/frontend/src/components/Admin/TasksPage.tsx` with a thin compatibility re-export:

```tsx
export { TasksPage as AdminTasksPage } from "@/components/Tasks/TasksPage"
```

This avoids stale imports while keeping the admin route redirect file simple.

- [ ] **Step 5: Run task and admin Playwright tests**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/tasks.spec.ts tests/admin.spec.ts --project=chromium
```

Expected: PASS. Normal users can open `/tasks/review` and do not see user filters; admins see filters.

- [ ] **Step 6: Run frontend build**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run build
```

Expected: PASS. TypeScript accepts the shared route and component.

- [ ] **Step 7: Commit shared task page**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/components/Tasks/TasksPage.tsx code_review_server/frontend/src/components/Admin/TasksPage.tsx code_review_server/frontend/tests/tasks.spec.ts code_review_server/frontend/tests/admin.spec.ts
git commit -m "feat: make review tasks page role aware"
```

Expected: Commit contains the shared task page and related test updates.

---

### Task 4: Add Home Page Task Stats Panel

**Files:**
- Create: `code_review_server/frontend/src/components/Home/TaskStatsPanel.tsx`
- Modify: `code_review_server/frontend/src/routes/_layout/index.tsx`
- Create: `code_review_server/frontend/tests/home.spec.ts`

- [ ] **Step 1: Write failing home stats test**

Create `code_review_server/frontend/tests/home.spec.ts`:

```ts
import { expect, test } from "@playwright/test"
import { testSvnPassword } from "./config.ts"
import { createUser, uniqueSvnUsername } from "./utils/privateApi"
import { logInWithSvn } from "./utils/user"

test("Home page is renamed and shows task statistics", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
  await expect(page.getByRole("heading", { name: /你好，/ })).toBeVisible()
  await expect(page.getByText("任务统计")).toBeVisible()
  await expect(page.getByText("总任务数")).toBeVisible()
  await expect(page.getByText("成功数")).toBeVisible()
  await expect(page.getByText("失败/异常数")).toBeVisible()
  await expect(page.getByText("运行中数")).toBeVisible()
  await expect(page.getByText("状态分布")).toBeVisible()
  await expect(page.getByText("待处理")).toBeVisible()
  await expect(page.getByText("环境检查中")).toBeVisible()
  await expect(page.getByText("运行中")).toBeVisible()
  await expect(page.getByText("上传报告中")).toBeVisible()
  await expect(page.getByText("成功")).toBeVisible()
  await expect(page.getByText("失败")).toBeVisible()
  await expect(page.getByText("环境异常")).toBeVisible()
  await expect(page.getByText("已取消")).toBeVisible()
})

test.describe("Normal user home navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Normal user home does not show department management", async ({
    page,
  }) => {
    const svnUsername = uniqueSvnUsername()
    await createUser({ svnUsername })
    await logInWithSvn(page, svnUsername, testSvnPassword)

    await expect(page.getByRole("link", { name: "主页" })).toBeVisible()
    await expect(
      page.getByRole("link", { name: "部门管理" }),
    ).not.toBeVisible()
    await expect(page.getByText("任务统计")).toBeVisible()
  })
})
```

- [ ] **Step 2: Run home test to verify it fails**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/home.spec.ts --project=chromium
```

Expected: FAIL because `TaskStatsPanel` does not exist and the home page still has no stats panel.

- [ ] **Step 3: Create TaskStatsPanel component**

Create `code_review_server/frontend/src/components/Home/TaskStatsPanel.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query"
import { Activity, CheckCircle2, CircleAlert, ListChecks } from "lucide-react"

import { OpenAPI } from "@/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type ReviewTaskStatus =
  | "created"
  | "checking_environment"
  | "running_codex"
  | "uploading_report"
  | "success"
  | "failed"
  | "environment_error"
  | "cancelled"

type ReviewTaskStats = {
  total: number
  success: number
  running: number
  failed_or_error: number
  by_status: Record<ReviewTaskStatus, number>
}

const statusItems: Array<{ status: ReviewTaskStatus; label: string }> = [
  { status: "created", label: "待处理" },
  { status: "checking_environment", label: "环境检查中" },
  { status: "running_codex", label: "运行中" },
  { status: "uploading_report", label: "上传报告中" },
  { status: "success", label: "成功" },
  { status: "failed", label: "失败" },
  { status: "environment_error", label: "环境异常" },
  { status: "cancelled", label: "已取消" },
]

async function readReviewTaskStats(): Promise<ReviewTaskStats> {
  const token = localStorage.getItem("access_token")
  const response = await fetch(`${OpenAPI.BASE}/api/v1/review-tasks/stats`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })

  if (!response.ok) {
    throw new Error("Failed to load review task stats")
  }

  return response.json()
}

function StatCard({
  title,
  value,
  icon: Icon,
}: {
  title: string
  value: number
  icon: typeof ListChecks
}) {
  return (
    <Card className="gap-3 rounded-lg py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-4 pb-0">
        <CardDescription>{title}</CardDescription>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}

function TaskStatusChart({ stats }: { stats: ReviewTaskStats }) {
  const maxCount = Math.max(...statusItems.map((item) => stats.by_status[item.status]), 1)

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle>状态分布</CardTitle>
        <CardDescription>按任务当前状态统计数量</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {statusItems.map((item) => {
            const count = stats.by_status[item.status] ?? 0
            const width = `${Math.max((count / maxCount) * 100, count > 0 ? 8 : 0)}%`

            return (
              <div
                className="grid grid-cols-[6rem_1fr_3rem] items-center gap-3 text-sm"
                key={item.status}
              >
                <div className="truncate text-muted-foreground">
                  {item.label}
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{ width }}
                  />
                </div>
                <div className="text-right font-medium tabular-nums">
                  {count}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export function TaskStatsPanel() {
  const {
    data: stats,
    error,
    isLoading,
  } = useQuery({
    queryFn: readReviewTaskStats,
    queryKey: ["review-task-stats"],
  })

  if (isLoading) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">任务统计</h2>
        <Card className="rounded-lg">
          <CardContent className="py-8 text-muted-foreground">
            正在加载任务统计...
          </CardContent>
        </Card>
      </section>
    )
  }

  if (error || !stats) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">任务统计</h2>
        <Card className="rounded-lg">
          <CardContent className="py-8 text-muted-foreground">
            任务统计加载失败，请稍后重试。
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">任务统计</h2>
        <p className="text-sm text-muted-foreground">
          当前权限范围内的代码审查任务数量。
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="总任务数" value={stats.total} icon={ListChecks} />
        <StatCard title="成功数" value={stats.success} icon={CheckCircle2} />
        <StatCard
          title="失败/异常数"
          value={stats.failed_or_error}
          icon={CircleAlert}
        />
        <StatCard title="运行中数" value={stats.running} icon={Activity} />
      </div>
      <TaskStatusChart stats={stats} />
    </section>
  )
}
```

- [ ] **Step 4: Update home route**

Modify `code_review_server/frontend/src/routes/_layout/index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router"

import { TaskStatsPanel } from "@/components/Home/TaskStatsPanel"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/")({
  component: Home,
  head: () => ({
    meta: [
      {
        title: "主页 - 沛城科技代码审查平台",
      },
    ],
  }),
})

function Home() {
  const { user: currentUser } = useAuth()
  const displayName =
    currentUser?.full_name || currentUser?.svn_username || "用户"

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="max-w-sm truncate text-2xl font-bold tracking-tight">
          你好，{displayName}
        </h1>
        <p className="text-muted-foreground">欢迎回来，很高兴再次见到你。</p>
      </div>
      <TaskStatsPanel />
    </div>
  )
}
```

- [ ] **Step 5: Run home test**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/home.spec.ts --project=chromium
```

Expected: PASS. Home page shows `主页` and task stats content.

- [ ] **Step 6: Run frontend build**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run build
```

Expected: PASS. TypeScript accepts the stats panel.

- [ ] **Step 7: Commit home stats UI**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/components/Home/TaskStatsPanel.tsx code_review_server/frontend/src/routes/_layout/index.tsx code_review_server/frontend/tests/home.spec.ts
git commit -m "feat: add task stats to home page"
```

Expected: Commit contains only home stats component, home route update, and home tests.

---

### Task 5: Final Verification and Cleanup

**Files:**
- No source files are expected to change in this task unless a verification command reports a concrete failure.

- [ ] **Step 1: Run backend review task tests**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -v
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run focused frontend Playwright tests**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run test -- tests/home.spec.ts tests/tasks.spec.ts tests/items.spec.ts tests/admin.spec.ts --project=chromium
```

Expected: PASS.

- [ ] **Step 4: Run format and lint**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
npm run lint
```

Expected: PASS or auto-formats frontend files. If files are modified, inspect them before committing.

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run ruff check app tests
```

Expected: PASS.

- [ ] **Step 5: Check git status**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git status --short
```

Expected: Only intended changes remain. `code_review_server/.env` may still appear as a pre-existing user change and must not be committed unless the user explicitly asks.

---

## Self-Review

- Spec coverage:
  - `仪表盘` to `主页`: Task 2 sidebar and Task 4 home metadata.
  - Normal-user menu: Task 2 sidebar and `tasks.spec.ts`.
  - Admin menu with department management: Task 2 sidebar and `admin.spec.ts`.
  - `/items` admin guard: Task 2 route guard and `items.spec.ts`.
  - Shared task page: Task 2 route and Task 3 component.
  - Normal user own-task-only data: existing backend task list protection remains; Task 1 adds equivalent stats protection.
  - Admin all-task data: existing backend task list protection remains; Task 1 stats admin test covers all-task stats.
  - Home stats chart: Task 4.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency:
  - Backend model is `ReviewTaskStatsPublic`; route response model uses the same name.
  - Frontend query key is `review-task-stats`; delete mutation invalidates that key.
  - Shared page export is `TasksPage`; legacy admin compatibility export is `AdminTasksPage`.
