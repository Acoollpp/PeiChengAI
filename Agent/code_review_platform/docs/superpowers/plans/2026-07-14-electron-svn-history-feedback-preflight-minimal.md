# Electron SVN 历史、原生反馈窗口与 SVN 预检最小实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留已完成的 SVN 历史优化和后端版本契约，以最小原生窗口替换受边界限制的“有帮助”DOM 弹窗，并在工作区准备和 Codex 执行前完成 SVN 路径与版本预检。

**Architecture:** 反馈窗口采用独立 BrowserWindow、preload 和 renderer；表单内容只存在于反馈 renderer 生命周期内，主进程仅保存只读任务上下文并负责 option ID 映射。SVN 预检作为独立模块插入环境检查与工作区准备之间，使用环境检查探测到的 SVN 命令和相同执行环境。

**Tech Stack:** Electron 39、electron-vite 4、React 19、TypeScript 5.9、Vitest、Testing Library、SVN CLI；Python/FastAPI 后端版本契约已完成。

## Global Constraints

- 权威设计为 `docs/superpowers/specs/2026-07-14-electron-svn-history-feedback-preflight-minimal-design.md`。
- 已完成提交 `f05968d`、`8153bc6` 和 `b2b889c` 不重复实现；后端版本契约与 SVN 历史交互必须保留。
- 反馈窗口必须是单实例、非模态、有 `parent`、无全局 `alwaysOnTop`，允许移出主窗口边界。
- 原生关闭和界面取消都销毁窗口，未提交内容直接丢弃；禁止保存、恢复或跨任务同步反馈草稿。
- 同任务重复打开只聚焦；不同任务打开时销毁旧窗口并创建新窗口。
- “没帮助”必须保留，主窗口只能通过 `submitNegativeReportFeedback(taskId)` 提交固定的 `helpful:false` 与 `useful_issues_text:null`。
- 反馈窗口提交候选项 ID 和手工文本；主进程根据当前只读上下文映射候选文本并校验 sender、taskId 和 option ID。
- 预检保持 `checking_environment` 状态；每次 `svn info` 独立超时 30 秒。
- 预检必须发生在 `prepareWorkspace`、需求文件上传、Codex、PDF 和报告上传之前。
- 原始 SVN stderr 只能分类并经专用脱敏后写受控日志，不得直接展示给用户或写入服务端 `error_message`。
- SVN 预检必须使用环境检查探测到的命令（绝对路径或由 PATH 解析的命令名）、相同 PATH/env 和 `shell:false` 的 `spawn(command, args)`；本次不扩展重构其他既有 Windows `shell:true` 命令。
- 公司加密 SVN 在本机 Mac 无法访问；Mac 自动化测试只使用注入 fake，不运行真实公司 SVN 成功用例。真实成功链路在具备 SVN 认证缓存的 Windows 客户端手工验收。
- Electron IPC invoke 通道顺序必须与 `src/main/__tests__/ipc.test.ts` 的全等数组一致；send/listen 事件不进入该数组。
- 所有 spec、plan、报告和 git commit 使用中文。

## 已完成基线

- 后端：除 `old == 0` 全量模式外必须满足 `0 < old < new`；非法范围返回 HTTP 400。
- Electron：SVN 历史最多 3 条；空输入显示历史，非空输入过滤，完全匹配、Escape、Tab 和进入版本字段时收起；列表位于正常文档流。
- Electron 基线：`npm test` 为 30 个测试文件、348 个用例通过。

---

### Task 1: 定义最小反馈窗口共享契约和构建入口

**Files:**
- Create: `code_review_electron/src/shared/report-feedback-window.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Create: `code_review_electron/src/renderer/src/report-feedback-api.ts`
- Create: `code_review_electron/src/preload/report-feedback.ts`
- Create: `code_review_electron/src/preload/report-feedback.test.ts`
- Create: `code_review_electron/src/renderer/feedback.html`
- Create: `code_review_electron/src/renderer/src/report-feedback-main.tsx`
- Modify: `code_review_electron/electron.vite.config.ts`

**Interfaces:**
- Produces: 主窗口打开/负反馈/事件 API；反馈窗口读取上下文、定位、提交和关闭 API；双 preload/renderer 构建入口。
- Consumers: Tasks 2-4。

- [ ] **Step 1: 写专用 preload 失败测试**

断言只暴露四个命令，不存在 `updateDraft`、会话更新或失效订阅：

```ts
expect(Object.keys(api).sort()).toEqual(['close', 'focusAnchor', 'getContext', 'submit'])
await api.getContext()
expect(invokeMock).toHaveBeenCalledWith('report-feedback-window:get-context')
await api.close()
expect(invokeMock).toHaveBeenCalledWith('report-feedback-window:close')
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
cd code_review_electron
npx vitest run src/preload/report-feedback.test.ts
```

Expected: FAIL，因为专用 preload 尚不存在。

- [ ] **Step 3: 定义共享类型**

```ts
export interface ReportFeedbackOption {
  id: string
  text: string
  anchorId: string
}

export interface ReportFeedbackContext {
  taskId: string
  options: ReportFeedbackOption[]
}

export interface OpenReportFeedbackWindowPayload extends ReportFeedbackContext {}

export interface FocusReportFeedbackAnchorPayload {
  taskId: string
  optionId?: string
}

export interface SubmitHelpfulReportFeedbackPayload {
  taskId: string
  selectedOptionIds: string[]
  manualText: string
}

export interface ReportFeedbackSubmittedEvent {
  taskId: string
  usefulIssuesText: string
}
```

主窗口 `CodeReviewApi` 增加：

```ts
openReportFeedbackWindow(payload: OpenReportFeedbackWindowPayload): Promise<true>
submitNegativeReportFeedback(taskId: string): Promise<SubmitReportFeedbackResult>
onReportFeedbackFocusAnchor(callback: (payload: { taskId: string; anchorId?: string }) => void): () => void
onReportFeedbackSubmitted(callback: (payload: ReportFeedbackSubmittedEvent) => void): () => void
```

反馈窗口 `ReportFeedbackWindowApi` 固定为：

```ts
getContext(): Promise<ReportFeedbackContext>
focusAnchor(payload: FocusReportFeedbackAnchorPayload): Promise<true>
submit(payload: SubmitHelpfulReportFeedbackPayload): Promise<ReportFeedbackSubmittedEvent>
close(): Promise<true>
```

- [ ] **Step 4: 实现最小 preload 和 HTML**

`report-feedback.ts` 只调用四个专用 invoke 通道。`feedback.html` 只包含 `#root` 并加载 `/src/report-feedback-main.tsx`，不得加载主应用入口。Task 1 的 renderer 入口只渲染“正在加载反馈窗口...”占位，保证独立构建；Task 2 再替换为正式反馈组件。

- [ ] **Step 5: 配置多入口构建**

使用 `resolve` 为 preload 增加 `report-feedback` input，为 renderer 增加 `feedback` input；保留现有 `index` 入口。

- [ ] **Step 6: 运行测试、类型检查和构建**

```powershell
npx vitest run src/preload/report-feedback.test.ts
npm run typecheck
npm run build
```

Expected: PASS，且存在 `out/preload/report-feedback.mjs`（或 `.js`）和 `out/renderer/feedback.html`。

- [ ] **Step 7: 提交**

```powershell
git add code_review_electron/electron.vite.config.ts code_review_electron/src/shared/report-feedback-window.ts code_review_electron/src/renderer/src/code-review-api.ts code_review_electron/src/renderer/src/report-feedback-api.ts code_review_electron/src/preload/report-feedback.ts code_review_electron/src/preload/report-feedback.test.ts code_review_electron/src/renderer/feedback.html code_review_electron/src/renderer/src/report-feedback-main.tsx
git commit -m "feat: 定义最小反馈窗口契约"
```

### Task 2: 实现无草稿恢复的反馈窗口界面

**Files:**
- Modify: `code_review_electron/src/renderer/src/report-feedback-main.tsx`
- Create: `code_review_electron/src/renderer/src/components/ReportFeedbackWindow.tsx`
- Create: `code_review_electron/src/renderer/src/components/ReportFeedbackWindow.test.tsx`
- Create: `code_review_electron/src/renderer/src/report-feedback.css`

**Interfaces:**
- Consumes: Task 1 的 `window.reportFeedback`。
- Produces: 生命周期完全局限于当前窗口的反馈表单。

- [ ] **Step 1: 写组件失败测试**

覆盖：启动读取上下文、本地勾选、手工文本、空内容禁用提交、option ID 提交、勾选定位、取消清除定位、取消销毁、提交失败保留输入、提交中禁用控件。

关键断言：

```tsx
await user.click(screen.getByRole('checkbox', { name: '空指针风险' }))
expect(api.focusAnchor).toHaveBeenCalledWith({ taskId: 'task-1', optionId: 'option-1' })
expect(api.submit).not.toHaveBeenCalled()

await user.click(screen.getByRole('button', { name: '提交并打开PDF' }))
expect(api.submit).toHaveBeenCalledWith({
  taskId: 'task-1',
  selectedOptionIds: ['option-1'],
  manualText: ''
})
```

- [ ] **Step 2: 运行组件测试确认 RED**

```powershell
npx vitest run src/renderer/src/components/ReportFeedbackWindow.test.tsx
```

Expected: FAIL，因为组件尚不存在。

- [ ] **Step 3: 实现纯本地表单状态**

组件只使用以下 React 状态：`context`、`selectedOptionIds`、`manualText`、`error`、`isSubmitting`。禁止使用 session、draft queue、generation、跨任务 map 或事件订阅。

取消勾选时调用：

```ts
await window.reportFeedback.focusAnchor({ taskId: context.taskId })
```

提交失败只设置错误，不清空本地选择和文本；成功关闭由主进程负责。

- [ ] **Step 4: 实现入口和样式**

入口使用 React StrictMode。样式使用原生标题栏，不设置 `-webkit-app-region: drag`；长文本 `overflow-wrap:anywhere`，操作区固定在内容滚动区外。

- [ ] **Step 5: 运行专用测试、类型检查和构建**

```powershell
npx vitest run src/preload/report-feedback.test.ts src/renderer/src/components/ReportFeedbackWindow.test.tsx
npm run typecheck
npm run build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add code_review_electron/src/renderer/src/report-feedback-main.tsx code_review_electron/src/renderer/src/components/ReportFeedbackWindow.tsx code_review_electron/src/renderer/src/components/ReportFeedbackWindow.test.tsx code_review_electron/src/renderer/src/report-feedback.css
git commit -m "feat: 新增原生反馈窗口界面"
```

### Task 3: 实现反馈 BrowserWindow 与只读上下文管理

**Files:**
- Create: `code_review_electron/src/main/report-feedback-window.ts`
- Create: `code_review_electron/src/main/__tests__/report-feedback-window.test.ts`
- Modify: `code_review_electron/src/main/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `ReportFeedbackContext`。
- Produces: `ReportFeedbackWindowManager`，供 Task 4 IPC 使用。

- [ ] **Step 1: 写窗口管理器失败测试**

覆盖：配置 `parent`、`modal:false`、无 `alwaysOnTop`、同任务 focus、不重复创建、不同任务 destroy 后重建、关闭清上下文、主窗口销毁清理、sender 校验、上下文只读拷贝。

```ts
expect(options.parent).toBe(mainWindow)
expect(options.modal).toBe(false)
expect(options.alwaysOnTop).toBeUndefined()
```

- [ ] **Step 2: 运行测试确认 RED**

```powershell
npx vitest run src/main/__tests__/report-feedback-window.test.ts
```

Expected: FAIL，因为管理器尚不存在。

- [ ] **Step 3: 定义管理器接口**

```ts
export interface ReportFeedbackWindowManager {
  open(context: ReportFeedbackContext): Promise<true>
  getContext(senderId: number): ReportFeedbackContext
  isCurrentSender(senderId: number): boolean
  close(senderId: number): true
  destroy(): void
}
```

管理器只保存 `ReportFeedbackContext | null` 和窗口引用，不保存任何表单字段。

- [ ] **Step 4: 实现窗口生命周期**

窗口固定使用专用 preload；开发环境加载 `${ELECTRON_RENDERER_URL}/feedback.html`，生产加载 `../renderer/feedback.html`。`ready-to-show` 后显示；load 失败时销毁并拒绝 `open()`。

- [ ] **Step 5: 在 main index 注入管理器**

主窗口创建后创建管理器并传给 `registerIpcHandlers`；主窗口关闭和应用退出时调用 `destroy()`。

- [ ] **Step 6: 运行窗口测试、index 相关测试和构建**

```powershell
npx vitest run src/main/__tests__/report-feedback-window.test.ts src/main/__tests__/ipc.test.ts
npm run typecheck
npm run build
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add code_review_electron/src/main/report-feedback-window.ts code_review_electron/src/main/__tests__/report-feedback-window.test.ts code_review_electron/src/main/index.ts
git commit -m "feat: 管理原生反馈窗口生命周期"
```

### Task 4: 接通反馈 IPC、主页面和负反馈专用通道

**Files:**
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Modify: `code_review_electron/src/preload/index.test.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: Tasks 1-3 的契约、UI 和管理器。
- Produces: 完整正反馈窗口流程与固定负反馈流程。

- [ ] **Step 1: 写 IPC 失败测试**

覆盖以下 invoke：

```text
report-feedback:open
report-feedback:submit-negative
report-feedback-window:get-context
report-feedback-window:focus-anchor
report-feedback-window:submit
report-feedback-window:close
```

断言反馈窗口通道必须校验 sender；提交必须校验 taskId、未知/重复 option ID 和空内容。候选按上下文顺序映射，手工文本按行去空去重，最终格式统一为 `1. ...`。

负反馈断言：

```ts
expect(api.submitReportFeedback).toHaveBeenCalledWith(token, 'task-1', {
  helpful: false,
  useful_issues_text: null
})
```

- [ ] **Step 2: 写 TaskPage 失败测试**

覆盖：点击“有帮助”只调用 open；页面不再渲染 DOM 反馈 dialog；打开失败固定显示错误；定位事件滚动对应锚点；提交事件更新任务并打开 PDF；“没帮助”仍工作。

- [ ] **Step 3: 运行 IPC、preload 和页面测试确认 RED**

```powershell
npx vitest run src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/TaskPage.test.tsx
```

Expected: FAIL，因为通道和页面迁移尚未实现。

- [ ] **Step 4: 实现主窗口 preload API**

增加 open、固定负反馈和两个事件订阅；监听清理必须使用相同 channel/listener。删除主窗口可传 `helpful:true` 或任意文本的泛用 `submitReportFeedback`。

- [ ] **Step 5: 实现主进程映射与提交**

正反馈流程：从管理器读取上下文，校验 payload，把 option ID 映射为文本，与 `manualText` 行去重后编号，调用现有服务端 API；成功或 already exists 时通知主窗口并销毁反馈窗口。

定位流程：把 option ID 映射为 anchor ID，再向主窗口发送 `{taskId, anchorId}`；没有 option ID 时发送清除定位事件。

- [ ] **Step 6: 迁移 TaskPage**

删除以下本地状态和逻辑：`selectedUsefulIssues`、`usefulIssuesText`、DOM dialog 可见性、位置、拖动 offset 和 pointer listeners。点击“有帮助”时仅把 `taskId` 与 `extractDetailedHeadingOptions(markdown)` 结果传给 open API。

保留候选项生成、报告锚点定位、提交后任务更新/PDF 打开和“没帮助”。删除 `.report-feedback-dialog*` 等仅供旧 DOM 浮层使用的样式。

- [ ] **Step 7: 运行专用测试和全量测试**

```powershell
npx vitest run src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/TaskPage.test.tsx src/renderer/src/components/ReportFeedbackWindow.test.tsx
npm test
npm run typecheck
npm run build
```

Expected: PASS；代码搜索不存在旧泛用 `report-feedback:submit` 或主窗口 `submitReportFeedback`。

- [ ] **Step 8: 提交**

```powershell
git add code_review_electron/src/main/ipc.ts code_review_electron/src/main/__tests__/ipc.test.ts code_review_electron/src/preload/index.ts code_review_electron/src/preload/index.test.ts code_review_electron/src/renderer/src/code-review-api.ts code_review_electron/src/renderer/src/components/TaskPage.tsx code_review_electron/src/renderer/src/components/TaskPage.test.tsx code_review_electron/src/renderer/src/styles.css
git commit -m "feat: 接通原生报告反馈窗口"
```

### Task 5: 实现独立 SVN 预检模块

**Files:**
- Create: `code_review_electron/src/main/svn-preflight.ts`
- Create: `code_review_electron/src/main/__tests__/svn-preflight.test.ts`
- Modify: `code_review_electron/src/main/environment-checker.ts`

**Interfaces:**
- Produces: `runSvnPreflight(input, dependencies?)`、稳定错误类型、30 秒超时和脱敏诊断。
- Consumers: Task 6。

- [ ] **Step 1: 写参数、命令、超时和分类失败测试**

覆盖空 URL、非数字、`new=0`、相同/反向版本、`r0`、`R12`；新版本先检查、失败后不检查旧版本、全量模式跳过旧版本；认证、权限、路径/版本、网络、启动失败、30 秒超时和 AbortSignal 取消。

```ts
expect(buildSvnInfoArgs('https://svn.example.com/trunk', 'R12')).toEqual([
  'info',
  '--non-interactive',
  '-r',
  '12',
  'https://svn.example.com/trunk'
])
```

- [ ] **Step 2: 运行测试确认 RED**

```powershell
npx vitest run src/main/__tests__/svn-preflight.test.ts
```

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 定义输入和稳定错误类型**

```ts
export interface SvnPreflightInput {
  svnUrl: string
  oldRevision: string
  newRevision: string
  svnCommand: string
  commandOptions: SpawnOptionsWithoutStdio
  signal?: AbortSignal
}

export type SvnPreflightErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_REVISION_ORDER'
  | 'NEW_REVISION_UNAVAILABLE'
  | 'OLD_REVISION_UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'NETWORK_FAILED'
  | 'TIMEOUT'
  | 'CLI_START_FAILED'
  | 'CANCELLED'
```

- [ ] **Step 4: 实现校验与命令执行**

版本使用 `/^[rR]?\d+$/` 和 `BigInt`；每个 `svn info` 使用参数数组、独立 30 秒 timer 和 AbortSignal listener，settle 后清理 timer/listener，超时或取消调用 `child.kill()`。

- [ ] **Step 5: 实现错误分类和脱敏**

识别常见 SVN 错误码和文本；未知非零退出按当前检查对象映射为 NEW/OLD unavailable。`sanitizeSvnDiagnostic` 必须移除 URL 凭据、完整 SVN URL、本地绝对路径及 username/password/token 等敏感字段。

- [ ] **Step 6: 复用环境命令 options**

在 `environment-checker.ts` 导出 `buildDirectCommandOptions()`：复用现有 PATH/env 和 `windowsHide`，但固定 `shell:false`。预检调用方使用该函数；预检模块还必须防御性覆盖误传的 `shell:true`。不得复制 PATH 逻辑或注入服务端 SVN 账号密码。

- [ ] **Step 7: 运行测试和类型检查**

```powershell
npx vitest run src/main/__tests__/svn-preflight.test.ts src/main/__tests__/environment-checker.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 8: 提交**

```powershell
git add code_review_electron/src/main/svn-preflight.ts code_review_electron/src/main/__tests__/svn-preflight.test.ts code_review_electron/src/main/environment-checker.ts
git commit -m "feat: 新增 SVN 地址与版本预检"
```

### Task 6: 在工作区准备前接入 SVN 预检

**Files:**
- Modify: `code_review_electron/src/main/task-agent.ts`
- Modify: `code_review_electron/src/main/__tests__/task-agent.test.ts`
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/main/svn-report-name-resolver.ts`
- Modify: `code_review_electron/src/main/__tests__/svn-report-name-resolver.test.ts`

**Interfaces:**
- Consumes: Task 5 的预检和 `EnvironmentCheckResult.svnPath`。
- Produces: 环境检查后、工作区前的失败短路；报告名解析使用相同 SVN 命令。

- [ ] **Step 1: 写顺序和失败短路测试**

成功顺序必须包含：

```ts
expect(calls).toEqual([
  'status:checking_environment',
  'checkEnvironment',
  'preflight',
  'prepareWorkspace',
  'runCodex',
  'generatePdfReport',
  'uploadReport',
  'uploadPdfReport'
])
```

失败用例断言 `prepareWorkspace`、需求上传、Codex、PDF、报告上传均未调用；另覆盖 ready 无 `svnPath`、反向历史任务重试、预检期间取消。

- [ ] **Step 2: 运行 task-agent 测试确认 RED**

```powershell
npx vitest run src/main/__tests__/task-agent.test.ts -t "preflight|runs codex|retries"
```

Expected: FAIL，现有流程直接进入工作区准备。

- [ ] **Step 3: 扩展依赖并插入预检**

`TaskAgentDependencies` 增加 `preflightSvn`。环境 ready 且存在 `svnPath` 后 emit `checking_environment / 校验 SVN 地址和版本`，调用预检并再次检查取消，然后才 emit `preparing_workspace`。

- [ ] **Step 4: 增加用户错误映射**

固定消息至少包含：

```ts
NEW_REVISION_UNAVAILABLE: `新版本 ${task.new_revision} 在该 SVN 地址下不存在或不可访问。`
OLD_REVISION_UNAVAILABLE: `旧版本 ${task.old_revision} 在该 SVN 地址下不存在或不可访问。`
AUTHENTICATION_FAILED: 'SVN 认证失败，请先在本机 SVN 客户端更新登录凭据。'
TIMEOUT: 'SVN 地址或版本校验超时，请检查网络后重试。'
```

专用错误消息不得再次经过通用 `sanitizeErrorSummary`。

- [ ] **Step 5: 统一报告名解析命令来源**

`svn-report-name-resolver` 输入增加必填 `svnCommand`，生产路径传环境检查探测到的 `svnPath`；删除硬编码 `spawn('svn', ...)`。报告名解析继续复用既有 `buildVersionCommandOptions()`，本次 direct-spawn 收紧只作用于接收用户 URL 的新预检模块。

- [ ] **Step 6: 运行 agent、resolver、IPC 和全量测试**

```powershell
npx vitest run src/main/__tests__/task-agent.test.ts src/main/__tests__/svn-report-name-resolver.test.ts src/main/__tests__/ipc.test.ts
npm test
npm run typecheck
```

Expected: PASS；失败短路用例不存在工作区、Codex 或报告调用。

- [ ] **Step 7: 提交**

```powershell
git add code_review_electron/src/main/task-agent.ts code_review_electron/src/main/__tests__/task-agent.test.ts code_review_electron/src/main/ipc.ts code_review_electron/src/main/svn-report-name-resolver.ts code_review_electron/src/main/__tests__/svn-report-name-resolver.test.ts
git commit -m "feat: 在任务准备前执行 SVN 预检"
```

### Task 7: 完整验证、范围审计与发布说明

**Files:**
- Modify: `code_review_server/release-notes.md`
- Verify only: 其余文件；只修复由验证暴露且属于本计划范围的问题。

**Interfaces:**
- Consumes: Tasks 1-6 和既有后端/历史实现。
- Produces: 可构建、可回归、范围收敛的最终分支。

- [ ] **Step 1: 运行后端版本契约目标测试**

```powershell
cd code_review_server/backend
POSTGRES_SERVER=127.0.0.1 POSTGRES_PORT=15543 POSTGRES_DB=app_test POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres_test .venv/bin/pytest tests/api/routes/test_review_tasks.py -k "reverse_revision_range or zero_new_revision or same_revision" -q
```

Expected: PASS。

- [ ] **Step 2: 运行 Electron 完整验证**

```powershell
cd code_review_electron
npm test
npm run typecheck
npm run build
```

Expected: 全部 PASS；构建包含主 renderer、反馈 renderer 和两个 preload。

- [ ] **Step 3: 审计过度设计已移除**

```powershell
rg -n "updateDraft|selectedOptionIds.*Map|稍后提交|session-updated|report-feedback:submit" code_review_electron/src
```

Expected: 不存在反馈草稿更新、稍后提交、会话同步和旧泛用主窗口提交通道；`selectedOptionIds` 只出现在反馈窗口本地状态、提交 payload 和校验测试中。

- [ ] **Step 4: 审计预检顺序和命令来源**

```powershell
rg -n "preflightSvn|prepareWorkspace|spawn\('svn'" code_review_electron/src/main
```

Expected: task-agent 中预检位于 workspace 前；报告名解析无硬编码 `spawn('svn', ...)`。

- [ ] **Step 5: 更新发布说明**

记录三项用户可见变更：SVN 历史不遮挡字段；“有帮助”窗口可移出客户端且关闭丢弃未提交内容；SVN 地址/版本错误会在 Codex 前停止。保留后端先发布、Electron 后发布的顺序说明。

- [ ] **Step 6: 提交发布说明**

```powershell
git add code_review_server/release-notes.md
git commit -m "docs: 更新 SVN 预检与反馈窗口说明"
```

- [ ] **Step 7: 最终人工验收清单**

- Windows 窗口化主客户端中，把反馈窗口拖到主窗口外，主报告仍可滚动查看。
- 关闭反馈窗口后重新打开，之前未提交选择和文本为空。
- 同任务重复点击聚焦窗口，不重复创建；另一任务打开时替换旧窗口。
- “没帮助”仍提交成功。
- 错误新版本、错误旧版本、不可访问 SVN URL 均在工作区和 Codex 前停止，不生成报告。
- 在具备当前 Windows 用户 SVN 认证缓存的 Windows 客户端上，合法公司 SVN URL 和版本可通过预检并继续任务；Mac 上真实访问失败不计为代码回归。

- [ ] **Step 8: 生成全分支差异包并执行最终代码评审**

使用分支 merge-base 到 HEAD 的完整 diff；Critical/Important 必须修复并复审，Minor 记录后统一决策。
