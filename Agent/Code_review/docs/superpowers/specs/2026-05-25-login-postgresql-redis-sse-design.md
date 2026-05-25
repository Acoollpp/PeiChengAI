# 登录、PostgreSQL、Redis 调度与 SSE 设计

## 目标

为代码审查 Web 服务增加用户身份、使用统计、PostgreSQL 持久化、Redis 按用户并发调度，以及任务状态动态更新能力。

登录系统定位为身份登记，不做密码认证。用户使用姓名和手机号标识自己，系统据此关联任务、展示个人任务视图，并统计使用情况。

## 当前基线

当前服务是 FastAPI 应用，前端是静态页面。任务数据通过 `TaskRepository` 存在 SQLite 中。后台 worker 轮询数据库，领取最早的 `pending` 任务，执行 Codex，并把审查报告写入磁盘。前端可以提交任务并轮询任务详情，但没有登录态，也没有按用户限制并发。

## 选定方案

采用 PostgreSQL 作为事实源，Redis 作为运行期调度和事件通道，Server-Sent Events 负责浏览器动态更新。

PostgreSQL 保存用户、任务、持久任务状态、报告路径、时间戳、worker 元数据和统计所需数据。Redis 保存队列、按用户的运行锁、可调度用户集合和事件通知。Redis 状态可在需要时从 PostgreSQL 重建。

这个方案把持久数据集中在数据库中，同时把 Redis 用在它最适合的地方：快速原子调度和锁协调。

## 用户身份与登录

新增独立 `/login` 页面。用户输入：

- 姓名
- 手机号

后端规范化手机号，按手机号查找或创建用户，更新展示姓名和 `last_seen_at`，并返回浏览器 session cookie。

登录页与任务台分离：

- 未登录访问 `/` 时跳转到 `/login`，或者由前端在 `GET /api/session` 返回未登录后跳转到 `/login`。
- 登录成功后跳转到 `/`。
- 已登录访问 `/login` 时可以直接跳转到 `/`。
- 当前任务台布局保持不变，只增加少量登录态展示。

任务台在现有 header 或状态区域展示当前用户和退出入口。任务提交表单不再信任 `requester` 字段；后端从 session 用户推导提交人。

## PostgreSQL 数据模型

新增 `users` 表：

- `id UUID PRIMARY KEY`
- `name TEXT NOT NULL`
- `phone TEXT NOT NULL UNIQUE`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- `last_seen_at TIMESTAMPTZ NOT NULL`

将 `tasks` 从 SQLite 迁移到 PostgreSQL，并保留现有任务字段，同时新增：

- `user_id UUID NOT NULL REFERENCES users(id)`
- `queue_position INTEGER NULL`，可选的展示缓存字段
- `claimed_by TEXT NULL`，用于排查问题的 worker 标识
- `heartbeat_at TIMESTAMPTZ NULL`，worker 存活心跳时间

迁移期保留 `requester TEXT`，并写入用户展示姓名，以兼容现有响应模型和报告展示。等 UI 和报告路径全部改为使用 `user_id` 后，再在后续迁移中删除。

任务状态包括：

- `pending`
- `running`
- `success`
- `failed`
- `enqueue_failed`

`enqueue_failed` 表示任务已写入 PostgreSQL，但 Redis 入队失败。这个状态能让运维和恢复逻辑明确识别调度失败，而不是静默丢失调度意图。

## Redis 调度模型

Redis key：

- `queue:user:{user_id}`：单个用户的等待任务列表，按提交时间排序。
- `users:ready`：有等待任务且当前没有运行锁的用户集合或有序集合。
- `running:user:{user_id}`：用户级运行锁，值为当前运行任务 ID，由 worker 刷新 TTL。
- `task:user:{task_id}`：任务到用户的映射，用于清理和恢复。
- `events:user:{user_id}`：SSE 通知使用的事件通道或 stream。

调度规则：

同一个用户同一时间最多只能有一个 `running` 任务。

任务创建流程：

1. 校验请求，并要求已登录 session。
2. 在 PostgreSQL 中创建 `pending` 任务，写入 `user_id`。
3. 将任务 ID 推入 `queue:user:{user_id}`。
4. 如果 `running:user:{user_id}` 不存在，将用户加入 `users:ready`。
5. 发布用户事件，让浏览器刷新任务列表和状态。

worker 领取流程：

1. 原子选择一个 ready 用户。
2. 确认 `running:user:{user_id}` 不存在。
3. 从该用户队列弹出下一个任务 ID。
4. 设置 `running:user:{user_id}` 为该任务 ID，并带 TTL。
5. 在 PostgreSQL 中将任务标记为 `running`，设置 `started_at`、`updated_at`、`heartbeat_at` 和 `claimed_by`。

领取操作应使用 Redis Lua 脚本或等价的原子事务实现，避免多个 worker 同时为同一个用户领取两个任务。

任务完成流程：

1. 将 PostgreSQL 任务状态更新为 `success` 或 `failed`。
2. 如果 `running:user:{user_id}` 仍指向该任务，则清除该运行锁。
3. 如果 `queue:user:{user_id}` 仍有等待任务，将用户重新加入 `users:ready`。
4. 发布用户事件。

第一版生产配置仍可以只启动一个 worker。后续确认 Codex 可承载更多并发后，只需增加 worker 数量，按用户限制并发的规则保持不变。

## SSE 动态更新

新增 `GET /api/events`，仅允许已登录用户访问。连接只推送当前 session 用户自己的事件。

事件应保持轻量，只作为刷新提示，例如：

```json
{"type":"task_updated","task_id":"...","status":"running"}
```

浏览器不把 SSE 事件当作事实源。收到事件后，前端调用 REST API 刷新当前任务、最近任务、报告可用状态和统计数据。

前端行为：

- 登录成功后跳转到 `/`，加载 session 和当前用户任务。
- 提交任务后，页面立即显示一个 `pending` 任务。
- `running`、`success`、`failed` 状态变化通过 SSE 到达。
- 任务成功后，前端自动加载 Markdown 报告并启用下载。
- SSE 自动重连。
- 重连后执行一次全量刷新，覆盖断线期间漏掉的事件。
- 保留低频兜底刷新，例如每 30 到 60 秒一次，避免代理或浏览器环境影响 SSE 后页面长期不更新。

现有任务台布局保持不变。前端主要改动是 session 管理、SSE 订阅和事件驱动刷新。

## API 设计

新增接口：

- `GET /login`：返回登录页。
- `POST /api/session`：使用姓名和手机号创建或刷新 session。
- `GET /api/session`：返回当前登录用户。
- `DELETE /api/session`：退出登录。
- `GET /api/events`：当前用户的 SSE 事件流。
- `GET /api/users/me/stats`：当前用户使用统计。

调整接口：

- `POST /api/tasks`：要求登录，使用 session 用户，不再信任 `requester`。
- `GET /api/tasks`：默认只返回当前用户任务。
- `GET /api/tasks/{task_id}`：要求任务归属当前用户。
- `GET /api/tasks/{task_id}/report`：要求任务归属当前用户。
- `GET /api/tasks/{task_id}/download`：要求任务归属当前用户。

管理员视图和跨用户任务访问不纳入第一版范围。

## 错误处理与恢复

PostgreSQL 不可用时，登录、创建任务、任务列表、worker 状态更新和报告元数据都不可用。接口返回明确的 5xx 错误。

Redis 不可用时：

- 登录仍可用。
- 历史任务查看和报告下载仍可用。
- 创建新任务返回明确的 503，因为任务无法进入调度。
- worker 暂停领取新任务。
- Redis 恢复后，通过 reconciliation 从 PostgreSQL 重建调度状态。

如果 PostgreSQL 任务创建成功但 Redis 入队失败，将任务标记为 `enqueue_failed`，并向用户返回明确错误。Redis 恢复后，恢复工具可以重新入队这些任务。

worker 运行期间同时刷新 Redis 锁 TTL 和 PostgreSQL `heartbeat_at`。服务启动或定时 reconciliation 会检查陈旧的 `running` 任务。第一版将陈旧 running 任务标记为 `failed`，释放该用户 Redis 运行锁，然后允许该用户的下一个排队任务继续。第一版不支持把部分执行过的任务重新入队。

Redis 不是持久事实源。PostgreSQL 始终是任务历史和任务状态的权威来源。

## 迁移

第一版实现可以初始化新的 PostgreSQL 数据库，不要求完整在线迁移。

如果需要保留旧 SQLite 数据，提供一次性迁移脚本：

- 将旧任务复制到 PostgreSQL。
- 保留 `requester` 文本。
- 由于旧 schema 没有手机号，将旧任务归到一个生成的 `legacy` 用户。
- 在安全的情况下保留旧报告路径，同时继续执行当前报告目录边界检查。

切换后，所有新写入只进入 PostgreSQL。

## 测试

用户和 session 测试：

- 新手机号创建用户。
- 同一手机号重复登录会更新姓名和 `last_seen_at`。
- session cookie 能认证后续请求。
- 退出登录会清除 session。

Repository 测试：

- PostgreSQL schema 初始化或迁移。
- 创建带 `user_id` 的任务。
- 按用户过滤任务列表。
- 状态流转和心跳更新。
- 用户统计查询。

调度器测试：

- 同一用户多个任务时，只能领取一个 running 任务。
- 任务完成后，同一用户的下一个任务变为可领取。
- 多用户之间可以轮转 ready 集合。
- Redis 领取操作在多个 worker 并发下保持原子性。
- Redis 状态可以从 PostgreSQL pending 任务重建。

worker 测试：

- 通过调度器领取任务。
- 领取后写入 running 状态和 worker 元数据。
- 刷新心跳和 Redis 锁 TTL。
- 成功或失败后释放用户锁。
- 发布用户事件。

API 测试：

- 未登录访问任务 API 会被拒绝或跳转。
- 已登录创建任务使用 session 用户。
- 用户不能访问其他用户的任务、报告或下载。
- Redis 入队失败会返回明确错误，并记录 `enqueue_failed`。

SSE 测试：

- 已登录用户可以连接。
- 未登录用户不能连接。
- 任务状态变化会发布事件。
- 事件只作为刷新提示，REST 响应仍是权威状态。

前端静态测试：

- `/login` 可访问。
- 现有任务台布局关键标记保持存在。
- 任务台初始化 session 状态。
- JavaScript 使用 `EventSource` 连接 `/api/events`。
- 成功事件会触发报告加载。

## 不在第一版范围内

- 密码认证。
- 管理员角色和跨用户仪表盘。
- OIDC、LDAP 或 SSO 集成。
- 完整 SPA 框架迁移。
- 复杂历史 SQLite 迁移，除非明确要求保留旧数据。
