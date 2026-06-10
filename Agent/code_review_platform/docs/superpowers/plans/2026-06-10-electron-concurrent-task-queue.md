# Electron 并发任务队列实现计划

> **给执行代理：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。所有步骤使用 checkbox（`- [ ]`）语法跟踪。

**Goal:** Electron 客户端支持最多 2 个代码审查任务同步执行，超出任务本地排队，同时保留现有任务看板和报告查看能力。

**Architecture:** 并发调度放在 Electron renderer，新增 `useTaskQueue` 管理本地等待、运行和历史任务。主进程继续执行单个审查任务，但 IPC payload 增加本地 `client_task_id`，进度事件带回该 ID，避免并发时日志和状态串任务。服务端模型不变，等待任务不提前创建服务端记录。

**Tech Stack:** Electron、React 19、TypeScript、Vitest、Testing Library、现有 IPC `window.codeReview`。

---

## 文件结构

- 新增 `code_review_electron/src/renderer/src/hooks/useTaskQueue.ts`
  - 管理本地队列、最多 2 个运行槽位、进度事件归属和任务分区。
- 新增 `code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx`
  - 覆盖 2 并发、无限排队、失败继续调度、进度不串任务。
- 修改 `code_review_electron/src/shared/types.ts`
  - `TaskProgressEvent` 增加可选 `clientTaskId` 字段。
- 修改 `code_review_electron/src/renderer/src/code-review-api.ts`
  - `ExecuteTaskRequest` 增加可选 `client_task_id`，与 IPC payload 对齐。
- 修改 `code_review_electron/src/main/task-agent.ts`
  - `ExecuteReviewTaskInput` 增加 `clientTaskId`，所有进度事件带回该 ID，并在创建服务端任务后发送 `created` 事件。
- 修改 `code_review_electron/src/main/ipc.ts`
  - 从 IPC payload 中剥离 `client_task_id`，只把服务端字段传给 `createTask()`。
- 修改 `code_review_electron/src/main/__tests__/task-agent.test.ts`
  - 验证进度事件带 `clientTaskId` 和 `created` 事件。
- 修改 `code_review_electron/src/main/__tests__/ipc.test.ts`
  - 验证 `client_task_id` 不会传给服务端创建任务，并补充按选中任务打开报告位置。
- 修改 `code_review_electron/src/renderer/src/components/TaskPage.tsx`
  - 使用 `useTaskQueue` 替代页面内单任务提交状态。
- 修改 `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
  - 验证连续提交不阻塞、报告预览绑定选中任务、下载报告传入选中 taskId。
- 修改 `code_review_electron/src/renderer/src/components/TaskBoard.tsx`
  - 看板改为运行中、等待中、历史任务三个分区。
- 修改 `code_review_electron/src/renderer/src/components/TaskBoard.test.tsx`
  - 覆盖三分区、运行中日志、历史任务隐藏日志、查看报告。
- 修改 `code_review_electron/src/renderer/src/components/TaskForm.tsx`
  - 提交按钮只在入队期间短暂禁用，文案改为“提交中...”。
- 修改 `code_review_electron/src/renderer/src/styles.css`
  - 增加三分区看板样式和等待中状态样式。

---

### Task 1: IPC 进度事件增加本地任务关联 ID

**Files:**
- Modify: `code_review_electron/src/shared/types.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `code_review_electron/src/main/task-agent.ts`
- Modify: `code_review_electron/src/main/ipc.ts`
- Test: `code_review_electron/src/main/__tests__/task-agent.test.ts`
- Test: `code_review_electron/src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: 修改 task-agent 测试，先定义期望行为**

在 `code_review_electron/src/main/__tests__/task-agent.test.ts` 的 `"emits task progress events around environment, workspace, Codex, and upload stages"` 用例中，把执行输入改为带本地 ID，并更新事件断言：

```ts
await executeReviewTask(
  { token: 'token-123', request, clientTaskId: 'local-task-1' },
  dependencies,
  (event) => {
    const detail = event.type === 'stage' ? event.stage : event.stream
    events.push(`${event.clientTaskId}:${event.taskId}:${event.type}:${detail}:${event.message}`)
  }
)

expect(events).toEqual([
  'local-task-1:task-1:stage:created:任务已创建',
  'local-task-1:task-1:stage:checking_environment:检查本机环境',
  'local-task-1:task-1:stage:preparing_workspace:准备任务工作区',
  'local-task-1:task-1:stage:running_codex:启动 Codex 执行审查 Skill',
  'local-task-1:task-1:codex_output:stdout:读取 Skill\n',
  'local-task-1:task-1:stage:uploading_report:上传审查报告',
  'local-task-1:task-1:stage:success:审查完成'
])
```

- [ ] **Step 2: 增加 IPC 测试，确认 client_task_id 不传给服务端**

在 `code_review_electron/src/main/__tests__/ipc.test.ts` 增加用例：

```ts
it('keeps renderer client_task_id out of the server create task payload', async () => {
  const api = {
    createTask: vi.fn(async () => ({
      id: 'task-1',
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2',
      status: 'created'
    })),
    updateTaskStatus: vi.fn(async () => undefined),
    uploadReport: vi.fn(async () => undefined)
  }
  const authStore = {
    load: vi.fn(async () => ({ access_token: 'token-123' })),
    save: vi.fn()
  }
  const cwd = await mkdtemp(join(tmpdir(), 'ipc-client-task-id-'))
  tempDirs.push(cwd)
  const reportPath = join(cwd, '代码审查报告.md')
  const imagesDir = join(cwd, 'images')
  const sender = { send: vi.fn() }
  const { registerIpcHandlers } = await import('../ipc')

  registerIpcHandlers({
    api: api as never,
    authStore: authStore as never,
    syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
    checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
    prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
    runCodex: vi.fn(async () => {
      await writeFile(reportPath, '# report\n')
    })
  })

  const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]

  await executeHandler({ sender }, {
    client_task_id: 'local-task-1',
    svn_url: 'svn://repo/project',
    old_revision: '1',
    new_revision: '2',
    template_key: 'template_1',
    skill_name: '通用-代码审查-模版一'
  })

  expect(api.createTask).toHaveBeenCalledWith('token-123', {
    svn_url: 'svn://repo/project',
    old_revision: '1',
    new_revision: '2',
    template_key: 'template_1',
    skill_name: '通用-代码审查-模版一'
  })
  expect(sender.send).toHaveBeenCalledWith(
    'task:progress',
    expect.objectContaining({
      clientTaskId: 'local-task-1',
      taskId: 'task-1'
    })
  )
})
```

- [ ] **Step 3: 运行失败测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/task-agent.test.ts src/main/__tests__/ipc.test.ts
```

Expected: FAIL，原因包括 `clientTaskId` 不存在、没有 `created` 进度事件，或 `client_task_id` 被传给服务端 payload。

- [ ] **Step 4: 修改共享进度事件类型**

在 `code_review_electron/src/shared/types.ts` 中把 `TaskProgressEvent` 改为：

```ts
export type TaskProgressEvent =
  | {
      taskId: string
      clientTaskId?: string
      type: 'stage'
      stage: TaskProgressStage
      message: string
    }
  | {
      taskId: string
      clientTaskId?: string
      type: 'codex_output'
      stream: 'stdout' | 'stderr'
      message: string
    }
```

- [ ] **Step 5: 修改 renderer IPC 请求类型**

在 `code_review_electron/src/renderer/src/code-review-api.ts` 中把 `ExecuteTaskRequest` 改为：

```ts
export interface ExecuteTaskRequest {
  svn_url: string
  old_revision: string
  new_revision: string
  template_key?: ReviewTemplateKey
  skill_name?: string
  client_task_id?: string
}
```

- [ ] **Step 6: 修改 task-agent 输入和事件发射**

在 `code_review_electron/src/main/task-agent.ts` 中修改输入类型：

```ts
export interface ExecuteReviewTaskInput {
  token: string
  request: CreateTaskRequest
  clientTaskId?: string
}
```

把 `emitStage()` 改为接收 `clientTaskId`：

```ts
const emitStage = (
  onProgress: TaskProgressReporter | undefined,
  taskId: string,
  clientTaskId: string | undefined,
  stage: TaskProgressStage,
  message: string
): void => {
  onProgress?.({
    taskId,
    clientTaskId,
    type: 'stage',
    stage,
    message
  })
}
```

在创建服务端任务后立即发出创建事件，并把后续调用都传入 `input.clientTaskId`：

```ts
const task = toReviewTask(await dependencies.api.createTask(input.token, input.request))
emitStage(onProgress, task.id, input.clientTaskId, 'created', '任务已创建')

try {
  const skillName = resolveSkillName(input.request.skill_name, task.skill_name)

  emitStage(onProgress, task.id, input.clientTaskId, 'checking_environment', '检查本机环境')
  await updateStatus(dependencies, input.token, task.id, {
    status: 'checking_environment'
  })
```

在 `defaultRunCodex()` 的 `codex_output` 事件中带上 `clientTaskId`。先给 `RunCodexInput` 增加字段：

```ts
export interface RunCodexInput {
  cwd: string
  reportPath: string
  imagesDir: string
  skillName: string
  task: ReviewTask
  clientTaskId?: string
  onProgress?: TaskProgressReporter
}
```

然后修改输出事件：

```ts
onProgress?.({
  taskId: task.id,
  clientTaskId,
  type: 'codex_output',
  stream: event.stream,
  message: event.text
})
```

调用 `dependencies.runCodex()` 时传入：

```ts
await dependencies.runCodex({
  ...workspace,
  skillName,
  task,
  clientTaskId: input.clientTaskId,
  onProgress
})
```

- [ ] **Step 7: 修改 IPC handler 剥离 client_task_id**

在 `code_review_electron/src/main/ipc.ts` 的 `task:execute` handler 中，在调用 `executeReviewTask()` 前增加：

```ts
const { client_task_id: clientTaskId, ...createTaskPayload } = payload
```

并把输入改为：

```ts
const result = await executeReviewTask(
  {
    token: tokens.access_token,
    request: createTaskPayload,
    clientTaskId
  },
  {
    api: taskApi,
    checkEnvironment: checkLocalEnvironment,
    prepareWorkspace: dependencies.prepareWorkspace ?? defaultPrepareWorkspace,
    runCodex: dependencies.runCodex ?? defaultRunCodex,
    uploadReport:
      dependencies.uploadReport ??
      ((token, taskId, reportPath) => uploadReportFile(taskApi, token, taskId, reportPath))
  },
  (progressEvent) => {
    event.sender?.send('task:progress', progressEvent)
  }
)
```

- [ ] **Step 8: 运行测试确认通过**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/task-agent.test.ts src/main/__tests__/ipc.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add code_review_electron/src/shared/types.ts \
  code_review_electron/src/renderer/src/code-review-api.ts \
  code_review_electron/src/main/task-agent.ts \
  code_review_electron/src/main/ipc.ts \
  code_review_electron/src/main/__tests__/task-agent.test.ts \
  code_review_electron/src/main/__tests__/ipc.test.ts
git commit -m "增加任务进度本地关联ID"
```

---

### Task 2: 新增 useTaskQueue 并用测试锁定 2 并发队列

**Files:**
- Create: `code_review_electron/src/renderer/src/hooks/useTaskQueue.ts`
- Create: `code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx`

- [ ] **Step 1: 写 useTaskQueue 失败测试**

创建 `code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx`：

```ts
// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExecuteTaskRequest, ExecuteTaskResult } from '../code-review-api'
import { useTaskQueue } from './useTaskQueue'

const makeRequest = (index: number): ExecuteTaskRequest => ({
  svn_url: `svn://repo/project-${index}`,
  old_revision: `${index}`,
  new_revision: `${index + 1}`,
  template_key: 'template_1',
  skill_name: '通用-代码审查-模版一'
})

const deferred = <T,>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useTaskQueue', () => {
  it('runs at most two tasks and queues additional submissions', async () => {
    const executions = [deferred<ExecuteTaskResult>(), deferred<ExecuteTaskResult>(), deferred<ExecuteTaskResult>()]
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) => {
      const next = executions[executeTask.mock.calls.length - 1]
      return next.promise
    })
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(makeRequest(1))
      await result.current.submitTask(makeRequest(2))
      await result.current.submitTask(makeRequest(3))
    })

    expect(executeTask).toHaveBeenCalledTimes(2)
    expect(result.current.runningTasks).toHaveLength(2)
    expect(result.current.queuedTasks).toHaveLength(1)
    expect(result.current.queuedTasks[0].queueIndex).toBe(1)

    await act(async () => {
      executions[0].resolve({
        taskId: 'task-1',
        status: 'success',
        reportMarkdown: '# report 1',
        reportPath: '/tmp/task-1.md'
      })
      await executions[0].promise
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(3))
    expect(result.current.runningTasks).toHaveLength(2)
    expect(result.current.queuedTasks).toHaveLength(0)
    expect(result.current.historyTasks.some((task) => task.id === 'task-1')).toBe(true)
  })

  it('keeps progress events scoped to the matching client task', async () => {
    const executions = [deferred<ExecuteTaskResult>(), deferred<ExecuteTaskResult>()]
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) => executions[executeTask.mock.calls.length - 1].promise)
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(makeRequest(1))
      await result.current.submitTask(makeRequest(2))
    })

    const firstClientId = executeTask.mock.calls[0][0].client_task_id
    const secondClientId = executeTask.mock.calls[1][0].client_task_id

    act(() => {
      result.current.applyProgressEvent({
        clientTaskId: secondClientId,
        taskId: 'task-2',
        type: 'codex_output',
        stream: 'stdout',
        message: 'second task output\n'
      })
    })

    const firstTask = result.current.runningTasks.find((task) => task.localTaskId === firstClientId)
    const secondTask = result.current.runningTasks.find((task) => task.localTaskId === secondClientId)
    expect(firstTask?.codex_log ?? []).toHaveLength(0)
    expect(secondTask?.codex_log?.[0].message).toBe('second task output\n')
  })

  it('continues scheduling after one task fails', async () => {
    const executions = [deferred<ExecuteTaskResult>(), deferred<ExecuteTaskResult>(), deferred<ExecuteTaskResult>()]
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) => executions[executeTask.mock.calls.length - 1].promise)
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(makeRequest(1))
      await result.current.submitTask(makeRequest(2))
      await result.current.submitTask(makeRequest(3))
    })

    await act(async () => {
      executions[0].reject(new Error('SVN 操作失败'))
      await executions[0].promise.catch(() => undefined)
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(3))
    expect(result.current.historyTasks.some((task) => task.status === 'failed' && task.error_message === 'SVN 操作失败')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/hooks/useTaskQueue.test.tsx
```

Expected: FAIL，原因是 `useTaskQueue.ts` 不存在。

- [ ] **Step 3: 实现 useTaskQueue**

创建 `code_review_electron/src/renderer/src/hooks/useTaskQueue.ts`：

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReviewTask, TaskProgressEvent } from '../../../shared/types'
import type { ExecuteTaskRequest, ExecuteTaskResult } from '../code-review-api'

export const MAX_CONCURRENT_REVIEW_TASKS = 2

export type LocalTaskQueueState = 'queued' | 'starting' | 'running' | 'finished'

export type TaskViewItem = ReviewTask & {
  localTaskId?: string
  localQueueState?: LocalTaskQueueState
  queueIndex?: number
  createdAtMs?: number
  reportMarkdown?: string
}

type ExecuteTask = (payload: ExecuteTaskRequest) => Promise<ExecuteTaskResult>

interface UseTaskQueueInput {
  executeTask: ExecuteTask
  initialTasks?: ReviewTask[]
  onTaskSuccess?: (task: TaskViewItem, result: ExecuteTaskResult) => void
}

interface UseTaskQueueResult {
  tasks: TaskViewItem[]
  runningTasks: TaskViewItem[]
  queuedTasks: TaskViewItem[]
  historyTasks: TaskViewItem[]
  submitTask: (payload: ExecuteTaskRequest) => Promise<void>
  applyProgressEvent: (event: TaskProgressEvent) => void
  setServerTasks: (tasks: ReviewTask[]) => void
}

const terminalStatuses = new Set<ReviewTask['status']>([
  'success',
  'failed',
  'environment_error',
  'cancelled'
])

const runningStatuses = new Set<ReviewTask['status']>([
  'checking_environment',
  'running_codex',
  'uploading_report'
])

const createLocalTaskId = (): string =>
  `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '审查任务执行失败。'

const toPendingTask = (payload: ExecuteTaskRequest, localTaskId: string): TaskViewItem => ({
  id: localTaskId,
  localTaskId,
  localQueueState: 'queued',
  createdAtMs: Date.now(),
  svn_url: payload.svn_url,
  old_revision: payload.old_revision,
  new_revision: payload.new_revision,
  template_key: payload.template_key,
  skill_name: payload.skill_name,
  status: 'created',
  progress_message: '等待中'
})

const sortNewestFirst = (tasks: TaskViewItem[]): TaskViewItem[] =>
  [...tasks].sort((left, right) => (right.createdAtMs ?? 0) - (left.createdAtMs ?? 0))

export function useTaskQueue({
  executeTask,
  initialTasks = [],
  onTaskSuccess
}: UseTaskQueueInput): UseTaskQueueResult {
  const [tasks, setTasks] = useState<TaskViewItem[]>(() =>
    initialTasks.map((task) => ({ ...task, localQueueState: terminalStatuses.has(task.status) ? 'finished' : 'running' }))
  )
  const runningLocalIdsRef = useRef<Set<string>>(new Set())

  const setServerTasks = useCallback((serverTasks: ReviewTask[]) => {
    setTasks((current) => {
      const localTasks = current.filter((task) => task.localTaskId)
      const localServerIds = new Set(localTasks.map((task) => task.id))
      const mergedServerTasks = serverTasks
        .filter((task) => !localServerIds.has(task.id))
        .map<TaskViewItem>((task) => ({
          ...task,
          localQueueState: terminalStatuses.has(task.status) ? 'finished' : 'running'
        }))
      return [...localTasks, ...mergedServerTasks]
    })
  }, [])

  const runTask = useCallback(
    async (localTaskId: string, payload: ExecuteTaskRequest) => {
      runningLocalIdsRef.current.add(localTaskId)
      setTasks((current) =>
        current.map((task) =>
          task.localTaskId === localTaskId
            ? { ...task, localQueueState: 'starting', status: 'created', progress_message: '启动中' }
            : task
        )
      )

      try {
        const result = await executeTask({ ...payload, client_task_id: localTaskId })
        setTasks((current) =>
          current.map((task) => {
            if (task.localTaskId !== localTaskId) return task
            const updated: TaskViewItem = {
              ...task,
              id: result.taskId,
              localQueueState: 'finished',
              status: result.status,
              report_path: result.reportPath,
              reportMarkdown: result.reportMarkdown,
              progress_message: result.status === 'success' ? '审查完成' : task.progress_message
            }
            if (result.status === 'success') {
              onTaskSuccess?.(updated, result)
            }
            return updated
          })
        )
      } catch (error) {
        setTasks((current) =>
          current.map((task) =>
            task.localTaskId === localTaskId
              ? {
                  ...task,
                  localQueueState: 'finished',
                  status: 'failed',
                  error_message: toErrorMessage(error),
                  progress_message: toErrorMessage(error)
                }
              : task
          )
        )
      } finally {
        runningLocalIdsRef.current.delete(localTaskId)
      }
    },
    [executeTask, onTaskSuccess]
  )

  useEffect(() => {
    const runningCount = runningLocalIdsRef.current.size
    const availableSlots = Math.max(0, MAX_CONCURRENT_REVIEW_TASKS - runningCount)
    if (availableSlots === 0) return

    const nextTasks = tasks
      .filter((task) => task.localQueueState === 'queued' && task.localTaskId)
      .slice(0, availableSlots)

    nextTasks.forEach((task) => {
      if (!task.localTaskId) return
      void runTask(task.localTaskId, {
        svn_url: task.svn_url,
        old_revision: task.old_revision,
        new_revision: task.new_revision,
        template_key: task.template_key,
        skill_name: task.skill_name
      })
    })
  }, [tasks, runTask])

  const submitTask = useCallback(async (payload: ExecuteTaskRequest): Promise<void> => {
    const localTaskId = createLocalTaskId()
    setTasks((current) => [toPendingTask(payload, localTaskId), ...current])
  }, [])

  const applyProgressEvent = useCallback((event: TaskProgressEvent) => {
    setTasks((current) => {
      const targetIndex = current.findIndex((task) => {
        if (event.clientTaskId && task.localTaskId === event.clientTaskId) return true
        return task.id === event.taskId
      })

      if (targetIndex < 0) return current

      return current.map((task, index) => {
        if (index !== targetIndex) return task
        const codexLog =
          event.type === 'codex_output' ? [...(task.codex_log ?? []), event].slice(-20) : task.codex_log
        const status =
          event.type === 'stage'
            ? event.stage === 'preparing_workspace'
              ? 'checking_environment'
              : event.stage
            : task.status
        const localQueueState =
          event.type === 'stage' && terminalStatuses.has(status) ? 'finished' : 'running'
        return {
          ...task,
          id: event.taskId,
          localQueueState,
          status,
          progress_message: event.message,
          codex_log: codexLog
        }
      })
    })
  }, [])

  const runningTasks = useMemo(
    () =>
      sortNewestFirst(
        tasks.filter(
          (task) =>
            task.localQueueState === 'starting' ||
            task.localQueueState === 'running' ||
            runningStatuses.has(task.status)
        )
      ),
    [tasks]
  )
  const queuedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.localQueueState === 'queued')
        .map((task, index) => ({ ...task, queueIndex: index + 1 })),
    [tasks]
  )
  const historyTasks = useMemo(
    () => sortNewestFirst(tasks.filter((task) => terminalStatuses.has(task.status))),
    [tasks]
  )

  return {
    tasks,
    runningTasks,
    queuedTasks,
    historyTasks,
    submitTask,
    applyProgressEvent,
    setServerTasks
  }
}
```

- [ ] **Step 4: 运行 hook 测试**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/hooks/useTaskQueue.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 运行类型检查**

Run:

```bash
cd code_review_electron
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add code_review_electron/src/renderer/src/hooks/useTaskQueue.ts \
  code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx
git commit -m "新增客户端任务队列调度"
```

---

### Task 3: TaskPage 接入队列并保留报告预览语义

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.tsx`
- Test: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`

- [ ] **Step 1: 更新 TaskPage 测试覆盖连续提交**

在 `code_review_electron/src/renderer/src/components/TaskPage.test.tsx` 增加 deferred helper：

```ts
const deferred = <T,>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
```

增加用例：

```ts
it('连续提交任务时不会等待前一个审查完成', async () => {
  const user = userEvent.setup()
  const first = deferred<Awaited<ReturnType<CodeReviewApi['executeTask']>>>()
  const second = deferred<Awaited<ReturnType<CodeReviewApi['executeTask']>>>()
  window.codeReview.executeTask = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)

  render(
    <TaskPage
      environment={{ status: 'ready', codexVersion: 'codex-cli 0.130.0', svnVersion: '1.14.5' }}
      isCheckingEnvironment={false}
      isInstallingSkillDuringCheck={false}
      isInstallingCodex={false}
      isInstallingSvn={false}
      svnUsername="Key 用户"
      onRefreshEnvironment={vi.fn()}
      onInstallCodex={vi.fn()}
      onInstallSvn={vi.fn()}
      onInstallSkill={vi.fn()}
    />
  )

  await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
  await user.type(screen.getByLabelText('旧版本号'), '12')
  await user.type(screen.getByLabelText('新版本号'), '14')
  await user.click(screen.getByRole('button', { name: '开始审查' }))
  await user.click(screen.getByRole('button', { name: '开始审查' }))

  expect(window.codeReview.executeTask).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: '开始审查' })).toBeEnabled()
})
```

增加报告位置用例：

```ts
it('查看报告位置时传入当前选中的任务 ID', async () => {
  const user = userEvent.setup()
  window.codeReview.listTasks = vi.fn(async () => ({
    data: [
      {
        id: 'task-success',
        svn_url: 'svn://repo/success',
        old_revision: '1',
        new_revision: '2',
        status: 'success' as const
      }
    ],
    count: 1
  }))
  window.codeReview.readTaskReport = vi.fn(async () => '# report')
  window.codeReview.downloadCurrentReport = vi.fn(async () => ({
    status: 'ready',
    taskId: 'task-success',
    reportPath: '/tmp/task-success/代码审查报告.md'
  }))

  render(
    <TaskPage
      environment={{ status: 'ready', codexVersion: 'codex-cli 0.130.0', svnVersion: '1.14.5' }}
      isCheckingEnvironment={false}
      isInstallingSkillDuringCheck={false}
      isInstallingCodex={false}
      isInstallingSvn={false}
      svnUsername="Key 用户"
      onRefreshEnvironment={vi.fn()}
      onInstallCodex={vi.fn()}
      onInstallSvn={vi.fn()}
      onInstallSkill={vi.fn()}
    />
  )

  await screen.findByText('svn://repo/success')
  await user.click(screen.getByRole('button', { name: '查看报告' }))
  await user.click(screen.getByRole('button', { name: '查看报告位置' }))

  expect(window.codeReview.downloadCurrentReport).toHaveBeenCalledWith('task-success')
})
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskPage.test.tsx
```

Expected: FAIL，原因是表单仍等待任务完成、下载报告没有稳定绑定选中任务或看板结构尚未适配。

- [ ] **Step 3: 修改 TaskForm 提交状态**

在 `code_review_electron/src/renderer/src/components/TaskForm.tsx` 中保留 `isSubmitting`，但文案改成：

```tsx
<button
  className="primary-button"
  type="submit"
  disabled={disabled || isSubmitting || !selectedTemplateAvailable}
>
  {isSubmitting ? '提交中...' : '开始审查'}
</button>
```

`handleSubmit()` 保持 `await onSubmit(...)`，因为接入后 `onSubmit` 只负责入队，不等待 Codex 完成。

- [ ] **Step 4: 修改 TaskPage 使用 useTaskQueue**

在 `code_review_electron/src/renderer/src/components/TaskPage.tsx` 顶部增加：

```ts
import { useCallback } from 'react'
import { useTaskQueue } from '../hooks/useTaskQueue'
```

替换原来的 `tasks` state、`handleTaskSubmit()` 和 `applyTaskProgress()` 使用方式：

```ts
const {
  runningTasks,
  queuedTasks,
  historyTasks,
  submitTask,
  applyProgressEvent,
  setServerTasks
} = useTaskQueue({
  executeTask: window.codeReview.executeTask,
  onTaskSuccess: (task, result) => {
    if (!selectedTaskId && result.reportMarkdown) {
      setMarkdown(result.reportMarkdown)
      setSelectedTaskId(result.taskId)
      if (result.reportPath) {
        setCurrentReportPath(result.reportPath)
        setReportMessage(`报告已生成：${result.reportPath}`)
      }
    }
  }
})
```

在加载任务成功时改为：

```ts
setServerTasks(response.data)
```

进度监听改为：

```ts
useEffect(() => {
  return window.codeReview.onTaskProgress((event) => {
    applyProgressEvent(event)
  })
}, [applyProgressEvent])
```

提交处理改为：

```ts
const handleTaskSubmit = async (payload: ExecuteTaskRequest): Promise<void> => {
  setError('')
  setReportMessage('')
  await submitTask(payload)
}
```

传给看板：

```tsx
<TaskBoard
  runningTasks={runningTasks}
  queuedTasks={queuedTasks}
  historyTasks={historyTasks}
  isLoading={isLoadingTasks}
  selectedTaskId={selectedTaskId}
  loadingReportTaskId={loadingReportTaskId}
  onViewReport={(task) => void handleViewReport(task)}
/>
```

下载报告保持按选中任务：

```ts
const result = await window.codeReview.downloadCurrentReport(selectedTaskId)
```

删除 `mergeTasks`、`applyTaskProgress`、`mapProgressStageToTaskStatus`，这些职责迁移到 `useTaskQueue`。

- [ ] **Step 5: 运行 TaskPage 测试**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskPage.test.tsx
```

Expected: FAIL，原因是 `TaskBoard` props 尚未改造。Task 4 会完成看板 props 改造并让本测试通过。

- [ ] **Step 6: 暂不提交**

本任务依赖 Task 4 的 `TaskBoard` props 改造后才能整体通过。Task 3 不单独提交，相关修改在 Task 4 通过测试后一并提交。

---

### Task 4: TaskBoard 改为运行中、等待中、历史任务三分区

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/TaskBoard.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskBoard.test.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.tsx`

- [ ] **Step 1: 重写 TaskBoard 测试**

把 `code_review_electron/src/renderer/src/components/TaskBoard.test.tsx` 的用例改为三分区测试。保留 imports，替换测试数据和核心用例：

```ts
import type { TaskViewItem } from '../hooks/useTaskQueue'

const runningTasks: TaskViewItem[] = [
  {
    id: 'task-running',
    localTaskId: 'local-running',
    localQueueState: 'running',
    svn_url: 'https://svn.example.com/project/running',
    old_revision: '100',
    new_revision: '101',
    status: 'running_codex',
    progress_message: 'Codex 正在审查',
    codex_log: [
      {
        taskId: 'task-running',
        clientTaskId: 'local-running',
        type: 'codex_output',
        stream: 'stdout',
        message: 'analyzing src/current.c\n'
      }
    ]
  }
]

const queuedTasks: TaskViewItem[] = [
  {
    id: 'local-queued',
    localTaskId: 'local-queued',
    localQueueState: 'queued',
    queueIndex: 1,
    svn_url: 'https://svn.example.com/project/queued',
    old_revision: '200',
    new_revision: '201',
    status: 'created',
    progress_message: '等待中'
  }
]

const historyTasks: TaskViewItem[] = [
  {
    id: 'task-history',
    svn_url: 'https://svn.example.com/project/history',
    old_revision: '90',
    new_revision: '91',
    status: 'success',
    progress_message: '审查完成',
    codex_log: [
      {
        taskId: 'task-history',
        type: 'codex_output',
        stream: 'stdout',
        message: 'old noisy output\n'
      }
    ]
  }
]
```

新增用例：

```ts
it('展示运行中、等待中和历史任务分区', () => {
  render(
    <TaskBoard
      runningTasks={runningTasks}
      queuedTasks={queuedTasks}
      historyTasks={historyTasks}
    />
  )

  expect(screen.getByRole('heading', { name: '运行中' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '等待中' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '历史任务' })).toBeInTheDocument()
  expect(screen.getByText('https://svn.example.com/project/running')).toBeInTheDocument()
  expect(screen.getByText('https://svn.example.com/project/queued')).toBeInTheDocument()
  expect(screen.getByText('https://svn.example.com/project/history')).toBeInTheDocument()
  expect(screen.getByText('第 1 位')).toBeInTheDocument()
})

it('只在运行中任务展示 Codex 日志', () => {
  render(
    <TaskBoard
      runningTasks={runningTasks}
      queuedTasks={queuedTasks}
      historyTasks={historyTasks}
    />
  )

  expect(screen.getByText('analyzing src/current.c')).toBeInTheDocument()
  expect(screen.queryByText('old noisy output')).not.toBeInTheDocument()
})

it('历史任务成功时可以查看报告', async () => {
  const user = userEvent.setup()
  const onViewReport = vi.fn()
  render(
    <TaskBoard
      runningTasks={[]}
      queuedTasks={[]}
      historyTasks={historyTasks}
      onViewReport={onViewReport}
    />
  )

  await user.click(screen.getByRole('button', { name: '查看报告' }))

  expect(onViewReport).toHaveBeenCalledWith(historyTasks[0])
})

it('空分区显示对应空状态', () => {
  render(<TaskBoard runningTasks={[]} queuedTasks={[]} historyTasks={[]} />)

  expect(screen.getByText('暂无运行中的任务。')).toBeInTheDocument()
  expect(screen.getByText('暂无等待中的任务。')).toBeInTheDocument()
  expect(screen.getByText('暂无历史任务。')).toBeInTheDocument()
})
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskBoard.test.tsx
```

Expected: FAIL，原因是 `TaskBoard` 仍使用旧的 `tasks` prop 和 tab UI。

- [ ] **Step 3: 修改 TaskBoard props 和渲染结构**

在 `code_review_electron/src/renderer/src/components/TaskBoard.tsx` 中改为：

```ts
import type { TaskViewItem } from '../hooks/useTaskQueue'

type TaskBoardProps = {
  runningTasks: TaskViewItem[]
  queuedTasks: TaskViewItem[]
  historyTasks: TaskViewItem[]
  isLoading?: boolean
  selectedTaskId?: string
  loadingReportTaskId?: string
  onViewReport?: (task: TaskViewItem) => void
}
```

扩展状态文案：

```ts
const statusText: Record<TaskViewItem['status'], string> = {
  created: '已创建',
  checking_environment: '检查环境',
  running_codex: '审查中',
  uploading_report: '上传报告',
  success: '已完成',
  failed: '失败',
  environment_error: '环境异常',
  cancelled: '已取消'
}
```

把 `TaskCard` 的 `task` 类型改为 `TaskViewItem`，并在 meta 中增加模板展示和等待位次：

```tsx
{task.localQueueState === 'queued' && task.queueIndex && (
  <span className="queue-rank">第 {task.queueIndex} 位</span>
)}
{task.skill_name && <p className="task-template">{task.skill_name}</p>}
```

把导出的组件改为三段渲染：

```tsx
export function TaskBoard({
  runningTasks,
  queuedTasks,
  historyTasks,
  isLoading = false,
  selectedTaskId,
  loadingReportTaskId,
  onViewReport
}: TaskBoardProps): React.JSX.Element {
  if (isLoading) {
    return <p className="empty-state">正在加载任务...</p>
  }

  return (
    <div className="task-board task-board-sections">
      <TaskSection title="运行中" emptyText="暂无运行中的任务。">
        {runningTasks.map((task) => (
          <TaskCard
            key={task.localTaskId ?? task.id}
            task={task}
            selectedTaskId={selectedTaskId}
            loadingReportTaskId={loadingReportTaskId}
            showCodexLog
            onViewReport={onViewReport}
          />
        ))}
      </TaskSection>

      <TaskSection title="等待中" emptyText="暂无等待中的任务。">
        {queuedTasks.map((task) => (
          <TaskCard
            key={task.localTaskId ?? task.id}
            task={task}
            selectedTaskId={selectedTaskId}
            loadingReportTaskId={loadingReportTaskId}
          />
        ))}
      </TaskSection>

      <TaskSection title="历史任务" emptyText="暂无历史任务。">
        {historyTasks.map((task) => (
          <TaskCard
            key={task.localTaskId ?? task.id}
            task={task}
            selectedTaskId={selectedTaskId}
            loadingReportTaskId={loadingReportTaskId}
            onViewReport={onViewReport}
          />
        ))}
      </TaskSection>
    </div>
  )
}
```

在同文件增加 `TaskSection`：

```tsx
function TaskSection({
  title,
  emptyText,
  children
}: {
  title: string
  emptyText: string
  children: React.ReactNode
}): React.JSX.Element {
  const childArray = React.Children.toArray(children).filter(Boolean)

  return (
    <section className="task-board-section">
      <h3>{title}</h3>
      {childArray.length > 0 ? (
        <div className="task-list" aria-label={`${title}列表`}>
          {childArray}
        </div>
      ) : (
        <p className="empty-state">{emptyText}</p>
      )}
    </section>
  )
}
```

记得把 React 默认 import 或命名 import 补上：

```ts
import React from 'react'
```

- [ ] **Step 4: 修改样式**

在 `code_review_electron/src/renderer/src/styles.css` 的任务看板样式附近追加：

```css
.task-board-sections {
  display: grid;
  gap: 14px;
}

.task-board-section {
  display: grid;
  gap: 10px;
}

.task-board-section h3 {
  margin: 0;
  color: rgb(245 247 251 / 82%);
  font-size: 14px;
}

.queue-rank {
  justify-self: start;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 999px;
  padding: 2px 8px;
  color: #b9e8ff;
  background: rgb(30 96 126 / 36%);
  font-size: 12px;
  font-weight: 800;
}

.task-template {
  margin: 0;
  color: rgb(245 247 251 / 52%);
  font-size: 12px;
  overflow-wrap: anywhere;
}
```

把旧的 `.current-task-card` 和 `.task-list[aria-label='当前任务列表']` 选择器删除或改成不依赖旧 aria label：

```css
.task-board-section:first-child .task-card {
  min-height: 250px;
}

.task-board-section:not(:first-child) .task-card {
  min-height: 0;
}
```

- [ ] **Step 5: 运行看板和页面测试**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/TaskBoard.test.tsx src/renderer/src/components/TaskPage.test.tsx
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交 Task 3 和 Task 4 的联动修改**

```bash
git add code_review_electron/src/renderer/src/components/TaskPage.tsx \
  code_review_electron/src/renderer/src/components/TaskPage.test.tsx \
  code_review_electron/src/renderer/src/components/TaskBoard.tsx \
  code_review_electron/src/renderer/src/components/TaskBoard.test.tsx \
  code_review_electron/src/renderer/src/components/TaskForm.tsx \
  code_review_electron/src/renderer/src/styles.css
git commit -m "改造任务看板支持并发队列"
```

---

### Task 5: 报告位置按选中任务稳定打开

**Files:**
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`
- Modify: `code_review_electron/src/main/ipc.ts`

- [ ] **Step 1: 增加主进程报告位置测试**

在 `code_review_electron/src/main/__tests__/ipc.test.ts` 增加用例：

```ts
it('opens the selected historical report even when another task was the latest success', async () => {
  const api = {
    createTask: vi.fn(async () => ({
      id: 'task-latest',
      svn_url: 'svn://repo/latest',
      old_revision: '1',
      new_revision: '2',
      status: 'created'
    })),
    updateTaskStatus: vi.fn(async () => undefined),
    uploadReport: vi.fn(async () => undefined),
    readTaskReport: vi.fn(async () => '# selected report\n')
  }
  const authStore = {
    load: vi.fn(async () => ({ access_token: 'token-123' })),
    save: vi.fn()
  }
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-selected-report-'))
  tempDirs.push(runtimeRoot)
  const latestWorkspace = join(runtimeRoot, 'workspaces', 'task-latest')
  const latestReportPath = join(latestWorkspace, '代码审查报告.md')
  const { registerIpcHandlers } = await import('../ipc')

  registerIpcHandlers({
    api: api as never,
    authStore: authStore as never,
    syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
    checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
    prepareWorkspace: vi.fn(async () => ({
      cwd: latestWorkspace,
      reportPath: latestReportPath,
      imagesDir: join(latestWorkspace, 'images')
    })),
    runCodex: vi.fn(async () => {
      await mkdir(latestWorkspace, { recursive: true })
      await writeFile(latestReportPath, '# latest report\n')
    }),
    runtimePaths: {
      runtimeRoot,
      skillPackagesDir: join(runtimeRoot, 'skill-packages'),
      skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
      workspacesDir: join(runtimeRoot, 'workspaces'),
      workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
      reportPathForTask: (taskId: string) =>
        join(runtimeRoot, 'workspaces', taskId, '代码审查报告.md'),
      imagesDirForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'images')
    }
  })

  const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]
  const downloadHandler = handleMock.mock.calls.find(
    ([channel]) => channel === 'report:download-current'
  )?.[1]

  await executeHandler({}, {
    svn_url: 'svn://repo/latest',
    old_revision: '1',
    new_revision: '2',
    template_key: 'template_1',
    skill_name: '通用-代码审查-模版一'
  })

  const selectedReportPath = join(runtimeRoot, 'workspaces', 'task-selected', '代码审查报告.md')
  await expect(downloadHandler({}, 'task-selected')).resolves.toEqual({
    status: 'ready',
    taskId: 'task-selected',
    reportPath: selectedReportPath
  })
  expect(api.readTaskReport).toHaveBeenCalledWith('token-123', 'task-selected')
  expect(showItemInFolderMock).toHaveBeenLastCalledWith(selectedReportPath)
})
```

- [ ] **Step 2: 运行测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/ipc.test.ts
```

Expected: PASS。

- [ ] **Step 3: 确认 report:download-current 分支顺序**

在 `code_review_electron/src/main/ipc.ts` 中确认逻辑优先级是：

```ts
if (
  latestSuccessfulReport?.reportPath &&
  (!taskId || latestSuccessfulReport.taskId === taskId)
) {
  shell.showItemInFolder(latestSuccessfulReport.reportPath)
  return latestSuccessfulReport
}
```

这个条件必须保留 `latestSuccessfulReport.taskId === taskId`，不能在传入 `taskId` 时打开不匹配的最后成功报告。如当前代码已经一致，本步骤不修改代码。

- [ ] **Step 4: 提交**

```bash
git add code_review_electron/src/main/ipc.ts \
  code_review_electron/src/main/__tests__/ipc.test.ts
git commit -m "固定按选中任务打开报告位置"
```

---

### Task 6: 全量验证和计划回填

**Files:**
- Modify: `docs/superpowers/plans/2026-06-10-electron-concurrent-task-queue.md`

- [ ] **Step 1: 运行 Electron 全量测试**

Run:

```bash
cd code_review_electron
npm test
```

Expected: PASS。

- [ ] **Step 2: 运行类型检查**

Run:

```bash
cd code_review_electron
npm run typecheck
```

Expected: PASS。

- [ ] **Step 3: 构建 Electron 客户端**

Run:

```bash
cd code_review_electron
npm run build
```

Expected: PASS，`electron-vite build` 完成。

- [ ] **Step 4: 手动验证清单**

启动客户端：

```bash
cd code_review_electron
npm run dev
```

手动验证：

- 连续提交 3 个审查任务。
- 确认最多 2 个任务显示在“运行中”。
- 确认第 3 个任务显示在“等待中”，并带“第 1 位”。
- 结束任意一个运行中任务后，等待任务自动进入运行中。
- 两个运行中任务的 Codex 日志分别显示在自己的任务卡中。
- 成功任务进入“历史任务”，且“查看报告”能更新右侧 Markdown。
- 点击“查看报告位置”打开当前选中任务的报告路径。

- [ ] **Step 5: 在计划文档记录验证结果**

在本文件底部追加：

```markdown
## 验证记录

- `npm test`：通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- 手动验证：连续提交 3 个任务时最多 2 个运行，第 3 个等待；运行完成后自动调度；报告预览和报告位置均按选中任务打开。
```

- [ ] **Step 6: 提交验证记录**

```bash
git add docs/superpowers/plans/2026-06-10-electron-concurrent-task-queue.md
git commit -m "记录并发任务队列验证结果"
```

---

## 计划自查

- Spec 覆盖：2 并发、无限本地排队、不做重启恢复、不新增服务端状态、保留看板功能、报告按选中任务打开，均有对应任务。
- 范围控制：第一版不实现取消等待、优先级、暂停恢复、服务端 queued 状态和重启恢复。
- 类型一致性：本地关联字段在 renderer payload 使用 `client_task_id`，进度事件使用 `clientTaskId`，本地展示任务使用 `localTaskId`。
- 测试路径：主进程测试覆盖 IPC 和进度事件，渲染层测试覆盖队列调度、页面集成和看板三分区。

## 验证记录

- `npm test`：通过，26 个测试文件、182 个测试全部通过。
- `npm run typecheck`：通过，`tsc --noEmit` 退出码 0。
- `npm run build`：通过，Electron main、preload、renderer 均完成生产构建。
- 手动验证：未在本轮执行真实 SVN/Codex 三任务端到端验证；需要在可登录并可访问 SVN 的客户端环境中确认连续提交 3 个任务时最多 2 个运行、第 3 个等待、运行完成后自动调度，以及报告预览和报告位置均按选中任务打开。
