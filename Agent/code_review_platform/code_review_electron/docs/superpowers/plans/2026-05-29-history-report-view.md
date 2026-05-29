# 历史任务报告查看 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务看板中的历史成功任务可以点击读取服务端 Markdown 报告，并显示到右侧预览区域。

**Architecture:** 复用服务端 `GET /api/v1/review-tasks/{task_id}/report` 文本接口，在 Electron 主进程 `ApiClient -> ipc.ts -> preload -> TaskPage` 增加一条读取报告链路。渲染层由 `TaskBoard` 暴露“查看报告”动作，`TaskPage` 负责加载状态、错误状态和右侧 Markdown 内容更新。

**Tech Stack:** Electron 39、React 19、TypeScript、Vitest。

---

## 文件结构

- 修改 `src/main/api-client.ts`：增加 `readTaskReport(token, taskId)`，读取 text/markdown 响应。
- 修改 `src/main/ipc.ts`：增加 `task:report` IPC handler。
- 修改 `src/preload/index.ts`：暴露 `readTaskReport(taskId)`。
- 修改 `src/renderer/src/code-review-api.ts`：声明 `readTaskReport(taskId)`。
- 修改 `src/renderer/src/components/TaskPage.tsx`：维护选中任务、报告加载状态和错误，并把查看动作传给看板。
- 修改 `src/renderer/src/components/TaskBoard.tsx`：成功任务显示“查看报告”按钮，支持选中态。
- 修改 `src/renderer/src/styles.css`：增加卡片选中态和查看按钮样式。
- 修改 `src/main/__tests__/api-client.test.ts`：覆盖报告文本读取。
- 修改 `src/main/__tests__/ipc.test.ts`：覆盖 `task:report` 已登录与未登录。

---

### Task 1: 主进程报告读取链路

**Files:**
- Modify: `src/main/api-client.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/code-review-api.ts`
- Test: `src/main/__tests__/api-client.test.ts`
- Test: `src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: 写 ApiClient 失败测试**

在 `src/main/__tests__/api-client.test.ts` 增加：

```ts
it('reads a review task report as markdown text', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response('# Review\n\nLooks good.\n', {
      status: 200,
      headers: { 'content-type': 'text/markdown' }
    })
  )
  const client = new ApiClient('https://server.example', fetchMock)

  const result = await client.readTaskReport('token-123', 'task/1')

  expect(result).toBe('# Review\n\nLooks good.\n')
  expect(fetchMock).toHaveBeenCalledWith(
    'https://server.example/api/v1/review-tasks/task%2F1/report',
    {
      method: 'GET',
      headers: {
        authorization: 'Bearer token-123'
      }
    }
  )
})
```

- [ ] **Step 2: 运行 ApiClient 测试确认失败**

Run: `npm test -- src/main/__tests__/api-client.test.ts`

Expected: FAIL，原因是 `readTaskReport` 尚不存在。

- [ ] **Step 3: 实现 ApiClient.readTaskReport**

在 `ApiClient` class 中增加：

```ts
async readTaskReport(token: string, taskId: string): Promise<string> {
  const response = await this.fetchImpl(
    `${this.baseUrl}/api/v1/review-tasks/${encodeURIComponent(taskId)}/report`,
    {
      method: 'GET',
      headers: this.authHeaders(token)
    }
  )

  if (!response.ok) {
    throw new ApiError(response.status, await this.readErrorMessage(response))
  }

  return response.text()
}
```

- [ ] **Step 4: 写 IPC 失败测试**

在 `src/main/__tests__/ipc.test.ts` 更新 channel 列表，加入 `'task:report'`，并增加：

```ts
it('reads a task report for the authenticated user', async () => {
  const api = {
    readTaskReport: vi.fn(async () => '# Report\n')
  }
  const authStore = {
    load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
    save: vi.fn()
  }
  const { registerIpcHandlers } = await import('../ipc')

  registerIpcHandlers({
    api: api as never,
    authStore: authStore as never
  })

  const reportHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:report')?.[1]

  await expect(reportHandler({}, 'task-1')).resolves.toBe('# Report\n')
  expect(api.readTaskReport).toHaveBeenCalledWith('token-123', 'task-1')
})

it('rejects task report reads when unauthenticated', async () => {
  const api = {
    readTaskReport: vi.fn()
  }
  const authStore = {
    load: vi.fn(async () => null),
    save: vi.fn()
  }
  const { registerIpcHandlers } = await import('../ipc')

  registerIpcHandlers({
    api: api as never,
    authStore: authStore as never
  })

  const reportHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:report')?.[1]

  await expect(reportHandler({}, 'task-1')).rejects.toThrow('Not authenticated')
  expect(api.readTaskReport).not.toHaveBeenCalled()
})
```

- [ ] **Step 5: 实现 IPC/preload/renderer 类型**

在 `src/main/ipc.ts` 中增加：

```ts
ipcMain.handle('task:report', async (_event, taskId: string): Promise<string> => {
  const tokens = await authStore.load()

  if (!tokens) {
    throw new Error('Not authenticated')
  }

  const taskApi = await createApiClient()
  return taskApi.readTaskReport(tokens.access_token, taskId)
})
```

在 `src/preload/index.ts` 增加：

```ts
readTaskReport: (taskId: string): Promise<string> => ipcRenderer.invoke('task:report', taskId),
```

在 `src/renderer/src/code-review-api.ts` 增加：

```ts
readTaskReport(taskId: string): Promise<string>
```

- [ ] **Step 6: 运行主进程相关测试**

Run: `npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts`

Expected: PASS。

---

### Task 2: 任务看板查看报告交互

**Files:**
- Modify: `src/renderer/src/components/TaskBoard.tsx`
- Modify: `src/renderer/src/components/TaskPage.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: 扩展 TaskBoard props 和按钮**

在 `TaskBoardProps` 增加：

```ts
selectedTaskId?: string
loadingReportTaskId?: string
onViewReport?: (task: ReviewTask) => void
```

任务卡片增加选中态：

```tsx
<article
  className={`task-card${task.id === selectedTaskId ? ' is-selected' : ''}`}
  key={task.id}
>
```

在任务元信息后增加按钮：

```tsx
{task.status === 'success' && (
  <button
    className="task-action-button"
    type="button"
    disabled={loadingReportTaskId === task.id}
    onClick={() => onViewReport?.(task)}
  >
    {loadingReportTaskId === task.id ? '加载中...' : '查看报告'}
  </button>
)}
```

- [ ] **Step 2: TaskPage 增加报告读取 handler**

新增状态：

```ts
const [selectedTaskId, setSelectedTaskId] = useState<string>()
const [loadingReportTaskId, setLoadingReportTaskId] = useState<string>()
```

新增 handler：

```ts
const handleViewReport = async (task: ReviewTask): Promise<void> => {
  setError('')
  setReportMessage('')
  setSelectedTaskId(task.id)
  setLoadingReportTaskId(task.id)

  try {
    const reportMarkdown = await window.codeReview.readTaskReport(task.id)
    setMarkdown(reportMarkdown)
  } catch (reportError) {
    setError(reportError instanceof Error ? reportError.message : '历史报告加载失败。')
  } finally {
    setLoadingReportTaskId(undefined)
  }
}
```

传给看板：

```tsx
<TaskBoard
  tasks={tasks}
  isLoading={isLoadingTasks}
  selectedTaskId={selectedTaskId}
  loadingReportTaskId={loadingReportTaskId}
  onViewReport={(task) => void handleViewReport(task)}
/>
```

新建任务成功时同步选中：

```ts
setSelectedTaskId(result.taskId)
```

- [ ] **Step 3: 增加 CSS**

在 `src/renderer/src/styles.css` 增加：

```css
.task-card.is-selected {
  border-color: rgb(18 185 120 / 56%);
  box-shadow: inset 0 0 0 1px rgb(18 185 120 / 22%);
}

.task-action-button {
  justify-self: start;
  min-height: 30px;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 7px;
  padding: 0 11px;
  color: #f5f7fb;
  background: rgb(255 255 255 / 8%);
  font-size: 12px;
  font-weight: 800;
}

.task-action-button:hover:not(:disabled) {
  border-color: rgb(18 185 120 / 44%);
  background: rgb(18 185 120 / 18%);
}
```

- [ ] **Step 4: 运行类型检查**

Run: `npm run typecheck`

Expected: PASS。

---

### Task 3: 全量验证与提交

**Files:**
- Verify all modified files.

- [ ] **Step 1: 运行测试**

Run: `npm test`

Expected: PASS。

- [ ] **Step 2: 运行类型检查**

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 3: 检查差异范围**

Run: `git diff -- src/main/api-client.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/code-review-api.ts src/renderer/src/components/TaskPage.tsx src/renderer/src/components/TaskBoard.tsx src/renderer/src/styles.css src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts docs/superpowers/plans/2026-05-29-history-report-view.md`

Expected: 差异只包含历史任务报告查看链路和按钮样式。

- [ ] **Step 4: 提交**

Run:

```bash
git add src/main/api-client.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/code-review-api.ts src/renderer/src/components/TaskPage.tsx src/renderer/src/components/TaskBoard.tsx src/renderer/src/styles.css src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts docs/superpowers/plans/2026-05-29-history-report-view.md
git commit -m "feat: view historical task reports"
```

Expected: 提交成功。

---

## 自检结果

- Spec coverage: 覆盖历史任务查看报告、加载状态、错误反馈、选中态、API/IPC 测试。
- Placeholder scan: 无 `TBD`、`TODO`、`待定` 或未落地步骤。
- Type consistency: 报告读取方法统一命名为 `readTaskReport(taskId)`，IPC channel 统一为 `task:report`。
