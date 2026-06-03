# Electron 任务看板与 Markdown 展示改造设计

## 背景

`code_review_electron` 当前是一个轻量桌面客户端，主要功能是登录、检查本地环境、提交 SVN 代码审查任务、展示任务列表和预览 Markdown 报告。现有任务看板把所有任务放在同一个列表中，并且每个任务卡都会在有 `codex_log` 时展示最近几行 Codex CLI 输出。任务运行过程中，实时日志会让任务看板区域变得拥挤，影响任务摘要和状态阅读。

右侧报告预览当前使用 `markdown.ts` 中的手写 Markdown 子集渲染器，只支持少量标题、列表、表格、加粗和行内代码。用户更喜欢 Cherry Studio 的前端展示方式，但本次目标不是引入完整聊天消息系统，而是把报告阅读体验提升到接近 Cherry Studio 的 Markdown 展示效果。

## 目标

1. 只改造 `code_review_electron` 桌面客户端，不改 Web 管理后台、服务端 API、主进程任务执行和 IPC 协议。
2. 将任务看板改为左右分段按钮切换：`当前任务` 和 `历史任务`。
3. `当前任务` 显示最近一次提交的任务，成功或失败后仍保留，直到用户提交下一条任务。
4. `历史任务` 显示除当前任务外的任务，并隐藏 Codex CLI 实时日志，保持列表紧凑。
5. 右侧审查报告继续作为单篇报告预览，不改成聊天流或消息块。
6. 将手写 Markdown 渲染替换为成熟 Markdown 渲染链路，增强表格、代码块、链接和排版展示。

## 非目标

1. 不引入 Cherry Studio 的完整消息块模型、Redux 状态体系、聊天会话流或工具调用块。
2. 不修改任务提交、任务进度事件、报告读取、报告下载等主流程接口。
3. 不改造 `code_review_server/frontend` 管理后台。
4. 不新增后端字段或服务端接口。
5. 不在第一版实现复杂 Markdown 功能，例如数学公式、引用源定位、代码块在线编辑或报告目录导航。

## 当前实现约束

当前 renderer 结构如下：

- `TaskPage.tsx` 负责加载任务、提交任务、接收 `onTaskProgress` 事件、读取报告和下载报告。
- `TaskBoard.tsx` 接收 `tasks` 并以同一种卡片渲染所有任务。
- `MarkdownPreview.tsx` 通过 `dangerouslySetInnerHTML` 渲染 `renderMarkdown(markdown)` 输出。
- `markdown.ts` 是手写 Markdown parser，能力有限。
- `ReviewTask` 已包含任务摘要和执行状态所需字段：`id`、`svn_url`、`old_revision`、`new_revision`、`status`、`progress_message`、`error_message`、`codex_log`。

当前 `handleTaskSubmit()` 会把新建任务插入 `tasks` 数组头部，因此 `tasks[0]` 可以作为最近一次提交任务的来源。任务结束后也会通过相同位置更新状态和报告路径。

## 方案选择

本次采用轻量 Cherry 风格方案：

1. 保留当前 Electron + React 本地状态架构。
2. 只在 `TaskBoard` 内做当前任务与历史任务的视图切换。
3. 只升级右侧 Markdown 阅读体验，不引入完整消息系统。
4. 新增少量 Markdown 渲染依赖，例如 `react-markdown` 和 `remark-gfm`。

该方案改动小、风险低，能直接解决任务看板拥挤和报告展示粗糙的问题。

## 任务看板设计

### 分段按钮

`任务看板` 标题下方增加一个左右分段按钮：

- `当前任务`
- `历史任务`

默认选中 `当前任务`。点击按钮只渲染对应内容，不同时展示上下两块。

`TaskBoard` 内部维护本地状态：

```ts
type TaskBoardView = 'current' | 'history'
```

### 当前任务

当前任务定义为 `tasks[0]`，也就是当前任务列表中的最新任务。首次打开客户端并加载历史任务后，服务端返回列表头部的最新任务会显示在 `当前任务`；用户提交新任务后，新任务插入列表头部并替换当前任务。

当前任务卡展示：

- 任务 ID
- SVN 地址
- 旧版本号
- 新版本号
- 当前状态
- 进度消息
- 错误信息
- 成功任务的“查看报告”按钮
- Codex CLI 输出日志

Codex CLI 输出日志只在当前任务视图展示，并放入受控日志区域：

- 固定最大高度。
- 独立滚动。
- 等宽字体。
- 较弱视觉权重。
- 空日志不显示日志框。

任务成功或失败后仍留在当前任务视图，直到用户提交下一条任务。这样用户可以看到刚刚运行完的任务摘要和最终状态。

### 历史任务

历史任务定义为 `tasks.slice(1)`，即排除当前任务后的任务列表。

历史任务卡展示：

- 任务 ID
- SVN 地址
- 旧版本号
- 新版本号
- 状态
- 进度摘要或错误摘要
- 成功任务的“查看报告”按钮

历史任务不展示 `codex_log`，避免历史列表被实时日志或长输出撑乱。历史列表区域独立滚动，单个任务卡保持紧凑高度。

### 空状态

当前任务为空时显示：

```text
暂无当前任务，填写上方表单后开始审查。
```

历史任务为空时显示：

```text
暂无历史任务。
```

加载任务时继续显示现有加载文案，但文案应与当前视图一致，例如：

```text
正在加载任务...
```

## Markdown 展示设计

### 渲染链路

`MarkdownPreview.tsx` 改为使用 React 组件渲染 Markdown：

- `react-markdown` 负责 Markdown 到 React 节点。
- `remark-gfm` 支持 GitHub 风格 Markdown，包括表格、任务列表、删除线和自动链接。
- 自定义组件覆盖 `code`、`pre`、`table`、`a` 等元素，以获得更接近 Cherry Studio 的阅读体验。

`markdown.ts` 的手写 parser 不再作为主渲染器使用。实现完成后可以删除 `markdown.ts` 和 `markdown.test.ts`，或把测试迁移到 `MarkdownPreview` 组件测试。

### 代码块

代码块展示要求：

- 深色代码背景。
- 保留换行和缩进。
- 横向滚动，不撑破右侧报告区域。
- 语言标签如果 Markdown 里有语言名则展示在代码块顶部。
- 第一版不强制实现复制按钮，避免扩大范围。

行内代码继续使用紧凑样式，区别于正文。

### 表格

表格展示要求：

- 表格外层横向滚动。
- 表头使用更明显的背景和字体权重。
- 单元格保留边框和合理 padding。
- 宽表格不能导致右侧面板横向溢出。

### 链接

链接展示要求：

- 使用明显但克制的链接颜色。
- 禁止危险协议，例如 `javascript:`。
- 外链不应让 Electron 当前页面直接导航离开应用。实现时可以优先使用 `window.open` 或 Electron shell 打开；如果本次不改 preload，则至少通过安全 URL 过滤避免危险链接。

### 空报告与错误兜底

没有报告内容时，继续显示空状态：

```text
审查完成后，Markdown 报告会显示在这里。
```

如果 Markdown 渲染组件出现异常，报告区域显示兜底提示：

```text
报告渲染失败，请下载报告查看原始 Markdown。
```

## 数据流

本次不改变任务和报告数据流。

1. 页面加载后，`TaskPage` 调用 `window.codeReview.listTasks()` 获取任务列表。
2. 用户提交任务后，`TaskPage` 创建本地 pending task，并插入 `tasks` 头部。
3. `window.codeReview.onTaskProgress()` 到达时，继续更新匹配任务的状态、进度消息和 `codex_log`。
4. `executeTask()` 返回 `reportMarkdown` 后，右侧 `markdown` 状态更新并展示报告。
5. 点击历史任务或当前任务的“查看报告”时，调用 `readTaskReport(task.id)` 并更新右侧 `markdown`。
6. `selectedTaskId` 继续表示右侧当前查看的报告对应任务。
7. “下载报告”继续使用现有 `downloadCurrentReport()`。

## 组件边界

### TaskPage

`TaskPage` 保持现有职责：

- 任务加载。
- 任务提交。
- 进度事件处理。
- 报告读取。
- 报告下载。
- 将任务数据传给 `TaskBoard`。

不在 `TaskPage` 中维护当前任务和历史任务 tab 状态，避免页面组件承担展示细节。

### TaskBoard

`TaskBoard` 负责：

- 维护当前视图 `current/history`。
- 从 `tasks` 派生当前任务和历史任务。
- 渲染分段按钮。
- 渲染当前任务卡和历史任务列表。
- 控制 Codex 日志只在当前任务视图出现。

如果实现时 `TaskBoard.tsx` 变得过大，可以在同文件内提取小组件，例如 `TaskSummaryCard`、`CurrentTaskCard`、`HistoryTaskCard`，但不强制拆新文件。

### MarkdownPreview

`MarkdownPreview` 负责：

- 空报告状态。
- Markdown 渲染。
- Markdown 元素自定义组件。
- 渲染错误兜底。

样式仍放在 `styles.css`，保持现有工程风格。

## 样式设计

整体仍沿用当前黑色半透明面板风格，不做大面积视觉重构。

任务看板新增样式：

- `.task-board-tabs`
- `.task-board-tab`
- `.task-board-tab.is-active`
- `.current-task-card`
- `.history-task-card`
- `.history-task-list`

Markdown 新增或调整样式：

- `.markdown-preview`
- `.markdown-preview pre`
- `.markdown-preview code`
- `.markdown-preview table`
- `.markdown-preview table-wrapper`
- `.markdown-preview a`
- `.markdown-preview blockquote`

所有新增固定区域都要设置 `min-width: 0`、`overflow: auto` 或横向滚动，避免长 URL、长代码、宽表格撑破布局。

## 错误处理

1. 任务列表加载失败继续使用 `TaskPage` 现有 `error` 展示。
2. 历史报告读取失败继续使用 `TaskPage` 现有 `error` 展示。
3. 当前任务日志为空时不渲染日志区域。
4. 历史任务不渲染日志区域，即使任务对象里存在 `codex_log`。
5. Markdown 渲染异常时只影响报告区域，不影响左侧任务提交和任务看板。

## 测试计划

### 单元测试

新增或调整 renderer 测试：

1. `TaskBoard` 默认显示当前任务 tab。
2. `当前任务` tab 展示 `tasks[0]`，并展示 Codex 日志。
3. 点击 `历史任务` tab 后展示 `tasks.slice(1)`。
4. 历史任务不展示 Codex 日志。
5. 当前任务为空时展示当前任务空状态。
6. 历史任务为空时展示历史任务空状态。
7. `MarkdownPreview` 能渲染标题、列表、表格、代码块和链接。

### 验证命令

在 `code_review_electron` 目录运行：

```bash
npm run typecheck
npm test
```

如新增依赖导致 lockfile 变化，需要确认安装后的构建可通过：

```bash
npm run build
```

### 人工验证

启动 Electron 客户端后验证：

1. 任务看板默认显示当前任务。
2. 当前任务运行时日志只出现在当前任务 tab 内，并且日志区域独立滚动。
3. 切到历史任务后，看不到 Codex CLI 输出。
4. 点击历史任务“查看报告”后，右侧报告正常切换。
5. 包含表格、代码块、长 URL 的报告不会撑破右侧面板。

## 兼容性

本方案不改变服务端 API、不改变 Electron preload 暴露的接口、不改变任务执行命令、不改变报告存储方式。已有任务数据仍按 `ReviewTask` 渲染。若某些历史任务没有 `progress_message`、`error_message` 或 `report_path`，卡片会按字段是否存在决定展示内容。

## 实施顺序建议

1. 安装 Markdown 渲染依赖。
2. 改造 `MarkdownPreview` 并调整 Markdown 样式。
3. 改造 `TaskBoard` 为当前任务/历史任务 tab。
4. 清理或迁移手写 Markdown parser 测试。
5. 补充组件测试。
6. 运行 typecheck、测试和构建验证。
