# CCH Key 同步与 SVN 双登录设计

## 背景

`code_review_platform` 当前同时保留了邮箱/密码登录、SVN 账号密码登录，以及围绕邮箱的注册、找回密码、修改邮箱和修改密码功能。后续目标是抛弃邮箱身份体系，让服务端 Web 和 Electron 客户端只保留两种登录方式：

1. Key 登录：Key 来源于 Claude Code Hub（以下简称 CCH）的用户和 Key，由 code_review 管理员手动同步到本地数据库。
2. SVN 账号密码登录：继续使用 code_review 本地保存和加密的 SVN 凭据。

code_review 自己的业务数据仍由 code_review 数据库管理，包括 `review_task`、`skill_package`、`user_svn_credential`、`audit_log` 等表。CCH 只作为用户名称、角色和 Key 的上游来源，不接管 code_review 的业务表。

## 目标

- 删除邮箱登录、邮箱注册、找回密码、重置密码、修改邮箱、修改密码和相关邮件登录链路。
- Web 服务端和 Electron 客户端都只支持 Key 登录和 SVN 账号密码登录。
- 在 Web 管理后台提供“同步 CCH 用户”按钮，仅管理员可以触发。
- 同步 CCH 用户名称、角色、Key 明文和 Key 状态到 code_review 本地库。
- 登录时不实时访问 CCH 数据库，只校验 code_review 本地同步后的 Key 数据。
- 保留并继续使用 code_review 现有业务表。
- 支持 Key 用户在设置中绑定 SVN 账号密码，并在必要时合并旧 SVN 用户的历史数据。

## 非目标

- 不把 code_review 的任务、Skill、审计日志或 SVN 凭据迁移到 CCH。
- 不做自动定时同步。第一阶段只做管理员手动同步。
- 不在 code_review 普通用户界面展示或复制完整 CCH Key。
- 不保留邮箱作为身份字段，也不使用占位邮箱绕过模型约束。

## 数据模型

### User

`user` 表继续作为 code_review 的本地用户表，本地主键保持 UUID。

保留字段：

- `id`
- `is_active`
- `is_superuser`
- `full_name`
- `svn_username`
- `role`
- `created_at`

新增字段：

- `cch_user_id: int | null`：CCH `users.id`，唯一索引。为空表示本地 SVN 用户或历史用户。
- `auth_source: str`：用户来源，取值为 `local` 或 `cch`。历史 SVN 用户和本地创建用户为 `local`，CCH 同步用户为 `cch`。
- `disabled_reason: str | null`：用户不可用原因，例如 `cch_user_disabled`、`cch_user_expired`、`cch_user_deleted`。
- `last_synced_at: datetime | null`：最近一次从 CCH 同步用户状态的时间。

删除字段：

- `email`
- `hashed_password`

删除 `email` 后，所有唯一索引、Pydantic schema、CRUD 查询和测试都要改为基于 Key 或 SVN 账号。

### UserApiKey

新增 `user_api_key` 表，用于保存从 CCH 同步来的 Key。

字段：

- `id: uuid`
- `user_id: uuid`：关联本地 `user.id`
- `cch_key_id: int`：CCH `keys.id`
- `key: str`：CCH Key 明文
- `name: str | null`：CCH Key 名称
- `is_active: bool`：是否可用于 code_review 登录
- `disabled_reason: str | null`：不可登录原因，例如 `user_disabled`、`user_expired`、`user_deleted`、`key_disabled`、`key_expired`、`key_deleted`
- `last_synced_at: datetime`
- `created_at: datetime`
- `updated_at: datetime`

索引和约束：

- `cch_key_id` 唯一索引
- `key` 索引
- `user_id` 索引

同步时保存 Key 明文，这是当前设计的明确选择。该选择基于内网和受控部署假设，后续如果安全要求提高，可以迁移为“哈希匹配”或“加密明文 + 哈希匹配”。

### UserSvnCredential

`user_svn_credential` 保留。SVN 密码继续通过现有 `CredentialService` 加密保存。

## CCH 同步流程

### 配置

后端新增 CCH 数据库连接配置，例如：

- `CCH_DATABASE_URL`
- 可选：`CCH_SYNC_BATCH_SIZE`

如果 `CCH_DATABASE_URL` 未配置，管理后台同步按钮应禁用或返回清晰错误。

### 同步入口

新增管理员接口：

- `POST /api/v1/admin/cch-sync/users`

权限：

- 仅 code_review 管理员可调用。

返回内容：

- 新增用户数
- 更新用户数
- 停用用户数
- 新增 Key 数
- 更新 Key 数
- 停用 Key 数
- 跳过记录数
- 错误列表
- 同步开始和结束时间

### 同步规则

同步时读取 CCH `users` 和 `keys`。

用户同步：

- 按 `cch_user_id` 匹配本地 `user`。
- 不存在则创建本地用户。
- 存在则更新 `full_name`、`role`、`is_active`、`disabled_reason`、`last_synced_at`。
- CCH `users.role = admin` 同步为 code_review 管理员，否则为普通用户；实现时要同时更新 `role` 和 `is_superuser`，避免两个权限字段出现不一致。
- CCH 用户被禁用、删除或过期时，本地用户保留，但 `is_active=false` 并记录原因。

Key 同步：

- 按 `cch_key_id` 匹配本地 `user_api_key`。
- 不存在则创建。
- 存在则更新 Key 明文、名称、状态、不可用原因和同步时间。
- CCH Key 被禁用、删除或过期时，本地 Key 保留，但 `is_active=false`。
- 如果所属 CCH 用户不可用，则该用户下所有本地 Key 都不可登录。

审计：

- 每次同步写入 `audit_log`，记录操作者、同步摘要和错误摘要。

## 登录流程

### Key 登录

接口：

- `POST /api/v1/auth/key-login`

请求：

- `key`

流程：

1. 根据输入 Key 查询本地 `user_api_key.key`。
2. Key 不存在，返回 401。
3. Key `is_active=false`，返回 401，并使用通用错误信息避免泄露细节。
4. 所属用户不存在或 `is_active=false`，返回 401。
5. 通过后签发现有 JWT access token 和 refresh token。

Key 登录不访问 CCH 数据库。CCH 状态变化只有管理员再次同步后才反映到 code_review。

### SVN 登录

接口：

- 继续保留或调整现有 `POST /api/v1/auth/login`

请求：

- `svn_username`
- `svn_password`

流程：

1. 根据 `svn_username` 查询本地 `user`。
2. 用户不存在或不可用，返回 401。
3. 使用 `CredentialService` 读取并解密本地 SVN 密码。
4. 密码匹配后签发现有 JWT access token 和 refresh token。

SVN 登录不依赖 CCH。

### 移除邮箱登录

删除或停用以下入口：

- `/login/access-token`
- `/users/signup`
- `/password-recovery/{email}`
- `/reset-password/`
- `/password-recovery-html-content/{email}`
- Web 登录页的邮箱/密码表单
- Web 注册、找回密码、重置密码页面和链接
- 用户设置中的邮箱修改和密码修改页签

如果为了兼容 OpenAPI 客户端生成需要保留旧接口，应返回 410 Gone，并在实现计划中逐步删除前端引用。

## SVN 绑定与旧用户合并

Key 用户登录后，可以在设置中绑定或更新 SVN 账号密码。

接口：

- `PUT /api/v1/me/svn-credential`

请求：

- `svn_username`
- `svn_password`

规则：

1. 当前用户保存新的 `svn_username`。
2. SVN 密码继续加密写入 `user_svn_credential`。
3. 如果 `svn_username` 已属于另一个旧本地用户，则触发合并。

合并规则：

- 将旧用户的 `review_task.user_id` 迁移到当前用户。
- 将旧用户的 `user_svn_credential` 迁移或覆盖到当前用户。若当前请求包含新的 SVN 密码，以新密码为准。
- 必要时迁移和该旧用户直接相关的审计目标引用。
- 旧用户设置为 `is_active=false`，`disabled_reason=merged_into_cch_user`。
- 旧用户释放或清理 `svn_username`，避免唯一约束冲突。
- 写入 `audit_log`，记录旧用户、新用户和 SVN 账号。

## 前端设计

### Web 登录页

登录页改为两个 tab：

- Key 登录
- SVN 登录

Key 登录表单：

- Key 输入框
- 登录按钮

SVN 登录表单：

- SVN 账号输入框
- SVN 密码输入框
- 登录按钮

删除：

- 邮箱输入框
- 找回密码链接
- 注册入口

### Web 管理后台

用户管理页增加“同步 CCH 用户”按钮。

交互：

- 仅管理员可见。
- 点击后调用 `POST /api/v1/admin/cch-sync/users`。
- 同步中显示加载状态，避免重复点击。
- 成功后显示同步摘要。
- 失败时显示清晰错误信息。

用户表增加或调整展示：

- 用户名称
- 来源：本地 / CCH
- CCH 用户 ID
- SVN 账号
- 角色
- 状态
- 最近同步时间

### 用户设置

删除：

- 修改邮箱
- 修改密码

保留或新增：

- 个人信息展示
- SVN 凭据管理

### Electron 客户端

Electron 登录页也改为两种方式：

- Key 登录
- SVN 登录

Key 登录调用服务端 Key 登录接口。

SVN 登录调用服务端 SVN 登录接口。

客户端任务执行时仍通过 `/api/v1/me/svn-credential` 获取当前登录用户的 SVN 凭据。

## 后端组件边界

新增服务：

- `CchSyncService`：连接 CCH 数据库、读取 CCH 用户和 Key、计算本地 upsert 和停用状态。
- `UserApiKeyService`：封装本地 Key 查询、同步写入和登录校验。
- `UserMergeService`：封装 SVN 绑定时的旧用户合并逻辑。

现有组件调整：

- `login.py`：保留 SVN 登录，新增 Key 登录，删除邮箱密码登录相关逻辑。
- `users.py`：删除邮箱和密码相关 API，用户更新只允许修改仍有效的业务字段。
- `models.py`：删除邮箱字段和密码字段，新增 CCH 绑定和本地 Key 模型。
- `crud.py`：删除 `get_user_by_email` 和邮箱密码认证，增加按 SVN 账号和按 Key 查询的函数。
- OpenAPI 客户端重新生成，前端跟随新 schema 调整。

## 错误处理

- Key 登录失败统一返回“Key 无效或不可用”，避免泄露 Key 是否存在。
- SVN 登录失败统一返回“SVN 账号或密码错误”。
- CCH 同步失败时不回滚已成功的独立记录，返回错误摘要；单条记录错误不应中断整个同步，除非数据库连接或 schema 不兼容。
- 如果 CCH 数据库连接失败，同步接口返回 503 或 500，并记录日志和审计失败。
- 如果本地唯一约束冲突，同步服务应记录具体 CCH 用户或 Key，并跳过该条，避免整个同步不可用。

## 迁移策略

1. 新增 `cch_user_id`、`auth_source`、`disabled_reason`、`last_synced_at`。
2. 新增 `user_api_key` 表。
3. 为已有用户填充 `auth_source=local`。
4. 删除或放松对 `email`、`hashed_password` 的模型依赖。
5. 数据库迁移删除 `email`、`hashed_password` 列和相关索引。
6. 删除邮箱相关 API 和前端入口。

迁移后，历史本地用户仍可通过 SVN 账号密码登录。CCH 同步用户可以通过 Key 登录，并可在设置中绑定 SVN。

## 测试计划

后端测试：

- CCH 同步可以创建本地 CCH 用户。
- CCH 同步可以创建和更新本地 Key。
- CCH 禁用、删除、过期用户会导致本地用户和 Key 不可登录。
- CCH 禁用、删除、过期 Key 会导致本地 Key 不可登录。
- Key 登录成功签发 token。
- 无效 Key、停用 Key、停用用户均拒绝登录。
- SVN 登录继续可用。
- SVN 绑定会保存加密密码。
- SVN 绑定遇到旧用户时迁移 `review_task` 和 SVN 凭据。
- 邮箱相关接口删除或返回预期状态。

前端测试：

- Web 登录页只展示 Key 登录和 SVN 登录。
- Web 登录页不再展示邮箱、注册和找回密码入口。
- 管理后台展示“同步 CCH 用户”按钮。
- 同步成功展示摘要。
- 设置页不再展示邮箱和密码修改入口。
- Electron 登录页只展示 Key 登录和 SVN 登录。

迁移测试：

- 删除 `email` 和 `hashed_password` 后，用户列表、任务列表、Skill 管理、SVN 凭据读取仍可用。
- 历史本地 SVN 用户仍能通过 SVN 登录。

## 风险与缓解

- 明文保存 Key 风险：限制同步按钮为管理员可用，普通用户不展示完整 Key；数据库访问权限必须按生产要求收紧。后续可迁移到哈希匹配。
- 同步不是实时：CCH 状态变化要等管理员再次同步才生效。管理后台需要明确显示最近同步时间。
- 删除邮箱字段影响面大：需要同时调整后端模型、迁移、OpenAPI 客户端、Web 前端、Electron 客户端和测试。
- 旧用户合并可能有冲突：合并逻辑必须在事务中执行，失败时回滚，并写入审计日志。

## 验收标准

- 新部署中没有邮箱登录、注册、找回密码、重置密码、修改邮箱和修改密码入口。
- Web 和 Electron 都能使用同步后的 CCH Key 登录。
- Web 和 Electron 都能使用 SVN 账号密码登录。
- 管理员可以在 Web 管理后台手动同步 CCH 用户和 Key。
- 同步后的失效用户或 Key 不能登录，但本地记录仍保留。
- `review_task`、`skill_package`、`user_svn_credential`、`audit_log` 等业务功能继续可用。
- Key 用户绑定旧 SVN 账号后，旧用户历史任务迁移到当前用户。
