# 客户端任务持久化与工作台 UI 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Electron 客户端登录后从服务端恢复当前账号任务，并优化纯黑工作台、Markdown 表格预览和任务看板稳定高度。

**Architecture:** 任务列表以服务端 `GET /api/v1/review-tasks` 为准，通过 `ApiClient -> ipc.ts -> preload -> TaskPage` 单向加载到渲染层。Markdown 保持本地轻量渲染器，扩展 pipe table 解析并用 CSS 管理宽表滚动。视觉优化集中在 `TaskPage`、`TaskBoard`、`MarkdownPreview` 和 `styles.css`，不引入新的 UI 库。

**Tech Stack:** Electron 39、electron-vite、React 19、TypeScript、Vitest、CSS。

---

## 文件结构

- 修改 `src/shared/types.ts`：复用并扩展 `ReviewTask`，让渲染层和主进程共享任务列表类型。
- 修改 `src/main/api-client.ts`：新增 `ReviewTasksResponse` 和 `listTasks(token)`。
- 修改 `src/main/ipc.ts`：新增 `task:list` IPC handler。
- 修改 `src/preload/index.ts`：暴露 `listTasks()` 到渲染层。
- 修改 `src/renderer/src/code-review-api.ts`：声明 `listTasks()` 返回类型。
- 修改 `src/renderer/src/components/TaskPage.tsx`：初始化加载服务端任务，处理加载错误，保持新建任务的 pending 体验。
- 修改 `src/renderer/src/components/TaskBoard.tsx`：增加稳定卡片结构，长日志固定区域。
- 修改 `src/renderer/src/components/MarkdownPreview.tsx`：增加报告滚动容器类名。
- 修改 `src/renderer/src/markdown.ts`：扩展表格解析。
- 修改 `src/renderer/src/styles.css`：纯黑背景、固定布局、Markdown 表格、看板稳定高度。
- 修改 `src/main/__tests__/api-client.test.ts`：覆盖任务列表请求。
- 修改 `src/main/__tests__/ipc.test.ts`：覆盖 `task:list` 已登录与未登录。
- 修改 `src/renderer/src/markdown.test.ts`：覆盖 Markdown 表格渲染和转义。

---

### Task 1: 服务端任务列表 API 与 IPC

**Files:**
- Modify: `src/main/api-client.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/code-review-api.ts`
- Modify: `src/main/__tests__/api-client.test.ts`
- Modify: `src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: 为 ApiClient 写失败测试**

在 `src/main/__tests__/api-client.test.ts` 增加测试：

```ts
it('lists review tasks with authorization header', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      data: [
        {
          id: 'task-1',
          svn_url: 'svn://repo/project',
          old_revision: '12',
          new_revision: '14',
          status: 'success',
          report_path: '/reports/task-1.md'
        }
      ],
      count: 1
    })
  )
  const client = new ApiClient('https://server.example', fetchMock)

  const result = await client.listTasks('token-123')

  expect(result.data).toHaveLength(1)
  expect(result.data[0]).toMatchObject({
    id: 'task-1',
    status: 'success'
  })
  expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/review-tasks', {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer token-123'
    }
  })
})
```

- [ ] **Step 2: 运行 ApiClient 单测确认失败**

Run: `npm test -- src/main/__tests__/api-client.test.ts`

Expected: FAIL，错误包含 `client.listTasks is not a function` 或类型检查失败。

- [ ] **Step 3: 实现 ApiClient.listTasks**

在 `src/main/api-client.ts` 中导入共享类型并增加响应类型与方法：

```ts
import type { ReviewTask } from '../shared/types'

export interface ReviewTasksResponse {
  data: ReviewTask[]
  count: number
}

listTasks(token: string): Promise<ReviewTasksResponse> {
  return this.request<ReviewTasksResponse>('/api/v1/review-tasks', {
    method: 'GET',
    headers: this.authHeaders(token)
  })
}
```

- [ ] **Step 4: 为 IPC 写失败测试**

在 `src/main/__tests__/ipc.test.ts` 中更新 channel 列表，加入 `'task:list'`，并增加两个测试：

```ts
it('lists tasks for the authenticated user', async () => {
  const api = {
    listTasks: vi.fn(async () => ({
      data: [
        {
          id: 'task-1',
          svn_url: 'svn://repo/project',
          old_revision: '1',
          new_revision: '2',
          status: 'success'
        }
      ],
      count: 1
    }))
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

  const listHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:list')?.[1]

  await expect(listHandler()).resolves.toEqual({
    data: [
      {
        id: 'task-1',
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        status: 'success'
      }
    ],
    count: 1
  })
  expect(api.listTasks).toHaveBeenCalledWith('token-123')
})

it('rejects task listing when unauthenticated', async () => {
  const api = {
    listTasks: vi.fn()
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

  const listHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:list')?.[1]

  await expect(listHandler()).rejects.toThrow('Not authenticated')
  expect(api.listTasks).not.toHaveBeenCalled()
})
```

- [ ] **Step 5: 实现 task:list IPC 和 preload API**

在 `src/main/ipc.ts` 的 `TaskAgentApi` 兼容对象之外，使用 `createApiClient()` 和 `authStore.load()` 注册：

```ts
ipcMain.handle('task:list', async () => {
  const tokens = await authStore.load()

  if (!tokens) {
    throw new Error('Not authenticated')
  }

  const taskApi = await createApiClient()
  return taskApi.listTasks(tokens.access_token)
})
```

在 `src/preload/index.ts` 暴露：

```ts
listTasks: (): Promise<ReviewTasksResponse> => ipcRenderer.invoke('task:list'),
```

在 `src/renderer/src/code-review-api.ts` 增加：

```ts
import type { EnvironmentStatus, ReviewTask, ReviewTaskStatus, TaskProgressEvent } from '../../shared/types'

export interface ReviewTasksResponse {
  data: ReviewTask[]
  count: number
}

listTasks(): Promise<ReviewTasksResponse>
```

- [ ] **Step 6: 运行任务列表相关测试**

Run: `npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts`

Expected: PASS。

---

### Task 2: 渲染层加载服务端历史任务

**Files:**
- Modify: `src/renderer/src/components/TaskPage.tsx`
- Modify: `src/renderer/src/components/TaskBoard.tsx`

- [ ] **Step 1: 在 TaskPage 增加初始化加载逻辑**

在 `TaskPage` 中增加加载状态：

```ts
const [isLoadingTasks, setIsLoadingTasks] = useState(true)
```

增加 `useEffect`：

```ts
useEffect(() => {
  let isMounted = true

  const loadTasks = async (): Promise<void> => {
    setIsLoadingTasks(true)
    setError('')

    try {
      const response = await window.codeReview.listTasks()
      if (isMounted) {
        setTasks(response.data)
      }
    } catch (loadError) {
      if (isMounted) {
        setError(loadError instanceof Error ? loadError.message : '任务列表加载失败。')
      }
    } finally {
      if (isMounted) {
        setIsLoadingTasks(false)
      }
    }
  }

  void loadTasks()

  return () => {
    isMounted = false
  }
}, [])
```

- [ ] **Step 2: 新建任务完成后刷新或合并真实任务**

保留 pending 卡片，执行成功后用返回结果替换。成功后不强制清空服务端历史，只更新目标任务：

```ts
setTasks((current) =>
  current.map((task) =>
    task.id === pendingTask.id
      ? {
          ...task,
          id: result.taskId,
          status: result.status,
          report_path: result.reportPath,
          progress_message: result.status === 'success' ? '审查完成' : task.progress_message
        }
      : task
  )
)
```

如果当前已有真实任务 ID，则使用去重合并函数：

```ts
const mergeTasks = (current: ReviewTask[], incoming: ReviewTask[]): ReviewTask[] => {
  const existingIds = new Set(current.map((task) => task.id))
  return [...current, ...incoming.filter((task) => !existingIds.has(task.id))]
}
```

- [ ] **Step 3: TaskBoard 支持加载文案**

给 `TaskBoard` 增加 props：

```ts
type TaskBoardProps = {
  tasks: ReviewTask[]
  isLoading?: boolean
}
```

空状态前先判断：

```tsx
if (isLoading) {
  return <p className="empty-state">正在加载历史任务...</p>
}
```

`TaskPage` 调用：

```tsx
<TaskBoard tasks={tasks} isLoading={isLoadingTasks} />
```

- [ ] **Step 4: 运行类型检查**

Run: `npm run typecheck`

Expected: PASS。若出现 `window.codeReview.listTasks` 类型错误，检查 `code-review-api.ts` 和 `preload/index.ts` 类型声明是否一致。

---

### Task 3: Markdown 表格渲染

**Files:**
- Modify: `src/renderer/src/markdown.ts`
- Modify: `src/renderer/src/markdown.test.ts`

- [ ] **Step 1: 写表格渲染失败测试**

在 `src/renderer/src/markdown.test.ts` 增加：

```ts
it('renders pipe tables with escaped cell content', () => {
  expect(
    renderMarkdown('| 版本号 | 提交者 | 说明 |\n| --- | --- | --- |\n| r1 | Ada | 修复 `SOC` <bug> |')
  ).toBe(
    '<table><thead><tr><th>版本号</th><th>提交者</th><th>说明</th></tr></thead><tbody><tr><td>r1</td><td>Ada</td><td>修复 <code>SOC</code> &lt;bug&gt;</td></tr></tbody></table>'
  )
})

it('keeps incomplete table syntax as paragraphs', () => {
  expect(renderMarkdown('| 版本号 | 提交者 |\n| r1 | Ada |')).toBe(
    '<p>| 版本号 | 提交者 |</p><p>| r1 | Ada |</p>'
  )
})
```

- [ ] **Step 2: 运行 Markdown 测试确认失败**

Run: `npm test -- src/renderer/src/markdown.test.ts`

Expected: FAIL，表格仍被渲染为段落。

- [ ] **Step 3: 实现 pipe table 解析**

在 `src/renderer/src/markdown.ts` 增加工具函数：

```ts
const parseTableRow = (line: string): string[] | null => {
  const trimmed = line.trim()

  if (!trimmed.includes('|')) {
    return null
  }

  const normalized = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutTrailing = normalized.endsWith('|') ? normalized.slice(0, -1) : normalized
  const cells = withoutTrailing.split('|').map((cell) => cell.trim())

  return cells.length > 1 ? cells : null
}

const isTableDivider = (line: string): boolean => {
  const cells = parseTableRow(line)
  return Boolean(cells?.every((cell) => /^:?-{3,}:?$/.test(cell)))
}

const renderTable = (header: string[], rows: string[][]): string => {
  const head = `<thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`
  const bodyRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
    .join('')

  return `<table>${head}<tbody>${bodyRows}</tbody></table>`
}
```

将 `for...of` 改为 index 循环，在段落判断前识别表格：

```ts
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index]
  const trimmed = line.trim()
  const tableHeader = parseTableRow(trimmed)

  if (
    tableHeader &&
    index + 1 < lines.length &&
    isTableDivider(lines[index + 1])
  ) {
    const rows: string[][] = []
    index += 2

    while (index < lines.length) {
      const row = parseTableRow(lines[index])
      if (!row || row.length !== tableHeader.length) {
        index -= 1
        break
      }
      rows.push(row)
      index += 1
    }

    closeList()
    html.push(renderTable(tableHeader, rows))
    continue
  }
}
```

- [ ] **Step 4: 运行 Markdown 测试**

Run: `npm test -- src/renderer/src/markdown.test.ts`

Expected: PASS。

---

### Task 4: 纯黑工作台、报告内部滚动和任务卡片稳定布局

**Files:**
- Modify: `src/renderer/src/components/MarkdownPreview.tsx`
- Modify: `src/renderer/src/components/TaskBoard.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: 调整 MarkdownPreview 结构**

将空状态和正文都包在固定滚动区域：

```tsx
export function MarkdownPreview({ markdown }: MarkdownPreviewProps): React.JSX.Element {
  if (!markdown.trim()) {
    return (
      <div className="preview-scroll">
        <div className="preview-empty">审查完成后，Markdown 报告会显示在这里。</div>
      </div>
    )
  }

  return (
    <div className="preview-scroll">
      <article
        className="markdown-preview"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
      />
    </div>
  )
}
```

- [ ] **Step 2: 调整 TaskBoard 卡片结构**

为 SVN 地址、进度、日志增加更明确类名：

```tsx
<p className="task-url">{task.svn_url}</p>
{task.progress_message && <p className="task-progress">{task.progress_message}</p>}
{task.codex_log && task.codex_log.length > 0 && (
  <div className="task-log" aria-label="Codex 执行输出">
    {task.codex_log.slice(-4).map((event, index) => (
      <pre className={`task-log-line task-log-${event.type}`} key={`${task.id}-${index}`}>
        {event.message.trimEnd()}
      </pre>
    ))}
  </div>
)}
```

- [ ] **Step 3: 更新 CSS 为纯黑稳定布局**

在 `src/renderer/src/styles.css` 中完成这些具体变化：

```css
.app-shell {
  position: relative;
  overflow: hidden;
  min-height: 100vh;
  padding: 24px;
  background: #000000;
}

.app-shell::before {
  display: none;
}

.auth-card,
.panel,
.environment-box,
.right-pane {
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 8px;
  color: #f5f7fb;
  background: #111418;
  box-shadow: none;
  backdrop-filter: none;
}

.review-workspace {
  height: calc(100vh - 48px);
  grid-template-columns: minmax(360px, 430px) minmax(0, 1fr);
}

.left-pane {
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.right-pane {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.preview-scroll {
  min-height: 0;
  overflow: auto;
  padding: 22px;
}

.markdown-preview {
  max-width: 1040px;
  min-width: 0;
  color: rgb(245 247 251 / 88%);
  line-height: 1.7;
}

.markdown-preview table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
  margin: 0 0 18px;
  font-size: 14px;
}

.markdown-preview th,
.markdown-preview td {
  border: 1px solid rgb(255 255 255 / 14%);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}

.markdown-preview th {
  color: #ffffff;
  background: rgb(255 255 255 / 10%);
}

.markdown-preview tr:nth-child(even) td {
  background: rgb(255 255 255 / 4%);
}

.task-list {
  display: grid;
  gap: 12px;
  max-height: 460px;
  overflow: auto;
}

.task-card {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  min-height: 250px;
  max-height: 320px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 8px;
  padding: 13px;
  background: #0b0f13;
}

.task-url,
.task-progress,
.task-error {
  overflow-wrap: anywhere;
}

.task-log {
  min-height: 88px;
  max-height: 118px;
  overflow: auto;
}
```

- [ ] **Step 4: 运行类型检查**

Run: `npm run typecheck`

Expected: PASS。

---

### Task 5: 全量验证与整理

**Files:**
- Verify all modified files.

- [ ] **Step 1: 运行全量测试**

Run: `npm test`

Expected: PASS。

- [ ] **Step 2: 运行类型检查**

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 3: 检查工作区差异**

Run: `git diff -- src/main/api-client.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/code-review-api.ts src/renderer/src/components/TaskPage.tsx src/renderer/src/components/TaskBoard.tsx src/renderer/src/components/MarkdownPreview.tsx src/renderer/src/markdown.ts src/renderer/src/styles.css`

Expected: 差异只包含任务列表加载、Markdown 表格和 UI 稳定布局，不包含无关重构。

- [ ] **Step 4: 提交实现**

Run:

```bash
git add src/main/api-client.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/code-review-api.ts src/renderer/src/components/TaskPage.tsx src/renderer/src/components/TaskBoard.tsx src/renderer/src/components/MarkdownPreview.tsx src/renderer/src/markdown.ts src/renderer/src/styles.css src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts src/renderer/src/markdown.test.ts docs/superpowers/plans/2026-05-29-client-task-persistence-ui.md
git commit -m "feat: persist client tasks from server"
```

Expected: 提交成功。

---

## 自检结果

- Spec coverage: 覆盖服务端任务恢复、纯黑背景、Markdown 表格、报告内部滚动、任务卡片稳定高度、相关测试与验证。
- Placeholder scan: 无 `TBD`、`TODO`、`待定` 或未落地步骤。
- Type consistency: `ReviewTask` 复用共享类型，`ReviewTasksResponse` 在主进程和渲染层保持 `{ data, count }` 结构，IPC channel 统一为 `task:list`。
