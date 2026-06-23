# Electron Task Completion Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Electron 客户端在审查完成时按前台/后台状态提醒用户，点击提醒可打开报告，并让历史任务按完成时间倒序展示。

**Architecture:** 渲染层负责判断前台状态、展示应用内提醒、打开报告；主进程负责系统通知、Windows AppUserModelID、通知点击后恢复窗口并回传事件。`useTaskQueue` 只负责任务队列和历史任务排序，不直接触碰 Electron 通知 API。

**Tech Stack:** Electron 39、React 19、TypeScript、Vitest、Testing Library、Electron IPC。

---

## 文件结构

- Modify: `code_review_electron/src/shared/types.ts`
  - 增加审查完成通知 payload/result 共享类型，供主进程、preload、renderer 复用。
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
  - 增加 `CodeReviewApi` 的通知方法签名和事件监听签名。
- Modify: `code_review_electron/src/preload/index.ts`
  - 暴露 `showTaskCompletionNotification` 和 `onTaskCompletionNotificationClicked`。
- Modify: `code_review_electron/src/preload/index.test.ts`
  - 覆盖新增 preload API。
- Modify: `code_review_electron/src/main/ipc.ts`
  - 注册系统通知 IPC，注入 `getMainWindow`，处理通知点击回传。
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`
  - 覆盖通知 IPC 注册、成功发送、点击恢复窗口、通知不支持时失败。
- Modify: `code_review_electron/src/main/index.ts`
  - 设置 Windows AppUserModelID，保存主窗口，向 IPC 注册传入 `getMainWindow`。
- Modify: `code_review_electron/src/main/__tests__/main-window-menu.test.ts`
  - 覆盖 `app.setAppUserModelId("com.peicheng.code-review")` 和 `registerIpcHandlers({ getMainWindow })`。
- Modify: `code_review_electron/src/renderer/src/hooks/useTaskQueue.ts`
  - 对 `historyTasks` 按完成时间倒序排序。
- Modify: `code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx`
  - 覆盖历史任务排序。
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
  - 移除任务完成后自动切换报告；完成后按前台/后台显示应用内提醒或系统通知；通知点击后打开报告。
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
  - 覆盖前台/后台提醒、不自动覆盖预览、点击提醒打开报告、历史加载不提醒。
- Modify: `code_review_electron/src/renderer/src/styles.css`
  - 增加应用内右下角完成提醒样式。
- Modify: `../Code_review/.gitignore`
  - 已加入两个用户要求忽略的技能目录。

---

### Task 1: 添加通知共享类型和 preload/API 契约

**Files:**
- Modify: `code_review_electron/src/shared/types.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Test: `code_review_electron/src/preload/index.test.ts`

- [ ] **Step 1: 写 preload 失败测试**

在 `code_review_electron/src/preload/index.test.ts` 末尾新增：

```ts
  it('invokes task completion notification IPC', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    await api.showTaskCompletionNotification({
      taskId: 'task-1',
      localTaskId: 'local-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12',
      reportPath: '/tmp/report.md',
      pdfPath: '/tmp/report.pdf',
      pdfReportName: 'r10_r12审查报告.pdf'
    })

    expect(invokeMock).toHaveBeenCalledWith('notification:show-task-completed', {
      taskId: 'task-1',
      localTaskId: 'local-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12',
      reportPath: '/tmp/report.md',
      pdfPath: '/tmp/report.pdf',
      pdfReportName: 'r10_r12审查报告.pdf'
    })
  })

  it('subscribes to task completion notification click IPC', async () => {
    const onMock = vi.mocked((await import('electron')).ipcRenderer.on)
    const removeListenerMock = vi.mocked((await import('electron')).ipcRenderer.removeListener)
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const callback = vi.fn()

    const unsubscribe = api.onTaskCompletionNotificationClicked(callback)
    const listener = onMock.mock.calls.find(
      ([channel]) => channel === 'notification:task-completed-clicked'
    )?.[1]

    expect(listener).toBeDefined()
    listener({}, { taskId: 'task-1', svn_url: 'svn://repo/project' })
    expect(callback).toHaveBeenCalledWith({ taskId: 'task-1', svn_url: 'svn://repo/project' })

    unsubscribe()
    expect(removeListenerMock).toHaveBeenCalledWith(
      'notification:task-completed-clicked',
      listener
    )
  })
```

- [ ] **Step 2: 运行 preload 测试确认失败**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/preload/index.test.ts
```

Expected: FAIL，提示 `api.showTaskCompletionNotification is not a function` 或找不到监听方法。

- [ ] **Step 3: 增加共享类型**

在 `code_review_electron/src/shared/types.ts` 末尾新增：

```ts
export interface TaskCompletionNotificationPayload {
  taskId: string
  localTaskId?: string
  svn_url: string
  old_revision: string
  new_revision: string
  reportPath?: string
  pdfPath?: string
  pdfReportName?: string | null
}

export type TaskCompletionNotificationResult =
  | {
      status: 'shown'
    }
  | {
      status: 'unsupported'
    }
  | {
      status: 'failed'
      message: string
    }
```

- [ ] **Step 4: 更新 renderer API 类型**

在 `code_review_electron/src/renderer/src/code-review-api.ts` 的 shared imports 中引入：

```ts
import type {
  TaskCompletionNotificationPayload,
  TaskCompletionNotificationResult
} from '../../../shared/types'
```

如果该文件已经从 `../../../shared/types` 引入其他类型，把这两个类型合并到现有 import。

在 `CodeReviewApi` interface 中加入：

```ts
  showTaskCompletionNotification(
    payload: TaskCompletionNotificationPayload
  ): Promise<TaskCompletionNotificationResult>
  onTaskCompletionNotificationClicked(
    callback: (payload: TaskCompletionNotificationPayload) => void
  ): () => void
```

并从该文件导出类型：

```ts
export type {
  TaskCompletionNotificationPayload,
  TaskCompletionNotificationResult
} from '../../../shared/types'
```

- [ ] **Step 5: 更新 preload 暴露方法**

在 `code_review_electron/src/preload/index.ts` 的类型 import 中加入：

```ts
  TaskCompletionNotificationPayload,
  TaskCompletionNotificationResult,
```

在 `contextBridge.exposeInMainWorld('codeReview', {` 的对象参数中加入：

```ts
  showTaskCompletionNotification: (
    payload: TaskCompletionNotificationPayload
  ): Promise<TaskCompletionNotificationResult> =>
    ipcRenderer.invoke('notification:show-task-completed', payload),
  onTaskCompletionNotificationClicked: (
    callback: (payload: TaskCompletionNotificationPayload) => void
  ): (() => void) => listen('notification:task-completed-clicked', callback),
```

- [ ] **Step 6: 运行 preload 测试确认通过**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/preload/index.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交 Task 1**

```bash
git add code_review_electron/src/shared/types.ts \
  code_review_electron/src/renderer/src/code-review-api.ts \
  code_review_electron/src/preload/index.ts \
  code_review_electron/src/preload/index.test.ts
git commit -m "添加审查完成通知预加载接口"
```

---

### Task 2: 主进程系统通知 IPC 与窗口点击回传

**Files:**
- Modify: `code_review_electron/src/main/ipc.ts`
- Test: `code_review_electron/src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: 扩展 electron mock**

在 `code_review_electron/src/main/__tests__/ipc.test.ts` 顶部、现有 `vi.mock('electron', () => ({` 调用前新增 hoisted mock：

```ts
const notificationIsSupportedMock = vi.hoisted(() => vi.fn(() => true))
const notificationShowMock = vi.hoisted(() => vi.fn())
const notificationOnMock = vi.hoisted(() => vi.fn())
```

把 `vi.mock('electron', () => ({` 返回对象中加入：

```ts
  Notification: vi.fn(function NotificationMock() {
    return {
      show: notificationShowMock,
      on: notificationOnMock
    }
  }),
```

为避免函数名作用域问题，推荐把 Notification mock 写成独立常量。把原本内联的 `vi.mock('electron', () => ({` 返回对象改成以下结构，其中 `app`、`dialog`、`BrowserWindow`、`ipcMain`、`shell` 字段使用当前测试文件已有实现：

```ts
const NotificationMock = vi.fn(function NotificationMock() {
  return {
    show: notificationShowMock,
    on: notificationOnMock
  }
})
;(NotificationMock as unknown as { isSupported: typeof notificationIsSupportedMock }).isSupported =
  notificationIsSupportedMock

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/code-review-user-data')
  },
  dialog: {
    showOpenDialog: showOpenDialogMock
  },
  BrowserWindow: vi.fn(function BrowserWindowMock() {
    return {
      loadFile: vi.fn(async () => undefined),
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('%PDF-1.4\nfake-pdf'))
      },
      close: vi.fn()
    }
  }),
  ipcMain: {
    handle: handleMock
  },
  Notification: NotificationMock,
  shell: {
    showItemInFolder: showItemInFolderMock
  }
}))
```

- [ ] **Step 2: 写 IPC 注册顺序失败测试**

更新 `registers only the renderer-facing IPC channels` 的期望数组，在 `app-update:install` 后、`task:list` 前加入：

```ts
      'notification:show-task-completed',
```

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/main/__tests__/ipc.test.ts -t "registers only the renderer-facing IPC channels"
```

Expected: FAIL，实际通道列表还没有 `notification:show-task-completed`。

- [ ] **Step 3: 写系统通知行为失败测试**

在 `ipc.test.ts` 的 `describe('registerIpcHandlers', () => {` 代码块中新增：

```ts
  it('shows task completion notification and sends click event to renderer', async () => {
    const send = vi.fn()
    const restore = vi.fn()
    const show = vi.fn()
    const focus = vi.fn()
    const isMinimized = vi.fn(() => true)
    const isDestroyed = vi.fn(() => false)
    const mainWindow = {
      isMinimized,
      restore,
      show,
      focus,
      webContents: {
        send,
        isDestroyed
      }
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      getMainWindow: () => mainWindow as never
    })

    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'notification:show-task-completed'
    )?.[1]
    const payload = {
      taskId: 'task-1',
      localTaskId: 'local-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12',
      reportPath: '/tmp/report.md'
    }

    await expect(handler({}, payload)).resolves.toEqual({ status: 'shown' })
    expect(notificationShowMock).toHaveBeenCalledWith()
    const clickHandler = notificationOnMock.mock.calls.find(([eventName]) => eventName === 'click')?.[1]
    expect(clickHandler).toBeDefined()

    clickHandler()

    expect(restore).toHaveBeenCalledWith()
    expect(show).toHaveBeenCalledWith()
    expect(focus).toHaveBeenCalledWith()
    expect(send).toHaveBeenCalledWith('notification:task-completed-clicked', payload)
  })

  it('returns unsupported when task completion notification is unavailable', async () => {
    notificationIsSupportedMock.mockReturnValueOnce(false)
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers()

    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'notification:show-task-completed'
    )?.[1]

    await expect(
      handler({}, {
        taskId: 'task-1',
        svn_url: 'svn://repo/project',
        old_revision: 'r10',
        new_revision: 'r12'
      })
    ).resolves.toEqual({ status: 'unsupported' })
    expect(notificationShowMock).not.toHaveBeenCalled()
  })
```

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/main/__tests__/ipc.test.ts -t "task completion notification"
```

Expected: FAIL，`getMainWindow` 依赖和 IPC handler 尚未实现。

- [ ] **Step 4: 实现 IPC 类型和 handler**

在 `code_review_electron/src/main/ipc.ts` 的 electron import 改为：

```ts
import { dialog, ipcMain, Notification, shell, type BrowserWindow } from 'electron'
```

在 shared type import 中加入：

```ts
import type {
  CurrentUser,
  DepartmentsResponse,
  TaskCompletionNotificationPayload,
  TaskCompletionNotificationResult
} from '../shared/types'
```

把原本的 `import type { CurrentUser, DepartmentsResponse } from '../shared/types'` 替换掉。

在 `IpcHandlerDependencies` 中加入：

```ts
  getMainWindow?: () => BrowserWindow | undefined
```

在 `registerIpcHandlers` 内 `appUpdateService` 初始化后加入：

```ts
  const getMainWindow = dependencies.getMainWindow ?? (() => undefined)
```

在 `app-update:install` 和 `task:list` 之间注册：

```ts
  ipcMain.handle(
    'notification:show-task-completed',
    async (
      _event,
      payload: TaskCompletionNotificationPayload
    ): Promise<TaskCompletionNotificationResult> => {
      if (!Notification.isSupported()) {
        return { status: 'unsupported' }
      }

      try {
        const notification = new Notification({
          title: '审查完成',
          body: `${payload.svn_url}\n${payload.old_revision} → ${payload.new_revision}`
        })

        notification.on('click', () => {
          const mainWindow = getMainWindow()
          if (!mainWindow || mainWindow.isDestroyed()) {
            return
          }

          if (mainWindow.isMinimized()) {
            mainWindow.restore()
          }
          mainWindow.show()
          mainWindow.focus()
          sendToRenderer(
            mainWindow.webContents,
            'notification:task-completed-clicked',
            payload
          )
        })

        notification.show()
        return { status: 'shown' }
      } catch (error) {
        return {
          status: 'failed',
          message: error instanceof Error ? error.message : '系统通知发送失败。'
        }
      }
    }
  )
```

- [ ] **Step 5: 运行主进程 IPC 测试确认通过**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/main/__tests__/ipc.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交 Task 2**

```bash
git add code_review_electron/src/main/ipc.ts code_review_electron/src/main/__tests__/ipc.test.ts
git commit -m "添加审查完成系统通知IPC"
```

---

### Task 3: 设置 Windows AppUserModelID 并注入主窗口

**Files:**
- Modify: `code_review_electron/src/main/index.ts`
- Modify: `code_review_electron/src/main/__tests__/main-window-menu.test.ts`

- [ ] **Step 1: 写 AppUserModelID 失败测试**

在 `main-window-menu.test.ts` 第一个测试的 electron mock 中，为 `app` 增加：

```ts
        setAppUserModelId: vi.fn(),
```

并在该测试 `await Promise.resolve()` 后加入：

```ts
    const { app } = await import('electron')
    expect(app.setAppUserModelId).toHaveBeenCalledWith('com.peicheng.code-review')
```

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/main/__tests__/main-window-menu.test.ts -t "clears Electron default application menu"
```

Expected: FAIL，`setAppUserModelId` 未调用。

- [ ] **Step 2: 写 getMainWindow 注入失败测试**

在第一个测试中，把 `registerIpcHandlers` mock 改成 hoisted 变量：

```ts
const registerIpcHandlers = vi.fn()
vi.doMock('../ipc', () => ({
  registerIpcHandlers
}))
```

并添加断言：

```ts
    expect(registerIpcHandlers).toHaveBeenCalledWith({
      getMainWindow: expect.any(Function)
    })
    const getMainWindow = registerIpcHandlers.mock.calls[0][0].getMainWindow
    expect(getMainWindow()).toBeDefined()
```

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/main/__tests__/main-window-menu.test.ts -t "clears Electron default application menu"
```

Expected: FAIL，`registerIpcHandlers` 当前无参数。

- [ ] **Step 3: 实现 mainWindow 保存和注入**

修改 `code_review_electron/src/main/index.ts`：

在 imports 后添加：

```ts
const APP_USER_MODEL_ID = 'com.peicheng.code-review'
let mainWindow: BrowserWindow | undefined
```

把 `createWindow` 内：

```ts
  const mainWindow = new BrowserWindow({
```

改成：

```ts
  mainWindow = new BrowserWindow({
```

对应后续 `configureExternalLinkHandling(mainWindow)` 保持可用。

在 `app.whenReady().then(() => {` 内第一行加入：

```ts
  app.setAppUserModelId(APP_USER_MODEL_ID)
```

把：

```ts
  registerIpcHandlers()
```

改成：

```ts
  registerIpcHandlers({
    getMainWindow: () => mainWindow
  })
```

- [ ] **Step 4: 运行 main 测试确认通过**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/main/__tests__/main-window-menu.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交 Task 3**

```bash
git add code_review_electron/src/main/index.ts code_review_electron/src/main/__tests__/main-window-menu.test.ts
git commit -m "设置Windows通知应用标识"
```

---

### Task 4: 历史任务按完成时间倒序

**Files:**
- Modify: `code_review_electron/src/renderer/src/hooks/useTaskQueue.ts`
- Test: `code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx`

- [ ] **Step 1: 写排序失败测试**

在 `useTaskQueue.test.tsx` 末尾新增：

```ts
  it('历史任务按完成时间倒序展示', () => {
    const { result } = renderHook(() =>
      useTaskQueue({
        executeTask: vi.fn(),
        initialTasks: [
          {
            id: 'task-old',
            svn_url: 'svn://repo/old',
            old_revision: '1',
            new_revision: '2',
            status: 'success',
            finished_at: '2026-06-23T09:00:00.000Z'
          },
          {
            id: 'task-new',
            svn_url: 'svn://repo/new',
            old_revision: '3',
            new_revision: '4',
            status: 'success',
            finished_at: '2026-06-23T10:00:00.000Z'
          }
        ]
      })
    )

    expect(result.current.historyTasks.map((task) => task.id)).toEqual([
      'task-new',
      'task-old'
    ])
  })

  it('历史任务缺少完成时间时用开始时间和本地创建时间兜底排序', () => {
    const { result } = renderHook(() =>
      useTaskQueue({
        executeTask: vi.fn(),
        initialTasks: [
          {
            id: 'task-start-old',
            svn_url: 'svn://repo/old',
            old_revision: '1',
            new_revision: '2',
            status: 'success',
            started_at: '2026-06-23T09:00:00.000Z'
          },
          {
            id: 'task-start-new',
            svn_url: 'svn://repo/new',
            old_revision: '3',
            new_revision: '4',
            status: 'success',
            started_at: '2026-06-23T10:00:00.000Z'
          }
        ]
      })
    )

    expect(result.current.historyTasks.map((task) => task.id)).toEqual([
      'task-start-new',
      'task-start-old'
    ])
  })
```

- [ ] **Step 2: 运行排序测试确认失败**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/renderer/src/hooks/useTaskQueue.test.tsx -t "历史任务"
```

Expected: FAIL，`historyTasks` 当前保持输入顺序。

- [ ] **Step 3: 实现排序函数**

在 `useTaskQueue.ts` 中 `isTerminalStatus` 后新增：

```ts
const taskSortTime = (task: TaskViewItem): number => {
  for (const value of [task.finished_at, task.started_at]) {
    if (!value) {
      continue
    }

    const timestamp = new Date(value).getTime()
    if (!Number.isNaN(timestamp)) {
      return timestamp
    }
  }

  return task.createdAtMs
}
```

把 `historyTasks` useMemo 改为：

```ts
  const historyTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.localQueueState === 'finished')
        .toSorted((left, right) => taskSortTime(right) - taskSortTime(left)),
    [tasks]
  )
```

如果当前 TypeScript target 不支持 `toSorted`，改用：

```ts
        .sort((left, right) => taskSortTime(right) - taskSortTime(left)),
```

但必须先复制数组：

```ts
      [...tasks.filter((task) => task.localQueueState === 'finished')].sort(
        (left, right) => taskSortTime(right) - taskSortTime(left)
      ),
```

- [ ] **Step 4: 运行 hook 测试确认通过**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/renderer/src/hooks/useTaskQueue.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 提交 Task 4**

```bash
git add code_review_electron/src/renderer/src/hooks/useTaskQueue.ts \
  code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx
git commit -m "按完成时间排序历史任务"
```

---

### Task 5: TaskPage 前台提醒、后台系统通知和取消自动切报告

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`
- Test: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`

- [ ] **Step 1: 更新测试 API mock**

在 `TaskPage.test.tsx` 的 `setupCodeReviewApi` 中加入：

```ts
    showTaskCompletionNotification: vi.fn(async () => ({ status: 'shown' })),
    onTaskCompletionNotificationClicked: vi.fn(() => vi.fn()),
```

- [ ] **Step 2: 写“不自动切报告”的失败测试**

在 `TaskPage.test.tsx` 中替换原测试 `点击查看PDF报告时优先打开当前任务本地 PDF` 的前半部分，或新增测试：

```ts
  it('任务完成后不自动切换右侧报告预览', async () => {
    const user = userEvent.setup()
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-local-success',
      status: 'success' as const,
      reportMarkdown: '# 本地报告',
      reportPath: '/app/reports/task-local-success.md',
      pdfPath: '/app/reports/task-local-success.pdf',
      pdfReportName: 'r7_r2审查报告_20260615_143000.pdf'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '7')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('本地报告')).not.toBeInTheDocument()
    expect(await screen.findByText('审查完成')).toBeInTheDocument()
  })
```

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/renderer/src/components/TaskPage.test.tsx -t "任务完成后不自动切换右侧报告预览"
```

Expected: FAIL，当前会自动显示 `本地报告`，且没有应用内提醒。

- [ ] **Step 3: 写前台应用内提醒测试**

新增：

```ts
  it('前台任务完成时显示应用内提醒且不发送系统通知', async () => {
    const user = userEvent.setup()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-notice',
      status: 'success' as const,
      reportMarkdown: '# 完成报告',
      reportPath: '/tmp/done.md'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '8')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    const notice = await screen.findByRole('status', { name: '审查完成提醒' })
    expect(within(notice).getByText('svn://repo/project-8')).toBeInTheDocument()
    expect(within(notice).getByText('80 → 81')).toBeInTheDocument()
    expect(window.codeReview.showTaskCompletionNotification).not.toHaveBeenCalled()
  })
```

Run:

```bash
npm test -- --run src/renderer/src/components/TaskPage.test.tsx -t "前台任务完成"
```

Expected: FAIL，没有提醒 UI。

- [ ] **Step 4: 写后台系统通知测试**

新增：

```ts
  it('后台任务完成时发送系统通知且payload不包含报告正文', async () => {
    const user = userEvent.setup()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-background',
      status: 'success' as const,
      reportMarkdown: '# 后台报告',
      reportPath: '/tmp/background.md',
      pdfPath: '/tmp/background.pdf',
      pdfReportName: '后台审查报告.pdf'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '9')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    await waitFor(() => expect(window.codeReview.showTaskCompletionNotification).toHaveBeenCalledTimes(1))
    expect(window.codeReview.showTaskCompletionNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-background',
        svn_url: 'svn://repo/project-9',
        old_revision: '90',
        new_revision: '91',
        reportPath: '/tmp/background.md',
        pdfPath: '/tmp/background.pdf',
        pdfReportName: '后台审查报告.pdf'
      })
    )
    expect(window.codeReview.showTaskCompletionNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ reportMarkdown: expect.any(String) })
    )
  })
```

- [ ] **Step 5: 写点击应用内提醒打开报告测试**

新增：

```ts
  it('点击应用内提醒查看报告后打开刚完成任务报告', async () => {
    const user = userEvent.setup()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-open-from-notice',
      status: 'success' as const,
      reportMarkdown: '# 提醒打开报告',
      reportPath: '/tmp/notice-report.md'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '10')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    const notice = await screen.findByRole('status', { name: '审查完成提醒' })
    await user.click(within(notice).getByRole('button', { name: '查看报告' }))

    expect(await screen.findByRole('heading', { name: '提醒打开报告' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '审查完成提醒' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 6: 写系统通知失败兜底测试**

新增：

```ts
  it('后台系统通知失败时显示应用内兜底提醒', async () => {
    const user = userEvent.setup()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    window.codeReview.showTaskCompletionNotification = vi.fn(async () => ({
      status: 'unsupported' as const
    }))
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-fallback',
      status: 'success' as const,
      reportMarkdown: '# 兜底报告',
      reportPath: '/tmp/fallback.md'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '11')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(await screen.findByRole('status', { name: '审查完成提醒' })).toBeInTheDocument()
  })
```

- [ ] **Step 7: 写系统通知点击打开报告测试**

新增：

```ts
  it('收到系统通知点击事件后打开对应任务报告', async () => {
    const user = userEvent.setup()
    let notificationClickHandler:
      | ((payload: Parameters<CodeReviewApi['onTaskCompletionNotificationClicked']>[0] extends (payload: infer P) => void ? P : never) => void)
      | undefined
    window.codeReview.onTaskCompletionNotificationClicked = vi.fn((callback) => {
      notificationClickHandler = callback
      return vi.fn()
    })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-clicked',
      status: 'success' as const,
      reportMarkdown: '# 点击通知报告',
      reportPath: '/tmp/clicked.md'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '12')
    await user.click(screen.getByRole('button', { name: '开始审查' }))
    await waitFor(() => expect(window.codeReview.showTaskCompletionNotification).toHaveBeenCalled())

    notificationClickHandler?.({
      taskId: 'task-clicked',
      svn_url: 'svn://repo/project-12',
      old_revision: '120',
      new_revision: '121',
      reportPath: '/tmp/clicked.md'
    })

    expect(await screen.findByRole('heading', { name: '点击通知报告' })).toBeInTheDocument()
  })
```

如果条件类型让测试可读性变差，可先从 `../code-review-api` 引入 `TaskCompletionNotificationPayload`，再声明：

```ts
let notificationClickHandler: ((payload: TaskCompletionNotificationPayload) => void) | undefined
```

- [ ] **Step 8: 实现 TaskPage 提醒状态和前台判断**

在 `TaskPage.tsx` 增加类型：

```ts
type CompletionNotice = {
  task: TaskViewItem
}
```

增加 state：

```ts
  const [completionNotice, setCompletionNotice] = useState<CompletionNotice | null>(null)
```

增加前台判断函数：

```ts
const isRendererForeground = (): boolean =>
  document.visibilityState === 'visible' && document.hasFocus()
```

在组件内部增加通知 payload 构造：

```ts
  const buildNotificationPayload = (task: TaskViewItem) => ({
    taskId: task.id,
    localTaskId: task.localTaskId,
    svn_url: task.svn_url,
    old_revision: task.old_revision,
    new_revision: task.new_revision,
    reportPath: task.report_path,
    pdfPath: task.pdfPath,
    pdfReportName: task.pdf_report_name ?? undefined
  })
```

把 `handleTaskSuccess` 改成：

```ts
  const handleTaskSuccess = useCallback((task: TaskViewItem): void => {
    if (!isMountedRef.current) {
      return
    }

    const showInAppNotice = (): void => {
      if (isMountedRef.current) {
        setCompletionNotice({ task })
      }
    }

    if (isRendererForeground()) {
      showInAppNotice()
      return
    }

    void window.codeReview
      .showTaskCompletionNotification(buildNotificationPayload(task))
      .then((result) => {
        if (result.status !== 'shown') {
          showInAppNotice()
        }
      })
      .catch(() => {
        showInAppNotice()
      })
  }, [])
```

确认删除原本自动切换报告的这些调用：

```ts
setMarkdown(task.reportMarkdown)
setSelectedTaskId(task.id)
selectedTaskIdRef.current = task.id
setActivePdfPath(task.pdfPath)
setActivePdfReportName(task.pdf_report_name ?? undefined)
setCurrentReportPath(task.report_path)
setReportMessage(`报告已生成：${task.report_path}`)
```

- [ ] **Step 9: 实现提醒点击和系统通知点击**

在 `TaskPage.tsx` 增加：

```ts
  const findTaskForNotification = useCallback(
    (payload: { taskId: string; localTaskId?: string }): TaskViewItem | undefined =>
      [...runningTasks, ...queuedTasks, ...historyTasks].find(
        (task) => task.id === payload.taskId || task.localTaskId === payload.localTaskId
      ),
    [historyTasks, queuedTasks, runningTasks]
  )
```

在 `handleOpenPdfReport` 前增加：

```ts
  const handleOpenCompletionNotice = useCallback(
    (task: TaskViewItem): void => {
      setCompletionNotice(null)
      void handleViewReport(task)
    },
    [handleViewReport]
  )
```

如果 `handleViewReport` 是函数声明而不是 useCallback，应先把它改成 `useCallback`，依赖包括 `setActivePdfPath`、`setActivePdfReportName`、`updateSelectedTaskId`。

增加系统通知点击订阅：

```ts
  useEffect(() => {
    return window.codeReview.onTaskCompletionNotificationClicked((payload) => {
      const task = findTaskForNotification(payload)
      if (!task) {
        return
      }
      setCompletionNotice(null)
      void handleViewReport(task)
    })
  }, [findTaskForNotification, handleViewReport])
```

- [ ] **Step 10: 实现应用内提醒 JSX**

在 `SubmitFeedbackDialog` 前加入：

```tsx
      {completionNotice && (
        <aside className="completion-notice" role="status" aria-label="审查完成提醒">
          <div>
            <p className="completion-notice-title">审查完成</p>
            <p className="completion-notice-url">{completionNotice.task.svn_url}</p>
            <p className="completion-notice-revisions">
              {completionNotice.task.old_revision} → {completionNotice.task.new_revision}
            </p>
          </div>
          <div className="completion-notice-actions">
            <button
              className="task-action-button"
              type="button"
              onClick={() => handleOpenCompletionNotice(completionNotice.task)}
            >
              查看报告
            </button>
            <button
              className="task-action-button"
              type="button"
              onClick={() => setCompletionNotice(null)}
            >
              关闭
            </button>
          </div>
        </aside>
      )}
```

- [ ] **Step 11: 增加 CSS**

在 `styles.css` 的 `.task-action-button` 附近加入：

```css
.completion-notice {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 30;
  display: grid;
  gap: 12px;
  width: min(360px, calc(100vw - 48px));
  border: 1px solid rgb(18 185 120 / 42%);
  border-radius: 8px;
  padding: 14px;
  color: #f5f7fb;
  background: #111418;
  box-shadow: 0 18px 48px rgb(0 0 0 / 38%);
}

.completion-notice-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 800;
}

.completion-notice-url,
.completion-notice-revisions {
  margin: 0;
  color: rgb(245 247 251 / 68%);
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.completion-notice-revisions {
  margin-top: 4px;
  color: #b9e8ff;
}

.completion-notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

- [ ] **Step 12: 更新 PDF 测试旧行为**

把旧测试 `点击查看PDF报告时优先打开当前任务本地 PDF` 中：

```ts
    await screen.findByText('本地报告')
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
```

替换为：

```ts
    const notice = await screen.findByRole('status', { name: '审查完成提醒' })
    await user.click(within(notice).getByRole('button', { name: '查看报告' }))
    await screen.findByText('本地报告')
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
```

- [ ] **Step 13: 运行 TaskPage 测试**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/renderer/src/components/TaskPage.test.tsx
```

Expected: PASS。

- [ ] **Step 14: 提交 Task 5**

```bash
git add code_review_electron/src/renderer/src/components/TaskPage.tsx \
  code_review_electron/src/renderer/src/components/TaskPage.test.tsx \
  code_review_electron/src/renderer/src/styles.css
git commit -m "调整审查完成提醒交互"
```

---

### Task 6: 最终验证与忽略规则提交

**Files:**
- Modify: `../Code_review/.gitignore`

- [ ] **Step 1: 确认未跟踪技能目录被忽略**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform
git status --short --ignored | rg "通用-代码变更审查-模板|\\.gitignore"
```

Expected: 只看到 `../Code_review/.gitignore` 为修改，两个技能目录显示为 `!!` ignored 或不再出现在普通 `git status --short`。

- [ ] **Step 2: 运行 Electron 相关测试**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- --run src/preload/index.test.ts src/main/__tests__/ipc.test.ts src/main/__tests__/main-window-menu.test.ts src/renderer/src/hooks/useTaskQueue.test.tsx src/renderer/src/components/TaskPage.test.tsx
```

Expected: PASS。

- [ ] **Step 3: 运行类型检查**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm run typecheck
```

Expected: PASS。

- [ ] **Step 4: 检查 diff**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；`git status --short` 只包含本次计划内文件。

- [ ] **Step 5: 提交忽略规则和最终收尾**

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform
git add ../Code_review/.gitignore
git commit -m "忽略本地代码审查技能目录"
```

如果 Task 1-5 已经分别提交，本步骤只提交 `.gitignore`。如果执行者选择合并提交，应确保提交信息为中文，并且包含所有计划内文件。

---

## 自查

### Spec 覆盖

- 历史任务按完成时间倒序：Task 4。
- 本机任务成功提醒：Task 5。
- 前台应用内提醒、后台系统通知：Task 5。
- Windows AppUserModelID：Task 3。
- 系统通知 IPC、点击恢复窗口：Task 2。
- preload 和 renderer API 类型：Task 1。
- 不自动切报告、历史任务查看报告保留：Task 5。
- 忽略两个未跟踪技能目录：Task 6。

### 无占位符检查

计划中没有 `TBD`、`TODO`、`implement later`。每个实现任务都有具体文件、测试、代码片段、运行命令和提交命令。

### 类型一致性

- IPC invoke 通道统一为 `notification:show-task-completed`。
- main -> renderer 事件通道统一为 `notification:task-completed-clicked`。
- payload 类型统一为 `TaskCompletionNotificationPayload`。
- result 类型统一为 `TaskCompletionNotificationResult`。
