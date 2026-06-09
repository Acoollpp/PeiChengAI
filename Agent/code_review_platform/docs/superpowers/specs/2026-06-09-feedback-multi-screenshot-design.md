# 意见反馈多图支持设计

## 背景

当前意见反馈只支持一张问题截图。Electron 客户端、Web 意见管理页和后端模型都围绕单图字段实现：`screenshot_path`、`screenshot_name`、`screenshot_content_type`、`screenshot_size`。新需求是每条意见支持多张截图，范围覆盖后端、Web 前端和 Electron 客户端，且不得影响当前其它分支开发。

## 目标

- 每条意见最多上传 5 张截图。
- 每张截图最大 5MB。
- 支持 PNG、JPEG、WebP。
- Electron 客户端提交意见支持选择和粘贴多张截图。
- Web 意见管理提交弹窗支持选择和粘贴多张截图。
- Web 意见详情支持查看多张截图。
- 普通用户只能查看自己的意见和截图；管理员可以查看所有意见和截图。
- 只有管理员可以修改解决状态。
- 后端响应不暴露服务器真实存储路径。

## 非目标

- 不做图片在线编辑、压缩、裁剪或标注。
- 不做拖拽排序；截图顺序按用户选择/粘贴的追加顺序保存。
- 不扩展审查报告图片附件上传；本设计只处理意见反馈截图。

## 数据模型

新增 `FeedbackScreenshot` 表：

- `id`: 截图 ID。
- `feedback_id`: 所属意见 ID，关联 `feedback.id`。
- `file_path`: 服务器存储路径，仅后端内部使用。
- `file_name`: 原始文件名。
- `content_type`: 文件类型。
- `file_size`: 文件大小，单位字节。
- `sort_order`: 截图顺序，从 0 开始。
- `created_at`: 上传时间。

`feedback` 表继续保存意见主体。旧单图字段暂时保留，避免一次迁移删除字段带来的风险；新代码只写入和读取 `FeedbackScreenshot`。如果数据库中存在旧单图数据，迁移会把旧字段转换为一条 `FeedbackScreenshot` 记录。

数据库字段和表注释继续使用中文。

## 后端接口

### 创建意见

`POST /api/v1/feedback`

- 表单字段 `description`: 必填，trim 后不能为空。
- 文件字段 `screenshots`: 可选，允许 0 到 5 个文件。
- 每个文件必须是 PNG、JPEG 或 WebP，且不超过 5MB。
- 保存时先创建反馈主体，再按顺序保存截图附件。
- 任意截图校验或保存失败时回滚数据库记录，并删除本次已写入的文件。

### 列表和详情

`FeedbackPublic` 增加：

- `screenshot_count: int`
- `screenshots: list[FeedbackScreenshotPublic]`

`FeedbackScreenshotPublic` 包含：

- `id`
- `file_name`
- `content_type`
- `file_size`
- `sort_order`
- `created_at`

列表可返回截图元数据，但不返回 `file_path`。

### 截图读取

新增或调整为：

`GET /api/v1/feedback/{feedback_id}/screenshots/{screenshot_id}`

权限：

- 管理员可读取任意意见截图。
- 普通用户只能读取自己意见的截图。
- 截图必须属于该 `feedback_id`。

保留旧单图截图接口一版兼容，但前端新代码使用新的多图接口。

### 状态修改

状态修改接口保持不变，仅管理员可调用。

## Web 前端

### 提交弹窗

- 支持选择多张图片。
- 支持在问题描述框粘贴截图，粘贴后追加到列表。
- 显示最多 5 张缩略预览。
- 支持逐张移除。
- 超过 5 张、类型不支持或单张超过 5MB 时显示错误提示。
- 提交时使用 multipart，字段名使用 `screenshots` 重复追加多个文件。

### 列表页

- 截图列显示 `-` 或 `N 张`。
- 点击详情查看完整截图列表。
- 管理员筛选、状态修改逻辑保持不变。

### 详情弹窗

- 展示所有截图元数据。
- 按 `sort_order` 顺序加载和展示多张截图。
- 每张截图通过鉴权接口读取 Blob，不暴露服务器路径。
- 切换意见或关闭弹窗时释放 object URL。

## Electron 客户端

### Renderer

- `SubmitFeedbackDialog` 的截图状态由 `File | null` 改为 `File[]`。
- 选择文件使用 `multiple`，追加有效图片。
- 粘贴截图追加到截图列表。
- 最多 5 张，每张 5MB。
- 支持逐张移除，并释放预览 object URL。

### Preload / IPC

- `SubmitFeedbackPayload.screenshots?: File[]`。
- preload 将每个 `File` 序列化为 `{ name, type, bytes }`，通过 IPC 传给 main。
- main 将序列化截图还原为 Blob/File，并传给 ApiClient。

### ApiClient

- `submitFeedback` 构造 multipart，重复追加 `screenshots` 字段。
- 不手动设置 multipart `Content-Type`。
- 返回值仍使用后端返回的反馈公开结构或最小 `{ id, status }` 兼容结构。

## 兼容性和迁移

- 旧数据的单图字段在迁移时转入 `FeedbackScreenshot`。
- 新代码不再写旧单图字段。
- 旧接口可暂时保留，降低回滚和历史调用风险。
- 前端生成客户端或手工类型需要和 OpenAPI 保持一致。

## 错误处理

- 描述为空：前端提示，后端返回 400。
- 超过 5 张：前端提示，后端返回 400。
- 非图片类型：前端提示，后端返回 400。
- 单张超过 5MB：前端提示，后端返回 400。
- 截图文件缺失或不属于该意见：返回 404。
- 普通用户访问他人截图：返回 403。

## 测试计划

后端：

- 创建 0 张截图意见。
- 创建 1 张截图意见。
- 创建多张截图意见并验证顺序。
- 超过 5 张返回 400。
- 非图片返回 400。
- 单张超过 5MB 返回 400。
- 普通用户列表只看到自己的意见。
- 管理员列表看到所有意见。
- 普通用户不能读取他人截图。
- 管理员可以读取任意截图。
- 只有管理员可以改状态。
- 删除用户时同步清理意见和截图记录。

Web：

- 提交弹窗可以添加多张、移除单张、限制最多 5 张。
- 提交 multipart 包含多个 `screenshots`。
- 详情弹窗展示多张截图。
- 管理员状态修改保持可用。

Electron：

- 提交弹窗选择多张、粘贴追加、移除单张。
- preload 正确序列化多张截图。
- main IPC 正确还原多张截图。
- ApiClient multipart 重复追加 `screenshots` 字段。
- 全量 Electron typecheck 和测试通过。

## 实施约束

- 全程在独立分支 `codex/feedback-multi-screenshot` 和隔离 worktree 中完成。
- 不修改用户当前主工作区和其它开发分支。
- commit message 使用中文。
- 输出、spec、plan 使用中文。
