# PDF报告本地优先打开设计

## 背景

当前客户端已经会在任务完成后生成 Markdown 和 PDF，并把两份报告上传到服务端。打包客户端的本地任务工作区位于 `code-review-electron-data/workspaces/{taskId}/`，开发环境则通过同一套 `runtimePaths` 映射到 `.runtime-data/workspaces/{taskId}/`。

现有“查看PDF报告”按钮在没有前端内存态 `localPdfPath` 时，会从服务端下载 PDF，并保存到本地 workspace 的固定文件名 `代码审查报告.pdf`。这会带来两个问题：

- 同一台电脑已经有原始 PDF 时，查看历史任务仍可能额外下载一份固定名 PDF。
- 远程下载下来的文件名没有沿用原报告名，用户看到的名字仍是 `代码审查报告.pdf`。

## 目标

- “查看PDF报告”文案保持不变。
- 同一台电脑优先打开已经存在于本地 workspace 的原始 PDF，不重复下载。
- 本地缺失 PDF 或换电脑登录时，再从服务端下载 PDF。
- 服务端下载到本地的 PDF 文件名优先使用任务的 `pdf_report_name`，与原报告名一致。
- 打开行为仍使用 `shell.showItemInFolder(pdfPath)`，打开 PDF 所在文件夹并选中文件，不直接打开 PDF 阅读器。

## 非目标

- 不改变报告生成流程。
- 不改变 Markdown 预览逻辑。
- 不新增 UI 按钮或改动“查看PDF报告”文案。
- 不引入本地 `taskId -> pdfPath` 索引文件。

## 设计

采用本地 workspace 优先策略。客户端点击“查看PDF报告”时，主进程按以下顺序处理：

1. 如果渲染进程传入 `localPdfPath`，先校验文件存在。
   - 存在：直接 `showItemInFolder(localPdfPath)` 并返回。
   - 不存在：继续走本地 workspace 推导和服务端下载兜底。
2. 如果有 `taskId` 和 `pdf_report_name`，使用 `runtimePaths.workspaceForTask(taskId)` 拼出本地 PDF 路径。
   - 路径为 `{workspace}/{pdf_report_name}`。
   - 文件存在：直接 `showItemInFolder(pdfPath)` 并返回。
   - 文件不存在：继续服务端下载。
3. 从服务端下载 PDF。
   - 保存目录仍是当前环境的 `runtimePaths.workspaceForTask(taskId)`。
   - 文件名优先用 `pdf_report_name`。
   - 如果 `pdf_report_name` 缺失，再 fallback 到 `代码审查报告.pdf`。
   - 保存后 `showItemInFolder(pdfPath)` 并返回。

渲染进程需要在调用 `openPdfReport` 时传入当前任务的 `pdf_report_name`。历史任务从服务端列表加载时已经包含 `pdf_report_name` 字段，前端不需要额外接口。

## 数据流

新任务完成：

1. Codex 生成 Markdown。
2. 客户端生成 PDF。
3. 客户端上传 Markdown 和 PDF。
4. 服务端保存 `pdf_report_name`。
5. 前端内存态保留 `pdfPath`，本次会话内点击“查看PDF报告”可直接打开本地文件。

历史任务查看：

1. 前端从任务列表拿到 `taskId` 和 `pdf_report_name`。
2. 用户点击“查看PDF报告”。
3. 主进程先在当前环境 workspace 中查 `{taskId}/{pdf_report_name}`。
4. 命中则打开本地文件位置。
5. 未命中则下载服务端 PDF，并按 `pdf_report_name` 保存到 workspace。

## 错误处理

- 没有 `taskId`：提示“请先选择一个已完成任务报告。”
- 本地路径存在但文件不可访问：继续尝试 workspace 推导或服务端下载，不直接失败。
- 服务端返回 404：保持当前提示“该历史任务没有 PDF 报告，请查看 Markdown 或重新生成报告。”
- 服务端下载成功但 `pdf_report_name` 缺失：保存为 `代码审查报告.pdf`。

## 测试计划

- Electron 主进程 IPC 测试：
  - 有 `localPdfPath` 且文件存在时不调用下载接口。
  - `localPdfPath` 缺失但 workspace 中存在 `{pdf_report_name}` 时不调用下载接口。
  - workspace 中不存在 PDF 时调用服务端下载，并以 `pdf_report_name` 保存。
  - `pdf_report_name` 缺失时 fallback 到 `代码审查报告.pdf`。
- Electron 渲染层测试：
  - 历史任务点击“查看PDF报告”时传入 `taskId` 和 `pdf_report_name`。
  - UI 文案仍为“查看PDF报告”。
- 回归测试：
  - 新任务刚完成后仍优先打开本地生成的 PDF。
  - 旧历史任务没有 PDF 时仍展示原 404 友好提示。
