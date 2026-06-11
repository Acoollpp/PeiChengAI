# 任务时间与状态展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Electron 客户端任务看板和 Web 代码审查任务管理页展示任务开始时间、结束时间，并把 Web 状态列改为中文彩色状态徽标。

**Architecture:** 复用后端已有 `started_at` 和 `finished_at` 字段，不新增数据库迁移。Electron 补齐共享类型并在任务卡片渲染时间；Web 前端复用生成客户端类型，新增一个任务展示辅助模块承载状态文案、徽标和时间格式化。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Playwright、shadcn/ui Badge、FastAPI 生成客户端类型。

---

## 文件结构

- Modify: `code_review_electron/src/shared/types.ts`
  - 职责：补齐 Electron 共享 `ReviewTask` 类型的 `started_at`、`finished_at` 字段。
- Modify: `code_review_electron/src/renderer/src/components/TaskBoard.tsx`
  - 职责：格式化任务时间，并在任务卡片元信息区展示开始时间和结束时间。
- Modify: `code_review_electron/src/renderer/src/components/TaskBoard.test.tsx`
  - 职责：覆盖时间展示、空值展示和运行中未结束任务展示。
- Create: `code_review_server/frontend/src/components/Tasks/task-display.tsx`
  - 职责：集中维护 Web 任务状态中文文案、Badge 样式、时间格式化函数。
- Modify: `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`
  - 职责：使用生成客户端类型、接入状态徽标、增加开始时间和结束时间列。
- Modify: `code_review_server/frontend/tests/tasks.spec.ts`
  - 职责：用 Playwright 覆盖 Web 管理页状态徽标和时间列展示。

## Task 1: Electron 任务类型与卡片时间展示

**Files:**
- Modify: `code_review_electron/src/shared/types.ts`
- Modify: `code_review_electron/src/renderer/src/components/TaskBoard.tsx`
- Test: `code_review_electron/src/renderer/src/components/TaskBoard.test.tsx`

- [ ] **Step 1: 写失败测试，覆盖已开始且已结束任务**

在 `code_review_electron/src/renderer/src/components/TaskBoard.test.tsx` 的 `describe('TaskBoard', () => {` 内新增测试：

```tsx
  it('任务卡片显示开始时间和结束时间', () => {
    const startedAt = '2026-06-11T14:03:20'
    const finishedAt = '2026-06-11T14:15:01'
    const taskWithTimes: TaskViewItem = {
      ...runningTasks[0],
      started_at: startedAt,
      finished_at: finishedAt
    }

    renderTaskBoard({ runningTasks: [taskWithTimes], queuedTasks: [], historyTasks: [] })

    expect(screen.getByText('开始时间')).toBeInTheDocument()
    expect(screen.getByText('结束时间')).toBeInTheDocument()
    expect(screen.getByText('2026-06-11 14:03:20')).toBeInTheDocument()
    expect(screen.getByText('2026-06-11 14:15:01')).toBeInTheDocument()
  })
```

- [ ] **Step 2: 写失败测试，覆盖空时间和运行中未结束任务**

继续在同一个 `describe` 内新增测试：

```tsx
  it('任务时间为空时显示占位符', async () => {
    const user = userEvent.setup()
    renderTaskBoard()

    await user.click(screen.getByRole('tab', { name: '等待中 1' }))

    const waitingPanel = screen.getByRole('tabpanel', { name: '等待中' })
    expect(within(waitingPanel).getByText('开始时间')).toBeInTheDocument()
    expect(within(waitingPanel).getByText('结束时间')).toBeInTheDocument()
    expect(within(waitingPanel).getAllByText('-')).toHaveLength(2)
  })

  it('运行中任务只有开始时间时结束时间显示占位符', () => {
    const taskWithStartOnly: TaskViewItem = {
      ...runningTasks[0],
      started_at: '2026-06-11T14:03:20',
      finished_at: null
    }

    renderTaskBoard({ runningTasks: [taskWithStartOnly], queuedTasks: [], historyTasks: [] })

    const runningPanel = screen.getByRole('tabpanel', { name: '运行中' })
    expect(within(runningPanel).getByText('2026-06-11 14:03:20')).toBeInTheDocument()
    expect(within(runningPanel).getByText('-')).toBeInTheDocument()
  })
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- TaskBoard.test.tsx
```

Expected: FAIL，失败原因包含找不到“开始时间”或 `started_at` 类型不存在。

- [ ] **Step 4: 补齐 Electron 共享类型**

在 `code_review_electron/src/shared/types.ts` 的 `ReviewTask` 接口中，`report_path?: string` 后加入：

```ts
  started_at?: string | null
  finished_at?: string | null
```

修改后的相关片段应为：

```ts
export interface ReviewTask {
  id: string
  svn_url: string
  old_revision: string
  new_revision: string
  template_key?: ReviewTemplateKey
  skill_name?: string
  status: ReviewTaskStatus
  report_path?: string
  started_at?: string | null
  finished_at?: string | null
  error_message?: string
  progress_message?: string
  codex_log?: TaskProgressEvent[]
}
```

- [ ] **Step 5: 在 TaskBoard 中新增时间格式化函数**

在 `code_review_electron/src/renderer/src/components/TaskBoard.tsx` 中，`statusText` 定义之后加入：

```tsx
function formatTaskDateTime(value?: string | null): string {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  const pad = (part: number) => String(part).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
```

- [ ] **Step 6: 在任务卡片元信息中展示开始时间和结束时间**

在 `TaskCard` 的 `<dl className="task-meta">` 内，保留旧版本和新版本两个 `<div>`，在它们后面加入：

```tsx
        <div>
          <dt>开始时间</dt>
          <dd>{formatTaskDateTime(task.started_at)}</dd>
        </div>
        <div>
          <dt>结束时间</dt>
          <dd>{formatTaskDateTime(task.finished_at)}</dd>
        </div>
```

修改后 `dl` 结构应包含四项：旧版本、新版本、开始时间、结束时间。

- [ ] **Step 7: 运行 Electron 组件测试确认通过**

Run:

```bash
cd code_review_electron
npm test -- TaskBoard.test.tsx
```

Expected: PASS，`TaskBoard.test.tsx` 全部通过。

- [ ] **Step 8: 提交 Electron 卡片展示改动**

Run:

```bash
git add code_review_electron/src/shared/types.ts \
  code_review_electron/src/renderer/src/components/TaskBoard.tsx \
  code_review_electron/src/renderer/src/components/TaskBoard.test.tsx
git commit -m "展示客户端任务开始和结束时间"
```

Expected: 只提交上述三个文件。不要提交 `code_review_electron/package.json`、`code_review_electron/package-lock.json`，除非它们确实是本任务产生的改动。

## Task 2: Web 任务状态和时间展示辅助模块

**Files:**
- Create: `code_review_server/frontend/src/components/Tasks/task-display.tsx`
- Modify: `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`
- Test: `code_review_server/frontend/tests/tasks.spec.ts`

- [ ] **Step 1: 写失败 E2E 测试，覆盖状态中文文案和时间列**

在 `code_review_server/frontend/tests/tasks.spec.ts` 的 `Admin task navigation` describe 内新增测试：

```ts
  test("Admin task table shows status badge and task times", async ({
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
              status: "running_codex",
              report_path: null,
              error_message: null,
              client_hostname: null,
              client_version: null,
              started_at: "2026-06-11T14:03:20",
              finished_at: null,
            },
          ],
          count: 1,
        },
      })
    })

    await page.goto("/tasks/review")

    await expect(
      page.getByRole("columnheader", { name: "开始时间" }),
    ).toBeVisible()
    await expect(
      page.getByRole("columnheader", { name: "结束时间" }),
    ).toBeVisible()
    await expect(page.getByText("审查中")).toBeVisible()
    await expect(page.getByText("2026-06-11 14:03:20")).toBeVisible()

    const taskRow = page.getByRole("row").filter({ hasText: "测试用户" })
    await expect(taskRow.getByText("-").first()).toBeVisible()
  })
```

- [ ] **Step 2: 更新现有错误信息 E2E 测试数据和断言**

在同文件现有 `Admin task table shows error message instead of client details` 测试的 mock 数据中加入时间字段：

```ts
              started_at: "2026-06-11T13:40:00",
              finished_at: "2026-06-11T13:52:30",
```

并在该测试末尾新增断言：

```ts
    await expect(page.getByText("失败")).toBeVisible()
    await expect(page.getByText("2026-06-11 13:40:00")).toBeVisible()
    await expect(page.getByText("2026-06-11 13:52:30")).toBeVisible()
```

- [ ] **Step 3: 运行 Playwright 任务页测试确认失败**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/tasks.spec.ts --project=chromium
```

Expected: FAIL，失败原因包含找不到“开始时间”“结束时间”或“审查中”。该命令需要本地后端和测试环境变量可用；如果环境未启动，记录阻塞原因，不要跳过后续实现。

- [ ] **Step 4: 新建 Web 展示辅助模块**

创建 `code_review_server/frontend/src/components/Tasks/task-display.tsx`：

```tsx
import type { ReviewTaskStatus } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type DisplayableReviewTaskStatus =
  | ReviewTaskStatus
  | (string & Record<never, never>)

const reviewTaskStatusLabels: Record<ReviewTaskStatus, string> = {
  created: "已创建",
  checking_environment: "检查环境",
  running_codex: "审查中",
  uploading_report: "上传报告",
  success: "已完成",
  failed: "失败",
  environment_error: "环境异常",
  cancelled: "已取消",
}

function isKnownReviewTaskStatus(
  status: DisplayableReviewTaskStatus,
): status is ReviewTaskStatus {
  return status in reviewTaskStatusLabels
}

export function formatReviewTaskDateTime(value?: string | null) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  const pad = (part: number) => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function reviewTaskStatusLabel(status: DisplayableReviewTaskStatus) {
  return isKnownReviewTaskStatus(status)
    ? reviewTaskStatusLabels[status]
    : status
}

export function ReviewTaskStatusBadge({
  status,
}: {
  status: DisplayableReviewTaskStatus
}) {
  const knownStatus = isKnownReviewTaskStatus(status) ? status : undefined

  return (
    <Badge
      variant={knownStatus ? "secondary" : "outline"}
      className={cn(
        knownStatus === "success" &&
          "border-green-200 bg-green-50 text-green-700",
        (knownStatus === "failed" || knownStatus === "environment_error") &&
          "border-red-200 bg-red-50 text-red-700",
        (knownStatus === "checking_environment" ||
          knownStatus === "running_codex" ||
          knownStatus === "uploading_report") &&
          "border-blue-200 bg-blue-50 text-blue-700",
        (knownStatus === "created" || knownStatus === "cancelled") &&
          "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {reviewTaskStatusLabel(status)}
    </Badge>
  )
}
```

- [ ] **Step 5: 运行前端类型检查确认辅助模块可编译**

Run:

```bash
cd code_review_server/frontend
bunx tsc -p tsconfig.build.json --noEmit
```

Expected: PASS。如果失败，修正 import、类型或未使用变量问题。

## Task 3: Web 任务管理表格接入状态徽标和时间列

**Files:**
- Modify: `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`
- Test: `code_review_server/frontend/tests/tasks.spec.ts`

- [ ] **Step 1: 更新 TasksPage 类型导入**

在 `code_review_server/frontend/src/components/Tasks/TasksPage.tsx` 中，将客户端 import 从：

```ts
import { OpenAPI } from "@/client"
```

改为：

```ts
import { OpenAPI, type ReviewTaskPublic, type ReviewTaskStatus } from "@/client"
```

新增任务展示辅助 import：

```ts
import {
  formatReviewTaskDateTime,
  ReviewTaskStatusBadge,
  type DisplayableReviewTaskStatus,
} from "@/components/Tasks/task-display"
```

- [ ] **Step 2: 用生成类型替换本地手写任务类型**

将当前 `type ReviewTask = { ... }` 替换为：

```ts
type ReviewTask = Omit<ReviewTaskPublic, "status"> & {
  status: ReviewTaskStatus | DisplayableReviewTaskStatus
}
```

保留 `ReviewTasksResponse`：

```ts
type ReviewTasksResponse = {
  data: ReviewTask[]
  count: number
}
```

- [ ] **Step 3: 更新表头和空状态列数**

在表头中，将：

```tsx
            <TableHead>状态</TableHead>
            <TableHead>错误信息</TableHead>
```

改为：

```tsx
            <TableHead>状态</TableHead>
            <TableHead>开始时间</TableHead>
            <TableHead>结束时间</TableHead>
            <TableHead>错误信息</TableHead>
```

将空状态 `TableCell` 的 `colSpan={8}` 改为：

```tsx
                colSpan={10}
```

- [ ] **Step 4: 更新状态单元格和新增时间单元格**

将任务行中的状态单元格：

```tsx
                <TableCell>{task.status}</TableCell>
```

替换为：

```tsx
                <TableCell>
                  <ReviewTaskStatusBadge status={task.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatReviewTaskDateTime(task.started_at)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatReviewTaskDateTime(task.finished_at)}
                </TableCell>
```

- [ ] **Step 5: 运行前端类型检查**

Run:

```bash
cd code_review_server/frontend
bunx tsc -p tsconfig.build.json --noEmit
```

Expected: PASS。

- [ ] **Step 6: 运行任务页 Playwright 测试确认通过**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/tasks.spec.ts --project=chromium
```

Expected: PASS。如果失败是因为后端或测试账号环境不可用，记录完整错误；如果失败来自页面断言，修正实现或测试。

- [ ] **Step 7: 提交 Web 表格展示改动**

Run:

```bash
git add code_review_server/frontend/src/components/Tasks/task-display.tsx \
  code_review_server/frontend/src/components/Tasks/TasksPage.tsx \
  code_review_server/frontend/tests/tasks.spec.ts
git commit -m "优化任务管理状态和时间展示"
```

Expected: 只提交 Web 展示和测试相关文件。

## Task 4: 回归验证 Electron 队列与 Web 管理页

**Files:**
- No code changes expected.

- [ ] **Step 1: 运行 Electron 类型检查**

Run:

```bash
cd code_review_electron
npm run typecheck
```

Expected: PASS。

- [ ] **Step 2: 运行 Electron 测试**

Run:

```bash
cd code_review_electron
npm test
```

Expected: PASS。

- [ ] **Step 3: 运行 Web 前端类型检查**

Run:

```bash
cd code_review_server/frontend
bunx tsc -p tsconfig.build.json --noEmit
```

Expected: PASS。

- [ ] **Step 4: 运行 Web 任务页 E2E**

Run:

```bash
cd code_review_server/frontend
bunx playwright test tests/tasks.spec.ts --project=chromium
```

Expected: PASS，任务管理页导航、错误信息列、状态徽标、开始时间、结束时间均通过。

- [ ] **Step 5: 检查 git 工作区**

Run:

```bash
git status --short
```

Expected: 只剩用户既有改动或本地临时目录。若存在本任务未提交文件，检查是否应提交。

## Task 5: 收尾说明与可视化临时文件处理

**Files:**
- No business code changes expected.

- [ ] **Step 1: 确认 `.superpowers/` 没有被提交**

Run:

```bash
git status --short .superpowers
```

Expected: `.superpowers/` 仍为未跟踪临时目录，且未出现在任何提交中。

- [ ] **Step 2: 汇总本次提交**

Run:

```bash
git log --oneline -3
```

Expected: 能看到设计文档提交，以及两个实现提交：

```text
<hash> 优化任务管理状态和时间展示
<hash> 展示客户端任务开始和结束时间
091239f 新增任务时间与状态展示设计
```

- [ ] **Step 3: 给用户提交结果摘要**

最终回复包含：

```text
已完成任务时间与状态展示实现。

主要变更：
- Electron 任务卡片显示开始时间和结束时间。
- Web 代码审查任务管理表格显示开始时间和结束时间。
- Web 状态列改为中文彩色徽标。

验证：
- cd code_review_electron && npm run typecheck
- cd code_review_electron && npm test
- cd code_review_server/frontend && bunx tsc -p tsconfig.build.json --noEmit
- cd code_review_server/frontend && bunx playwright test tests/tasks.spec.ts --project=chromium
```

如果某个验证因本地后端、测试账号或浏览器依赖不可用而无法运行，最终回复必须明确写出未运行成功的命令和错误原因。
