# Electron 审查完成提醒与历史排序设计

## 背景

Electron 客户端的任务看板分为运行中、等待中、历史任务。当前历史任务的实际顺序来自两处：

- 服务端 `GET /review-tasks` 按 `created_at desc` 返回任务。
- Electron 客户端 `useTaskQueue` 将 `localQueueState === "finished"` 的任务直接过滤为历史任务，不额外排序。

因此，历史任务当前主要按“创建时间倒序”展示；本地刚完成的任务则保留在客户端任务数组中的原位置。用户期望“最新生成的报告”显示在历史任务最上方，更准确的排序字段应该是 `finished_at desc`。

另一个场景是：用户点击“开始审查”后会最小化 Electron 客户端。任务完成时，应用内提示不可见，因此需要系统级通知来提醒用户。提醒只针对本机本次发起的任务，不对打开页面时加载到的历史成功任务弹出。

## 目标

1. 历史任务按最新完成时间倒序展示，最新生成报告在最上方。
2. 用户本机本次发起的审查任务成功完成时，弹出系统通知。
3. 通知内容包含历史任务卡片中核心信息：SVN 地址、旧版本、新版本。
4. 用户点击通知后，恢复并聚焦 Electron 窗口，同时打开该任务的审查报告。
5. 系统通知不可用或应用前台可见时，提供应用内右下角提醒作为兜底。
6. Windows 打包环境下通知必须稳定可用，启动时设置 AppUserModelID。
7. 删除任务成功后自动切换右侧报告预览的行为，改为由用户点击通知或提醒中的“查看报告”主动打开。

## 非目标

1. 不提醒服务端刷新出来的历史任务。
2. 不提醒失败、环境异常、取消任务；本期只提醒成功完成。
3. 不做通知中心历史列表。
4. 不做声音、勿扰时间段、用户可配置开关。
5. 不改变服务端任务列表接口排序语义，服务端仍可按创建时间倒序返回。
6. 不移除历史任务卡片中的 `查看报告` 按钮。

## 方案选择

采用“系统通知 + 应用内兜底”方案。

纯应用内右下角弹窗在窗口最小化时不可见，无法满足主要场景。纯渲染层 `Notification` API 对点击行为、权限和平台兼容控制较弱。Electron 主进程的系统通知更适合后台和最小化场景；应用内提示作为补充，用于通知不可用、通知发送失败或应用本身处于前台时的清晰反馈。

## 历史任务排序设计

排序位置放在 Electron 客户端 `useTaskQueue`。

规则：

1. `historyTasks` 只包含 `localQueueState === "finished"` 的任务。
2. 历史任务按完成时间倒序。
3. 排序时间优先级：
   - `finished_at`
   - `started_at`
   - `createdAtMs`
4. 时间无法解析时按 `createdAtMs` 兜底。
5. 排序只影响历史任务视图，不影响运行中任务和等待中任务。

这样可以覆盖两类任务：

- 服务端加载的历史成功任务：使用后端持久化的 `finished_at`。
- 本机刚完成的任务：`useTaskQueue` 已在成功完成时写入 `finished_at`，会立即排到历史任务顶部。

## 系统通知设计

### 触发范围

只在本机本次发起的任务成功完成时触发。具体触发点在 `useTaskQueue` 的本地 `executeTask` 成功回调中，也就是当前已经调用 `onTaskSuccess` 的位置。

不在 `setServerTasks` 中触发通知，避免应用启动或刷新任务列表时对历史成功任务弹窗。

任务成功后不再自动切换右侧报告预览。`TaskPage` 当前的成功回调同时承担“自动切换报告”和“后续通知触发点”的角色；本期将它收敛为只处理完成提醒，不直接 `setMarkdown`、`setSelectedTaskId`、`setCurrentReportPath`。

设计要求：

1. 本机任务成功后始终执行提醒逻辑。
2. 任务完成不会自动覆盖用户正在查看的模板或历史报告。
3. 用户点击系统通知或应用内提醒的 `查看报告` 后，才打开刚完成任务报告。
4. 历史任务卡片中的 `查看报告` 继续保留，并复用同一套 `handleViewReport(task)` 逻辑。

### 通知内容

标题：

- `审查完成`

正文：

- 第一行显示 SVN 地址。
- 第二行显示版本范围，例如 `r12 → r14`。

通知携带任务上下文：

- `taskId`
- `localTaskId`
- `svn_url`
- `old_revision`
- `new_revision`
- `reportPath`
- `pdfPath`
- `pdfReportName`

通知 payload 不携带 `reportMarkdown`。报告正文可能较大，不应通过 renderer -> main -> renderer 来回复制。点击通知后，渲染层按 `taskId/localTaskId` 从当前任务状态中查找任务对象，再复用现有报告打开逻辑；如果任务状态中没有报告正文，则回退到按任务 ID 读取服务端报告。

## Windows 通知前置条件

当前项目使用 Electron + `electron-builder` NSIS 打包，`package.json` 中 `build.appId` 为 `com.peicheng.code-review`。Windows 系统通知依赖 AppUserModelID；在 NSIS 场景下不能只依赖打包配置，主进程启动时需要显式调用：

- `app.setAppUserModelId("com.peicheng.code-review")`

调用位置放在 `main/index.ts` 的应用启动阶段，早于发送任何系统通知。这样 Windows 通知在安装包环境下能以正确应用身份展示，并降低通知被系统静默丢弃或显示为 Electron 的风险。

## IPC 与数据流

### 渲染层到主进程

在 preload 暴露一个新方法，例如：

- `showTaskCompletionNotification(payload)`

payload 包含通知展示所需文本和点击后定位任务所需的任务 ID。

渲染层在本地任务成功完成后调用该方法。调用失败时不影响任务成功状态，只显示应用内兜底提醒。

新增 IPC 需要同步更新三层：

- `main/ipc.ts`：注册 `ipcMain.handle("notification:task-completed", ...)`。
- `preload/index.ts`：暴露 `window.codeReview.showTaskCompletionNotification` 和 `window.codeReview.onTaskCompletionNotificationClicked`。
- `renderer/src/code-review-api.ts`：补充 `CodeReviewApi` 类型、通知 payload/result 类型。

`ipc.test.ts` 对 renderer-facing IPC 通道顺序有硬编码断言，新增 invoke 通道时必须同步更新断言。

### 主进程通知

主进程收到 payload 后：

1. 检查 `Notification.isSupported()`。
2. 创建 Electron `Notification`。
3. `show()` 系统通知。
4. 监听通知 `click` 事件。
5. 点击后恢复窗口：
   - 如果窗口最小化，调用 `restore()`。
   - 调用 `show()` 和 `focus()`。
6. 通过 `webContents.send("task:completion-notification-clicked", payload)` 通知渲染层打开对应报告。

如果系统通知不支持或发送失败，主进程返回失败结果，渲染层显示应用内兜底提醒。

通知点击事件来自系统，不带 IPC `event.sender`。主进程必须能独立拿到主窗口句柄。设计要求：

- `main/index.ts` 保存当前 `mainWindow`。
- `registerIpcHandlers` 增加依赖注入项 `getMainWindow: () => BrowserWindow | undefined`。
- 通知点击时通过 `getMainWindow()` 获取窗口，执行恢复、显示、聚焦和 `webContents.send`。
- 测试中注入假的窗口对象，避免依赖 `BrowserWindow.getAllWindows()` 这种不可控全局状态。

### 主进程到渲染层

preload 增加监听方法，例如：

- `onTaskCompletionNotificationClicked(callback)`

渲染层 `TaskPage` 订阅该事件。收到事件后：

1. 找到对应任务。
2. 复用现有 `handleViewReport(task)` 打开报告。
3. 关闭应用内提醒。

如果任务不在当前列表中，后续实现可以选择触发一次 `listTasks()` 刷新后再打开；本期优先打开本地已知任务，因为通知只针对本机本次发起任务。

## 应用内兜底提醒

在 `TaskPage` 中维护一个当前完成提醒状态。

前台/后台判断在渲染层完成，不新增窗口状态查询 IPC。判断规则：

```ts
const isRendererForeground =
  document.visibilityState === "visible" && document.hasFocus()
```

该规则用于决定优先提醒方式：

- `isRendererForeground === true`：应用当前在前台，优先显示应用内右下角提醒。
- `isRendererForeground === false`：应用最小化、隐藏、后台或失焦，优先请求主进程发送系统通知。

显示规则：

1. 本机任务成功完成后先计算 `isRendererForeground`。
2. 如果应用当前处于前台，显示应用内右下角提醒，不发送系统通知，避免重复打扰。
3. 如果应用最小化或后台，优先显示系统通知。
4. 如果系统通知发送失败，显示应用内右下角兜底提醒。

内容：

- 标题：`审查完成`
- SVN 地址
- 旧版本
- 新版本
- 按钮：`查看报告`、`关闭`

交互：

- 点击 `查看报告`：关闭提醒并调用现有报告打开逻辑。
- 点击 `关闭`：只关闭提醒。
- 多个任务连续完成时，采用最新完成任务覆盖当前提醒，避免堆叠复杂度。

## 组件与边界

### `useTaskQueue`

职责：

- 管理任务队列、运行态、终态。
- 在本机任务成功完成时调用 `onTaskSuccess`。
- 输出已排序的 `historyTasks`。

不负责：

- 不直接调用 Electron 通知 API。
- 不处理通知点击。

### `TaskPage`

职责：

- 接收本地任务成功事件，显示系统通知或应用内提醒。
- 请求主进程发送系统通知。
- 管理应用内兜底提醒状态。
- 处理通知点击事件并打开报告。
- 不再在任务成功时自动切换右侧报告预览。

### 主进程 IPC

职责：

- 发送系统通知。
- 处理系统通知点击。
- 恢复和聚焦窗口。
- 向渲染层广播通知点击事件。
- 通过注入的 `getMainWindow` 获取窗口。

## 错误处理

1. 系统通知不支持：返回失败，渲染层显示应用内兜底提醒。
2. 系统通知发送异常：捕获异常，返回失败，渲染层显示应用内兜底提醒。
3. 通知点击时窗口不存在：忽略点击，不抛出未处理异常。
4. 通知点击后任务找不到：显示普通错误提示或忽略；本期优先保持不崩溃。
5. 打开报告失败：复用现有 `handleViewReport` 的错误展示。

## 测试设计

### Hook 测试

- 本地任务完成后，`historyTasks` 按 `finished_at desc` 排序。
- 服务端历史任务加载后，`historyTasks` 也按 `finished_at desc` 排序。
- 没有 `finished_at` 的终态任务使用兜底时间排序。

### TaskPage 测试

- 本机任务成功完成后调用 `showTaskCompletionNotification`，payload 包含 SVN 地址和新旧版本。
- 本机任务成功完成后不会自动覆盖当前右侧预览。
- 用户正在查看历史报告时，本机新任务完成仍会显示提醒。
- 前台时显示应用内右下角提醒，不调用系统通知。
- 后台或最小化时调用 `showTaskCompletionNotification`。
- 系统通知失败时显示应用内右下角提醒。
- 点击应用内 `查看报告` 会打开刚完成任务报告。
- 收到主进程通知点击事件后，会打开对应任务报告。
- 服务端 `listTasks()` 加载出的成功历史任务不会触发通知。
- 通知 payload 不包含 `reportMarkdown`。

### 主进程 / preload 测试

- preload 正确暴露通知发送和点击监听 API。
- 主进程收到通知请求后创建系统通知。
- 通知点击后恢复窗口并向渲染层发送点击事件。
- `Notification.isSupported()` 为 false 时返回失败结果。
- `main/index.ts` 启动时调用 `app.setAppUserModelId("com.peicheng.code-review")`。
- `registerIpcHandlers` 使用注入的 `getMainWindow` 处理通知点击。

## 验收标准

1. 用户开始审查后最小化 Electron 客户端，任务成功完成时系统弹出通知。
2. 通知里能看到 SVN 地址、旧版本和新版本。
3. 点击通知后 Electron 窗口恢复并打开该任务报告。
4. 历史任务页最新完成的任务显示在最上方。
5. 打开客户端加载历史任务时不会对旧成功任务弹完成通知。
6. 系统通知不可用时，应用内右下角提醒可用。
7. 任务完成后不会自动切换右侧报告预览。
8. 用户仍可通过历史任务卡片的 `查看报告` 打开历史报告。
