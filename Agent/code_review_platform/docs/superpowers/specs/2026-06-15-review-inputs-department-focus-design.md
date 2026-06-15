# 审查输入、部门和重点方向设计

## 背景

当前代码审查平台由 Web 服务端和 Electron 客户端组成。Electron 客户端负责在用户本机创建审查任务、准备工作区、调用 Codex 执行已安装的 Skill，并上传 Markdown/PDF 报告。服务端负责用户、任务、报告、Skill 包和 Web 管理页面。

当前启动提示词只包含 Skill 名称、SVN 项目路径、旧版本号、新版本号、报告输出路径和图片保存目录。用户希望新增两个可选审查输入：

- 产品开发需求表：Excel 文件，用户可以选择文件、粘贴文件或粘贴本机路径。Codex 执行代码审查时需要结合该 Excel。
- 重点审查方向：用户自由填写，用于提示 Codex 重点关注某些风险、模块或业务规则。

同时，现有 Web 端“部门管理”仍是模板 `Item` 模型包装，只有部门名称和说明，没有用户归属、部门权限和业务关联。用户希望本期引入正式部门体系，并把部门随用户一起保存。本期权限先保持“平台管理员全局管理，普通用户只携带部门属性”，但需要为下一期“部门管理员只能管理本部门数据”预留扩展空间。

## 已确认需求

1. 产品开发需求表是可选输入。
2. 产品开发需求表本期不由客户端解析，交给 Codex 在执行 Skill 时自行读取。
3. 用户可以直接粘贴本机路径，也可以复制 Excel 文件后粘贴到客户端，客户端应尽量取得该文件本机路径。
4. Electron 执行审查时应复制 Excel 到本次任务工作区，并把工作区副本路径传给 Codex。
5. 服务端需要保存 Excel 原文件作为任务附件，用于历史追溯。服务端不依赖用户本机绝对路径。
6. 重点审查方向是可选输入，用户可以自由手写。
7. 重点审查方向要保存到任务记录，并可在后台形成统计数据。
8. 管理员后续可以从用户填写过的重点审查方向中汇总、总结、沉淀为正式方向库条目。
9. 重点审查方向库由平台管理员维护，本期不引入部门管理员。
10. 正式方向库条目支持绑定部门；未绑定部门的条目表示全局方向。
11. 本期部门权限采用方案 B：正式部门 + 全局方向库 + 任务快照 + 附件，预留部门管理员扩展点。
12. 所有用户可见错误提示、状态提示和表单校验文案必须使用中文。

## 非目标

1. 本期不实现部门管理员角色和部门级管理权限。
2. 本期不做重点审查方向的 AI 聚类、自动总结或自动写入 Skill。
3. 本期不解析 Excel 内容生成 Markdown 摘要。
4. 本期不强制所有历史用户绑定部门。
5. 本期不删除现有 `item` 表，避免破坏历史数据或测试环境。
6. 本期不改变现有 SVN 获取策略、Skill 执行策略、报告生成和 PDF 上传主流程。

## 方案选择

### 方案 A：只扩展任务输入

只在 Electron 表单和 `review_task` 上增加 Excel 路径、重点方向字段，并修改 prompt。该方案上线快，但没有正式部门、方向库和统计沉淀，后续部门管理员功能会返工。

### 方案 B：正式部门 + 全局方向库 + 任务快照 + 附件

新增正式部门模型，用户带 `department_id`。任务创建时保存用户当时部门快照、重点审查方向快照和需求表附件信息。Electron 复制 Excel 到本机任务工作区给 Codex 使用，同时上传原 Excel 到服务端归档。Web 后台提供重点审查方向库和用户输入统计沉淀能力。

这是本期推荐并确认采用的方案。

### 方案 C：一次性实现部门管理员

同时增加部门管理员角色、部门范围权限、用户管理过滤、任务/方向/统计按部门隔离。该方案接近下一期目标，但权限面大、验收成本高，不适合作为本期输入增强的前置条件。

## 数据模型设计

### Department

新增正式部门表 `department`。

字段：

- `id`: UUID 主键。
- `name`: 部门名称，必填，建议唯一。
- `description`: 部门说明，可空。
- `is_active`: 是否启用，默认 `true`。
- `created_at`: 创建时间。
- `updated_at`: 更新时间。

迁移策略：

- 新增 `department` 表。
- 将现有 `item` 表中的部门占位数据复制到 `department` 表，保留 `title -> name`、`description -> description`、`created_at -> created_at`。
- `item` 表本期不删除。
- 前端“部门管理”改为使用 `Department` API 和类型。

删除策略：

- 如果部门下有关联用户、任务、方向库条目，不允许硬删除。
- 支持停用部门，历史任务继续显示部门名称快照。

### User

在 `user` 表新增：

- `department_id`: UUID，可空，外键到 `department.id`。

`UserCreate`、`UserUpdate`、`UserPublic` 增加：

- `department_id`
- `department_name`

兼容要求：

- 历史用户 `department_id` 为空时仍可登录和执行审查。
- CCH 同步本期不自动写入部门，因为同步源部门字段尚未确认。管理员可在用户管理页面手动设置。

### ReviewTask

在 `review_task` 表新增 nullable 字段：

- `department_id`: 用户创建任务时所属部门 ID，可空。
- `department_name`: 用户创建任务时所属部门名称快照，可空。
- `focus_direction_id`: 用户选择的正式方向库条目 ID，可空。
- `focus_direction_snapshot`: 用户最终提交给 Codex 的重点审查方向文本，可空，建议最大 4096 字符。
- `requirement_file_id`: 任务需求表附件 ID，可空。
- `requirement_file_name`: 原 Excel 文件名，可空。
- `requirement_file_size`: 文件大小，可空。
- `requirement_file_sha256`: 文件 hash，可空。

任务创建时：

- 后端根据当前用户写入 `department_id` 和 `department_name` 快照。
- 如果请求包含重点审查方向，保存到 `focus_direction_snapshot`。
- 如果请求包含方向库条目 ID，保存到 `focus_direction_id`，但仍以 snapshot 作为历史追溯依据。

历史任务：

- 新字段为空时不影响列表、详情、报告读取、报告下载、PDF 下载和统计。

### ReviewTaskRequirementFile

新增任务附件表 `review_task_requirement_file`。

字段：

- `id`: UUID 主键。
- `task_id`: 关联 `review_task.id`。
- `file_name`: 原文件名。
- `file_path`: 服务端保存路径。
- `content_type`: MIME 类型。
- `file_size`: 文件大小。
- `sha256`: 文件 hash。
- `uploaded_at`: 上传时间。

保存策略：

- 服务端保存 Excel 原文件到报告存储目录下的任务附件子目录，例如 `<REPORT_STORAGE_DIR>/<task_id>/requirements/<file_name>`。
- 只允许 `.xls` 和 `.xlsx`。
- 文件必须非空。
- 文件名必须做安全化处理，禁止路径穿越。
- 任务删除时删除已归档的需求表附件。

### ReviewFocusDirection

新增重点审查方向库表 `review_focus_direction`。

字段：

- `id`: UUID 主键。
- `title`: 方向名称，必填。
- `content`: 方向内容，必填。
- `department_id`: 可空，空表示全局方向。
- `is_active`: 是否启用。
- `usage_count`: 使用次数，可由任务创建或统计接口维护。
- `created_by_user_id`: 创建管理员。
- `created_at`: 创建时间。
- `updated_at`: 更新时间。

本期权限：

- 平台管理员可增删改查。
- 普通用户只能读取启用的“全局方向 + 自己部门方向”，用于后续选择。

### ReviewFocusDirectionUsageStats

不一定需要物理表。后台“用户输入统计”可通过 `review_task.focus_direction_snapshot` 聚合生成。

规范化规则：

- 去掉首尾空白。
- 合并连续空白字符。
- 完全相同文本聚合为同一条统计。

统计字段：

- 规范化内容。
- 使用次数。
- 最近使用时间。
- 涉及部门。
- 涉及任务数。
- 可一键沉淀为方向库条目。

## API 设计

### 部门 API

新增或替换为正式部门接口：

- `GET /api/v1/departments`
- `POST /api/v1/departments`
- `GET /api/v1/departments/{department_id}`
- `PATCH /api/v1/departments/{department_id}`
- `DELETE /api/v1/departments/{department_id}`

本期权限：

- 管理类接口仅平台管理员可用。
- 部门列表本期仅平台管理员读取，用于 Web 管理端的部门管理和用户部门选择。Electron 当前不需要读取部门列表。

### 用户 API

`POST /api/v1/users/` 和 `PATCH /api/v1/users/{user_id}` 支持 `department_id`。

`GET /api/v1/users/` 和 `GET /api/v1/users/me` 返回 `department_id`、`department_name`。

用户列表支持预留过滤：

- `department_id`: 本期仅管理员可用，后续部门管理员可复用。

### 任务 API

`POST /api/v1/review-tasks` 新增可选字段：

- `focus_direction_id`
- `focus_direction_snapshot`
- `requirement_file_name`

创建任务时返回新字段。

新增附件上传：

- `POST /api/v1/review-tasks/{task_id}/requirement-file`

权限：

- 任务归属用户可上传自己任务附件。
- 管理员可上传任意任务附件。

上传成功后：

- 保存 `ReviewTaskRequirementFile`。
- 更新 `review_task.requirement_file_*` 快照字段。

上传失败策略：

- Electron 本地审查不因服务端附件归档失败而中断。
- Electron 应记录中文提示，例如“产品开发需求表归档失败，审查将继续执行。请稍后在服务端补充归档。”

### 重点方向 API

方向库：

- `GET /api/v1/review-focus-directions`
- `POST /api/v1/review-focus-directions`
- `PATCH /api/v1/review-focus-directions/{direction_id}`
- `DELETE /api/v1/review-focus-directions/{direction_id}`

统计：

- `GET /api/v1/review-focus-directions/usage-stats`
- `POST /api/v1/review-focus-directions/from-usage`

本期权限：

- 管理和统计接口仅平台管理员可用。
- 普通用户读取启用方向可后续用于 Electron 下拉选项。

## Electron 客户端设计

### 表单输入

在 `TaskForm` 新增两个可选输入区。

产品开发需求表：

- 文本输入框：支持用户粘贴本机路径。
- 选择文件按钮：调用主进程文件选择对话框，限制 `.xls/.xlsx`。
- 粘贴文件：监听 `paste` 事件，如果 `clipboardData.files` 存在 Excel 文件，通过 preload 暴露的能力调用 Electron `webUtils.getPathForFile(file)` 获取本机路径。
- 可选拖拽：拖拽 Excel 文件到该区域时同样读取路径。

重点审查方向：

- 多行文本框，用户自由填写。
- 最大长度建议 4096 字符。
- 本期可不强制从方向库选择。
- 后续可增加方向库选择器，选择后填入或追加到文本框。

### Preload 和 IPC

新增能力：

- `selectRequirementFile()`: 打开文件选择器，返回本机文件路径。
- `getPathForPastedFile(file)`: 通过 `webUtils.getPathForFile(file)` 返回本机路径。

如果某些平台或来源无法从粘贴文件中取到路径，返回中文错误，前端提示用户使用“选择文件”。

### 工作区处理

`PreparedWorkspace` 增加：

- `requirementFilePath?: string`

流程：

1. 任务创建成功后获得 `task.id`。
2. 如果用户提供需求表路径，校验文件存在、是文件、扩展名为 `.xls/.xlsx`、非空。
3. 复制到 `workspaces/<taskId>/requirements/<安全文件名>`。
4. `buildReviewPrompt` 使用工作区副本路径，而不是用户原始路径。
5. 尝试上传原 Excel 到服务端附件接口。失败时记录中文提示但不阻塞 Codex 审查。

### 队列匹配

`useTaskQueue` 需要保存新增字段：

- `focus_direction_id`
- `focus_direction_snapshot`
- `requirement_file_path`
- `requirement_file_name`

新任务匹配服务端任务时应包含新增输入，防止相同 SVN、相同版本但不同需求表或重点方向的任务被误合并。

旧服务端任务没有这些字段时保持兼容。

## Prompt 设计

现有 prompt 保持 Skill 强制使用、SVN 输入、报告路径、图片保存目录和错误处理规范。

当存在产品开发需求表时追加：

```text
补充审查输入：
- 产品开发需求表路径：<requirementFilePath>

请在严格按该 Skill 执行代码变更审查的基础上，结合产品开发需求表中的项目背景、需求描述、软件评估结论、测试评估结论和备注信息，重点判断本次 SVN 变更是否满足产品需求、是否遗漏需求相关逻辑、是否引入与需求冲突的行为。
```

当存在重点审查方向时追加：

```text
补充审查输入：
- 重点审查方向：
<focusDirectionSnapshot>

请将重点审查方向作为本次代码审查的关注重点，但不得覆盖 Skill 中已有规则、SVN 获取策略、输出格式和错误处理规范。
```

两个输入都存在时合并到同一个“补充审查输入”模块。

空值不写入 prompt，避免 Codex 将“未提供”当作审查要求。

## Web 管理端设计

### 部门管理

现有 `/items` 页面改为正式部门管理页面，页面路径可保持 `/items` 以减少菜单和测试改动，也可以新增 `/admin/departments` 后保留 `/items` 跳转。本期建议保留 `/items` 路径，内部改用 Department API。

页面功能：

- 部门列表。
- 新增部门。
- 编辑部门名称、说明、启用状态。
- 删除或停用部门。
- 若有关联用户、任务或方向库条目，禁止删除并显示中文原因。

### 用户管理

用户列表新增部门列。

新增/编辑用户弹窗新增部门选择：

- 可为空。
- 只显示启用部门。
- 保存后用户返回值显示 `department_name`。

搜索可保留现状，后续可以加入部门筛选。

### 重点审查方向页面

新增管理员页面，例如 `/admin/review-focus-directions`。

页面包含两个 Tab：

1. 方向库
   - 管理员维护正式方向。
   - 支持标题、内容、部门、启用状态。
2. 用户输入统计
   - 从历史任务的 `focus_direction_snapshot` 聚合。
   - 展示内容摘要、使用次数、最近使用时间、涉及部门。
   - 支持一键沉淀为方向库条目。

菜单新增：

- `重点审查方向`，仅管理员可见。

## 服务端统计设计

统计来源：

- `review_task.focus_direction_snapshot`

过滤条件：

- 可按部门过滤。
- 可按时间范围过滤。
- 本期仅管理员使用全量统计。

聚合规则：

- trim。
- 合并连续空白。
- 完全相同文本聚合。
- 空字符串不参与统计。

沉淀流程：

1. 管理员在统计列表选择一条用户输入。
2. 点击“沉淀为方向”。
3. 弹窗预填标题、内容、部门。
4. 管理员编辑后保存到 `review_focus_direction`。

## 错误处理

所有错误提示必须为中文。

Electron 表单：

- Excel 路径为空：视为未提供。
- 文件不存在：提示“产品开发需求表不存在，请检查文件路径。”
- 不是文件：提示“产品开发需求表路径不是文件，请重新选择。”
- 扩展名不支持：提示“产品开发需求表仅支持 .xls 或 .xlsx 文件。”
- 文件为空：提示“产品开发需求表为空，请重新选择。”
- 粘贴文件无法读取路径：提示“无法读取粘贴文件路径，请使用选择文件按钮。”
- 复制到工作区失败：提示“产品开发需求表复制失败，请检查文件权限后重试。”
- 重点方向超长：提示“重点审查方向不能超过 4096 个字符。”

服务端：

- 附件非 Excel：返回“产品开发需求表仅支持 .xls 或 .xlsx 文件。”
- 附件为空：返回“产品开发需求表不能为空。”
- 无权限访问任务：沿用现有 403。
- 删除有关联数据的部门：返回“该部门已关联用户、任务或重点审查方向，不能删除，请先停用。”

归档失败策略：

- Excel 上传服务端失败不阻塞 Codex 审查。
- Electron 记录中文提示并继续执行。

Codex 错误处理：

- 保留现有 `[CODEX_ERROR::<错误码>]` 格式。
- 新增 Excel 和重点方向不改变原 Skill 的恢复策略。
- 如果 Codex 无法读取工作区 Excel，应按现有 `PARAM_ERROR` 或 `INTERNAL_ERROR` 规范输出中文分析。

## 兼容性

1. 旧 Electron 客户端不传新字段时仍可创建任务。
2. 历史任务新字段为空时仍可查看、下载、删除和统计。
3. 历史报告和 PDF 存储路径不改变。
4. 现有 `review_task` 的 `template_key`、`skill_name`、`report_path`、`pdf_report_path` 等字段不改含义。
5. 现有用户没有部门时可以继续登录、创建任务和查看自己的任务。
6. `item` 表本期保留，降低迁移风险。

## 后续部门管理员扩展预留

本期不实现部门管理员，但为下一期预留：

- 用户表已有 `department_id`。
- 任务表已有 `department_id` 和 `department_name` 快照。
- 重点方向库已有 `department_id`。
- 用户列表、任务列表、方向列表和统计接口预留 `department_id` 过滤参数。
- 后续可新增 `department_admin` 角色或用户部门权限表，而不需要重建任务和方向表。

下一期部门管理员权限可定义为：

- 平台管理员看全量。
- 部门管理员管理本部门用户、任务、方向和统计。
- 普通用户只看自己的任务。

## 测试计划

### 后端

- 部门 CRUD、停用和删除约束。
- 现有 `item` 数据迁移到 `department` 后不丢失。
- 用户创建、更新、列表、详情包含部门字段。
- 任务创建兼容旧 payload。
- 任务创建保存用户当时部门快照。
- 任务创建保存重点方向快照。
- Excel 附件上传只接受 `.xls/.xlsx`，拒绝空文件和非法类型。
- Excel 附件上传权限隔离。
- 任务删除清理需求表附件。
- 重点方向库 CRUD 权限。
- 重点方向统计按规范化文本聚合。
- 管理员可从统计项沉淀方向库条目。
- 普通用户不能管理部门和方向库。

### Electron

- `buildReviewPrompt` 在无可选输入时保持现有输出。
- `buildReviewPrompt` 在有 Excel 时包含工作区副本路径。
- `buildReviewPrompt` 在有重点方向时包含用户文本。
- `buildReviewPrompt` 在两个可选输入同时存在时合并补充审查输入。
- 选择 Excel 文件后路径写入表单。
- 粘贴文本路径后路径写入表单。
- 粘贴 Excel 文件后通过 Electron 获取本机路径。
- 不支持的文件类型显示中文错误。
- 任务工作区复制 Excel 成功后传副本路径给 Codex。
- Excel 上传服务端失败时不阻塞 Codex 审查。
- `useTaskQueue` 保存新增字段并避免不同重点方向任务误合并。

### Web 前端

- 部门管理页面使用 Department API。
- 用户管理显示和编辑部门。
- 重点审查方向页面展示方向库和用户输入统计。
- 从统计项沉淀方向库条目。
- 历史任务字段为空时页面不报错。

### 回归

- SVN 审查任务创建、执行、取消、超时、成功上传报告。
- Markdown 报告预览。
- PDF 报告生成、上传和打开。
- Skill 同步和模板选择。
- 用户管理现有角色权限。
- 任务管理现有权限隔离。

## 验收标准

1. 用户可不填写产品开发需求表和重点审查方向，审查流程与现有行为一致。
2. 用户可选择、粘贴路径或粘贴 Excel 文件作为产品开发需求表。
3. Codex prompt 使用任务工作区中的 Excel 副本路径。
4. 用户可自由填写重点审查方向，任务记录保存该文本快照。
5. 服务端可归档 Excel 原文件，归档失败不阻塞 Codex 审查。
6. 管理员可维护正式部门，用户可绑定部门。
7. 任务创建时保存用户当时的部门快照。
8. 管理员可查看重点审查方向统计，并从统计项沉淀正式方向库条目。
9. 历史任务和旧客户端 payload 继续兼容。
10. 所有新增用户可见错误提示为中文。
