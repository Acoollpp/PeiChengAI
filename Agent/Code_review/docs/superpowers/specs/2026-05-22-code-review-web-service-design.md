# Codex 代码审查 Web 服务设计

## 目标

实现一个公司内网使用的代码审查 Web 服务。可信员工通过浏览器填写固定字段，服务端校验字段后与固定 Prompt 模板拼接，调用服务器上的 Codex CLI，并触发当前工作区已有的 `skills/通用-代码变更审查` skill。Codex 生成 Markdown 审查报告后，用户可以在前端预览报告，也可以下载原始 `.md` 文件。

第一版先在当前 Windows 工作目录中开发验证，后续应能迁移到服务器部署。

## 范围

MVP 包含：

- 通过 Web 表单提交代码审查任务。
- 必填字段：SVN 项目路径、旧版本号、新版本号。
- 可选字段：提交人，用于后续统计使用次数。
- 使用 SQLite 保存任务元数据。
- 使用本地后台 Worker 处理任务。
- 调用 Codex CLI，依赖服务器系统账号已经配置好的 SVN 凭据。
- 将最终 Markdown 报告保存到服务端控制的报告目录。
- 在浏览器中预览 Markdown 报告并下载原始 `.md` 文件。
- 前端通过轮询查询任务状态。
- 自动清理 90 天前的任务记录、报告文件和临时工作目录。

MVP 不包含：

- 登录和用户权限系统。
- Redis、RQ、Celery 或 BullMQ。
- 浏览器实时查看 Codex 执行日志。
- 用户填写 SVN 账号密码。
- 用户自定义报告输出路径。

## 总体架构

MVP 使用 `FastAPI 单体服务 + SQLite 任务表 + 本地后台 Worker + Markdown 文件存储`。

模块边界：

- Web 前端：任务提交表单、状态显示、Markdown 预览、报告下载、最近任务列表。
- API 层：校验输入、创建任务、返回任务状态和报告内容。
- 任务存储：SQLite 保存任务元数据、状态、输入字段、时间戳、错误摘要和报告路径。
- 后台 Worker：领取待处理任务，拼接 Prompt，调用 Codex CLI，更新任务状态。
- 报告存储：Markdown 文件写入 `data/reports/<task_id>.md`。
- 临时工作目录：每个任务使用 `data/workspaces/<task_id>/`。
- 清理任务：删除 90 天前的任务记录和文件。

API 和前端只依赖任务状态，不依赖具体队列实现。这样后续从 SQLite 轮询升级到 Redis/RQ 或 Celery 时，不需要大幅调整前端和接口。

## 任务状态

任务状态流转：

```text
pending -> running -> success
pending -> running -> failed
```

状态含义：

- `pending`：API 已接收任务，等待 Worker 处理。
- `running`：Worker 已领取任务，正在调用 Codex。
- `success`：Codex 执行完成，并且生成了非空 Markdown 报告。
- `failed`：执行失败、超时，或未生成有效报告。

建议任务字段：

- `id`：UUID 字符串。
- `svn_url`：用户提交的 SVN 项目路径。
- `old_revision`：规范化后的旧版本号，例如 `r25576`。
- `new_revision`：规范化后的新版本号，例如 `r29303`。
- `requester`：提交人，可为空，默认 `anonymous`。
- `status`：任务状态。
- `report_path`：服务端生成的报告路径。
- `error_message`：简短、脱敏后的错误摘要。
- `created_at`、`started_at`、`finished_at`、`updated_at`：任务时间戳。

## 输入校验

Web 表单收集：

- SVN 项目路径，例如 `https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T`。
- 旧版本号，例如 `r25576` 或 `25576`。
- 新版本号，例如 `r29303` 或 `29303`。
- 提交人，MVP 阶段可选。

校验规则：

- SVN 项目路径必须以 `https://192.168.0.233/svn/src_home/` 开头。
- 版本号只接受 `r数字` 或 `数字`。
- 版本号统一规范化为 `r数字`。
- 旧版本号和新版本号不能相同。
- 用户不能提交报告输出路径，也不能提交额外命令参数。

`requester` 字段用于提前兼容后续使用次数统计。未来加入登录系统后，服务端应忽略表单里的提交人字段，改为从登录态中获取真实用户身份。

## API 设计

### 创建任务

`POST /api/tasks`

请求体：

```json
{
  "svn_url": "https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T",
  "old_revision": "r25576",
  "new_revision": "r29303",
  "requester": "anonymous"
}
```

响应：

```json
{
  "task_id": "uuid",
  "status": "pending"
}
```

### 查询任务列表

`GET /api/tasks`

返回最近的、未被清理的任务列表，按创建时间倒序排列。

### 查询任务详情

`GET /api/tasks/{task_id}`

响应示例：

```json
{
  "task_id": "uuid",
  "svn_url": "https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T",
  "old_revision": "r25576",
  "new_revision": "r29303",
  "requester": "anonymous",
  "status": "success",
  "created_at": "2026-05-22T09:00:00+08:00",
  "started_at": "2026-05-22T09:00:05+08:00",
  "finished_at": "2026-05-22T09:18:30+08:00",
  "error_message": null,
  "report_available": true
}
```

### 预览报告

`GET /api/tasks/{task_id}/report`

任务成功后返回 Markdown 文本，用于前端渲染预览。

### 下载报告

`GET /api/tasks/{task_id}/download`

任务成功后下载原始 Markdown 文件。

## 前端设计

首屏就是可用的审查工具，不做营销式首页。

主要区域：

- 任务提交区：SVN 项目路径、旧版本号、新版本号、提交人、提交按钮。
- 当前任务区：状态、输入摘要、创建时间、开始时间、完成时间、错误摘要、下载按钮。
- Markdown 预览区：任务成功后渲染报告内容。
- 最近任务区：展示仍在保留期内的历史任务，点击后可以重新查看报告。

前端在任务为 `pending` 或 `running` 时，每 2-3 秒调用一次 `GET /api/tasks/{task_id}`。任务变为 `success` 后，再调用 `GET /api/tasks/{task_id}/report` 加载 Markdown 内容。

MVP 不做登录页面，但界面布局应预留未来展示用户身份的位置。

## Codex 调用设计

Worker 为每个任务创建：

- 工作目录：`data/workspaces/<task_id>/`。
- 报告路径：`data/reports/<task_id>.md`。

Prompt 模板建议放在配置文件中，例如 `config/prompt_template.md`，不要硬编码在 Worker 逻辑里。

Prompt 结构：

```text
请使用当前工作区中的 skill：skills/通用-代码变更审查

用这个更新后的代码审查：
- 项目路径：{svn_url}
- 旧版本号：{old_revision}
- 新版本号：{new_revision}
- 报告输出路径：{report_path}

要求：
1. 按该 skill 的输入模块、SVN 获取策略、规则模块和输出模块执行。
2. 最终必须生成 Markdown 报告文件到指定报告输出路径。
3. 只需要输出最终完成状态和报告路径，不需要在终端输出完整报告正文。
```

Codex 命令配置应可调整，例如：

```text
CODEX_COMMAND=codex
CODEX_ARGS=exec --dangerously-bypass-approvals-and-sandbox
CODEX_TIMEOUT_SECONDS=1800
```

实现注意事项：

- 使用 subprocess 参数数组调用 Codex，不拼接 shell 命令字符串。
- 报告路径使用绝对路径，因为当前 Windows 工作目录中包含空格。
- MVP 阶段 Codex 并发数固定为 1。
- SVN 认证依赖服务器系统账号已配置好的凭据，Web 服务不收集 SVN 用户名和密码。
- 任务失败时只保存简短、脱敏后的错误摘要。

## 安全控制

虽然 MVP 面向可信内网员工，仍然保留基础安全限制：

- SVN 项目路径必须匹配配置的白名单前缀。
- 版本号必须经过校验和规范化。
- 报告路径由服务端生成，用户不能控制。
- 不接受用户传入的任意命令参数。
- 不把完整 Codex stdout/stderr 暴露给浏览器。
- Codex 执行必须有超时限制。
- 默认一次只执行一个 Codex 任务。

## 保留与清理策略

保留周期：90 天。

清理行为：

- 服务启动时执行一次清理。
- 后台定期执行清理。
- 删除 90 天前的任务记录、Markdown 报告和临时工作目录。
- 清理失败只记录服务端日志，不影响 API 正常运行。

## 测试策略

单元测试：

- 版本号规范化。
- SVN URL 白名单校验。
- 任务状态流转。
- 报告路径生成。
- 90 天清理时间计算。

API 测试：

- 成功创建任务。
- 拒绝非法 SVN URL。
- 拒绝非法版本号。
- 查询任务详情。
- 任务成功后返回 Markdown 文本。
- 任务成功后下载 Markdown 文件。

Worker 测试：

- 使用 fake Codex 命令模拟成功，确认任务变为 `success`。
- 使用 fake Codex 命令模拟失败，确认任务变为 `failed`。
- 使用 fake Codex 命令模拟超时，确认任务变为 `failed`。
- Codex 未生成报告或报告为空时，任务变为 `failed`。

手工联调：

- 使用真实 `skills/通用-代码变更审查`。
- 提交示例 SVN 项目路径和版本号。
- 确认 Codex 能生成 Markdown 报告。
- 确认浏览器能渲染报告。
- 确认下载接口返回原始 `.md` 文件。

## 后续演进

### Redis 队列升级

当任务量、可靠性或并发要求提高时，将 SQLite 轮询 Worker 替换为 Redis/RQ 或 Celery。

保持不变：

- API 接口。
- 前端轮询行为。
- 任务状态值。
- 任务元数据结构，除非后续引入独立数据库。

需要变化：

- 任务派发机制。
- Worker 领取任务和重试机制。
- 可选的 Worker 并发数和队列监控。

建议升级触发条件：

- 需要多个 Codex 任务并发执行。
- Worker 重启后的任务恢复需要更强保证。
- 需要队列可视化、失败重试、优先级或更清晰的任务积压监控。

### 登录与使用次数统计

MVP 先把 `requester` 作为普通可选字段保存。后续加入登录系统时：

- 增加用户表和登录态管理。
- 从登录用户身份中获取提交人，不再信任表单提交人。
- 按用户、项目路径、天、周、月统计任务数量。
- 对历史任务中的 `requester` 字符串做兼容映射，尽量保留已有统计价值。

### 实时日志

如果后续用户需要查看执行进度，可以增加脱敏后的日志流。MVP 不把 Codex 执行日志暴露到浏览器，以降低内部路径、命令和凭据信息泄露风险。

### 多 Worker 并发

迁移到正式队列后，可以增加可配置并发数。启用高并发前，需要增加服务器资源限制和项目级限流。
