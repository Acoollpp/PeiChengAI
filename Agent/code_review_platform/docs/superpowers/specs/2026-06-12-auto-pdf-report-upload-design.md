# 自动生成并上传 PDF 报告设计

## 背景

当前 Electron 客户端在 Codex 生成 Markdown 审查报告后，只把 Markdown 上传到服务端。报告中引用的图片保存在本机任务工作区的 `images/` 目录，其他人在服务端或另一台电脑查看历史任务时只能拿到 Markdown 文本，图片资源会缺失。

测试分支 `codex/test-local-pdf-report-generation` 已验证：客户端可以把 Markdown 转为 PDF，且相对路径图片会内联到 PDF 中，生成速度可以接受。该测试分支仅作为参考，不合并到 `main`。

## 目标

1. 正式功能从 `main` 独立开发，最终合并到 `main`。
2. Electron 客户端在 Markdown 生成后自动生成 PDF。
3. Markdown 和 PDF 都上传到服务端；PDF 是跨设备、跨人员审查的完整交付件。
4. Electron 客户端右侧按钮从“查看报告位置”调整为“查看PDF报告”。
5. 用户在另一台电脑登录客户端并点击历史任务时，Markdown 仍用于右侧预览；点击“查看PDF报告”时从服务端下载 PDF 到本机缓存并打开。
6. 服务端 Web 任务列表增加下载 PDF 报告能力。

## 非目标

1. 不把测试分支的临时样例、手动按钮逻辑和未整理改动直接合并。
2. 不在本次改造中上传 Markdown 引用的原始图片文件。
3. 不把右侧 Markdown 预览改成 PDF 预览；右侧仍显示 Markdown。
4. 不生成 Word 文档。
5. 不改变现有任务权限模型。

## 任务成功规则

新任务必须同时满足以下条件才算成功：

1. Codex 生成非空 Markdown。
2. 客户端成功把 Markdown 转为 PDF。
3. 客户端成功上传 Markdown 和 PDF。

如果 Markdown 已生成但 PDF 生成失败，任务状态应为 `failed`，错误信息说明 PDF 生成失败。这样避免任务显示成功但缺少主要交付物。

## 数据模型

服务端 `ReviewTask` 新增两个可空字段：

- `pdf_report_path: str | None`
- `pdf_report_name: str | None`

`report_path` 和 `report_name` 继续表示 Markdown 报告。旧任务没有 PDF 字段时仍可读取 Markdown，但 PDF 下载入口返回 404。

需要新增 Alembic 迁移，为 `review_task` 表添加上述两列。

## 服务端 API

保留现有接口：

- `POST /api/v1/review-tasks/{task_id}/report` 上传 Markdown 报告。
- `GET /api/v1/review-tasks/{task_id}/report` 读取 Markdown 文本。
- `GET /api/v1/review-tasks/{task_id}/download` 下载 Markdown。

新增接口：

- `POST /api/v1/review-tasks/{task_id}/pdf-report` 上传 PDF。
- `GET /api/v1/review-tasks/{task_id}/pdf/download` 下载 PDF。

PDF 上传只接受非空文件，保存为服务端报告存储目录下的 `<task_id>.pdf`。下载权限复用现有任务读取权限：普通用户只能下载自己的 PDF，管理员和超管可下载全部。

删除任务时同时删除 Markdown 和 PDF 文件。

## Electron 客户端流程

任务执行阶段调整为：

1. 创建任务。
2. 检查环境。
3. 准备工作区。
4. 运行 Codex 生成 Markdown。
5. 校验 Markdown 非空。
6. 调用 PDF 生成器生成同目录 PDF。
7. 上传 Markdown。
8. 上传 PDF。
9. 读取 Markdown 并返回给前端预览。

PDF 输出路径沿用测试分支逻辑：`代码审查报告.md` 旁生成 `代码审查报告.pdf`。

上传阶段仍复用 `uploading_report` 状态，不新增任务状态枚举，避免扩大前端状态展示范围。

## Electron 查看 PDF 行为

右侧按钮改为“查看PDF报告”：

- 当前任务刚在本机生成成功：优先打开本地 PDF 所在位置。
- 历史任务或本机没有 PDF：调用服务端 PDF 下载接口，保存到当前电脑本地运行时目录，再打开文件位置。
- 老任务没有 PDF：提示“该历史任务没有 PDF 报告，请查看 Markdown 或重新生成报告。”

右侧 Markdown 预览继续调用现有 `GET /report`。跨电脑时 Markdown 文本可显示，Markdown 中的相对图片可能缺失；完整图片内容由 PDF 保障。

## 服务端 Web 任务列表

任务列表保留现有打开 Markdown 和下载 Markdown 能力。对于存在 `pdf_report_path` 的任务，额外显示“下载 PDF 报告”按钮，调用新增 PDF 下载接口，文件名使用服务端返回文件名或 `review-task-<id>.pdf`。

旧任务没有 PDF 时不显示 PDF 下载按钮。

## 错误处理

1. PDF 生成失败：Electron 将任务标记为 `failed`，错误提示包含“PDF报告生成失败”。
2. PDF 上传失败：Electron 将任务标记为 `failed`，错误提示包含上传失败原因。
3. 另一台电脑下载 PDF 失败且服务端返回 404：客户端提示该历史任务没有 PDF。
4. 删除任务时删除 PDF 文件失败：和 Markdown 删除失败一致，返回服务端错误，避免数据库记录和文件残留状态不一致。

## 测试策略

1. Electron 单元测试覆盖任务执行链路：Markdown 生成后先生成 PDF，再上传 Markdown 和 PDF；PDF 失败时任务失败。
2. Electron API 客户端测试覆盖 PDF 上传和下载接口。
3. Electron IPC/preload/UI 测试覆盖“查看PDF报告”按钮、本地优先、历史任务下载 PDF、老任务无 PDF 提示。
4. 服务端后端测试覆盖 PDF 上传、下载、权限、删除清理、旧任务 404。
5. 服务端前端测试覆盖任务列表显示 PDF 下载按钮。

## 兼容性

旧任务只包含 Markdown，不做数据回填。新任务开始保存 PDF。正式功能上线后，跨电脑审查以 PDF 为完整报告载体，Markdown 预览作为快速阅读入口。
