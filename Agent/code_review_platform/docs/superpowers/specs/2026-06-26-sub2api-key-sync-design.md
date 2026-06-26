# Sub2API Key 用户同步设计

## 背景

原 code_review 平台的 CCH 同步功能通过 `CCH_DATABASE_URL` 直连 Claude Code Hub 数据库，从上游用户表和 Key 表同步姓名、角色、Key 和启停状态。现在 CCH 相关业务已经迁移到 sub2api 服务，code_review 仍需要使用上游 Key 登录，但最重要的同步内容变为 sub2api 中的“姓名 + Key”对应关系。

本次只更新 code_review 项目内的同步逻辑。远端 sub2api 服务当前正在运行，设计和实现都不应修改、重启或写入远端 sub2api 服务、容器、配置或数据库。

## 已确认的 sub2api 数据结构

远端 sub2api 服务包含 `sub2api`、`sub2api-postgres`、`sub2api-redis` 容器。只读检查确认关键表如下。

### `users`

关键字段：

- `id bigint primary key`
- `email varchar(255) not null`
- `username varchar(100) not null default ''`
- `role varchar(20) not null default 'user'`
- `status varchar(20) not null default 'active'`
- `deleted_at timestamptz null`

当前数据特点：

- 有 122 个用户。
- 只有管理用户 `id=1` 处于 `active`。
- 多数从 CCH 导入的人员行带有姓名，但处于 `disabled` 且 `deleted_at` 非空。

### `api_keys`

关键字段：

- `id bigint primary key`
- `user_id bigint not null references users(id)`
- `key varchar(128) not null unique`
- `name varchar(100) not null`
- `status varchar(20) not null default 'active'`
- `deleted_at timestamptz null`
- `expires_at timestamptz null`

当前数据特点：

- 有 123 条 Key。
- 所有 Key 的 `user_id` 当前都指向 `users.id=1`。
- 真实人员姓名在 `api_keys.name` 中。
- `api_keys.name` 当前无重复。
- 120 个 Key 名称可匹配到同名 `users.username`，但这些用户行不可作为登录身份来源，因为它们已禁用或软删除。
- 3 个 Key 名称没有匹配用户行：`gpt-pro`、`吴俊锭`、`郭杭武`。

结论：同步必须以 `api_keys` 为主表，不能使用 `api_keys.user_id -> users.id` 作为姓名和 Key 的绑定依据，否则会把所有 Key 错误绑定到 sub2api 管理员。

## 目标

- 保留 code_review 现有“同步 CCH 用户”后台入口和登录流程。
- 将同步源扩展为 sub2api 数据库结构，重点保证姓名和 Key 不对应错。
- 以 sub2api `api_keys` 每一行作为一个上游登录身份。
- 同步后，用户可继续用 sub2api Key 登录 code_review。
- 不丢失 code_review 现有业务数据。

## 非目标

- 不迁移 code_review 的任务、报告、反馈、Skill、SVN 凭据、部门或权限数据到 sub2api。
- 不写入或修改 sub2api 服务、sub2api Postgres、容器、compose 或 `.env`。
- 不在本次改动中重命名 Web 按钮、API 路径或 `CCH_DATABASE_URL` 配置。
- 不从 sub2api 同步权限管理。code_review 的管理员、部门管理员、部门绑定仍由 code_review 本地维护。

## 同步模型

### 上游身份

新增内部解析概念：`api_keys` 派生的上游身份。

对每条 sub2api `api_keys`：

- 上游 Key ID：`api_keys.id`
- 上游显示姓名：`api_keys.name`
- 上游 Key 明文：`api_keys.key`
- 上游 Key 状态：`api_keys.status`
- 上游删除状态：`api_keys.deleted_at`
- 上游过期时间：`api_keys.expires_at`

`users` 表只作为兼容或辅助信息，不参与姓名和 Key 的绑定。

### 本地映射

本地继续使用现有模型，不新增数据库表：

- `UserApiKey.cch_key_id = api_keys.id`
- `UserApiKey.key = api_keys.key`
- `UserApiKey.name = api_keys.name`
- `User.full_name = api_keys.name`
- 新建 `User.role = user`，已存在用户的 `role`、`is_superuser` 和 `department_id` 不由 sub2api 同步覆盖

`User.cch_user_id` 需要避免与旧 CCH 用户 ID、sub2api `users.id` 或同一管理用户 `id=1` 冲突。实现时使用稳定派生 ID：

```text
sub2api_user_surrogate_id = SUB2API_CCH_ID_OFFSET + api_keys.id
```

其中 `SUB2API_CCH_ID_OFFSET` 为代码常量，取足够大且不超过 Postgres 32 位 integer 范围的整数，例如 `1_000_000_000`。这样每个 Key 都能对应一个唯一的本地 `User`，且不会把所有 Key 合并到同一个用户。

## 同步规则

### 创建

当本地不存在 `UserApiKey.cch_key_id = api_keys.id` 时：

1. 计算派生 `cch_user_id`。
2. 查找或创建 `User(cch_user_id=派生 ID, auth_source='cch')`。
3. 设置 `User.full_name = api_keys.name`。
4. 新建用户使用普通用户权限，管理员和部门管理员权限后续在 code_review 内维护。
5. 创建 `UserApiKey` 并保存 Key 明文、Key 名称和状态。

### 更新

当本地已存在同一 `cch_key_id`：

1. 通过该 Key 记录找到本地用户。
2. 更新 `User.full_name` 为当前 `api_keys.name`。
3. 更新 `UserApiKey.key`、`name`、`is_active`、`disabled_reason`、`last_synced_at`、`updated_at`。
4. 不改 `User.svn_username`、`role`、`is_superuser`、`department_id` 和本地维护的部门管理员权限。

如果旧数据曾按原 CCH 用户 ID 创建用户，且本地存在同名或同 Key 记录，实施计划中需要给出兼容策略，优先通过 `UserApiKey.cch_key_id` 精确匹配，避免按姓名合并造成误配。

### 禁用

只有满足以下条件的 Key 可登录：

- `api_keys.status = 'active'`
- `api_keys.deleted_at is null`
- `api_keys.expires_at is null or api_keys.expires_at > sync_time`

否则本地 `UserApiKey.is_active=false`，并记录原因：

- `key_disabled`
- `key_deleted`
- `key_expired`

用户本身不因 sub2api `users.status` 被禁用，因为当前真实身份来自 `api_keys`，不是 `users`。

### 不删除数据

同步过程不执行任何删除操作。即使上游 Key 禁用、删除或过期，本地也只做禁用标记，保留：

- `User`
- `UserApiKey`
- `UserSvnCredential`
- `ReviewTask`
- 报告、反馈、Skill、审计日志
- `department_id`
- 本地用户角色和权限维护结果

## 现有 CCH 兼容

`CchSyncService.fetch_rows()` 继续支持原 CCH 风格的用户表 + Key 表解析：

- 用户表候选仍包括 `cch_user`、`cch_users`、`users`、`user`。
- Key 表候选仍包括 `cch_key`、`cch_keys`、`user_api_key`、`api_keys`、`keys`。

识别到 sub2api `api_keys` 结构时，走“Key 主表”解析。否则走现有 CCH 用户 + Key 解析。

识别条件可以基于列集合：

- `api_keys` 表存在 `id/user_id/key/name/status/deleted_at/expires_at`。
- `users` 表存在 `id/email/username/status/deleted_at`。
- `api_keys.user_id` 大量指向同一用户不应作为识别条件，只作为已观察到的数据特征。

## 错误处理

- 如果 `api_keys.name` 为空，跳过该 Key 并记录错误，避免创建无姓名身份。
- 如果 `api_keys.key` 为空，跳过该 Key 并记录错误。
- 如果派生 `cch_user_id` 与已有非 sub2api 用户冲突，跳过并记录错误。
- 如果同一同步批次出现重复 `api_keys.name`，不中断同步，但记录警告；Key 仍以 `api_keys.id` 精确区分。
- 如果数据库结构不符合 CCH 或 sub2api 任一模式，返回清晰错误，保持现有 503/同步错误行为。

## 审计

继续写入 `AuditLog(action='cch_users_synced')`，保留现有摘要字段：

- `created`
- `updated`
- `disabled`
- `skipped_records`
- `errors`
- `started_at`
- `finished_at`

错误列表中不得记录完整 Key 明文。

## 测试设计

后端单元测试新增以下场景：

1. sub2api `api_keys` 每条记录创建一个本地用户和 Key。
2. `User.full_name` 来自 `api_keys.name`，不是 `users.username` 或 `users.email`。
3. 多个 Key 的 `user_id` 都指向同一个 sub2api 管理员时，本地仍创建多个不同用户。
4. `api_keys.status != 'active'`、`deleted_at` 非空、`expires_at` 已过期时，本地 Key 禁用。
5. 同步不会清空已有 `svn_username`、`department_id`、`UserSvnCredential` 或历史 `ReviewTask`。
6. 已有本地部门管理员角色和部门绑定在同步后保持不变。
7. 原 CCH 风格测试继续通过，避免破坏旧兼容。

## 部署注意

本设计阶段不修改远端 sub2api。实现完成并验证后，部署只需要让 code_review 后端的 `CCH_DATABASE_URL` 指向 sub2api Postgres 的只读连接串或等价安全连接方式。

如果生产 code_review 和 sub2api 不在同一 Docker 网络内，应优先使用只读数据库账号、网络白名单或 SSH tunnel，而不是暴露 sub2api Postgres 到公网。
