# 管理员与 SVN 仓库权限管理设计

## 背景

当前代码审查平台仍以 Web 服务形态运行。由于 SVN 权限在服务端集中执行，短期内存在用户可能提交非授权仓库地址的问题。长期方向是参考 Cherry Studio 一类客户端架构，把 SVN 访问下沉到用户本机或客户端侧，让 SVN 原生权限成为最终边界。

但当前时间窗口内不适合做完整客户端化重构，因此本阶段先在平台层增加用户权限管理：用手机号识别用户，用管理员维护用户和仓库授权，任务提交时由后端强制校验 SVN URL 是否落在当前用户可访问的仓库范围内。

## 目标

- 保留现有 Web 服务和任务执行链路。
- 继续使用姓名和手机号登录，手机号作为临时唯一身份。
- 增加管理员角色，管理员可进入后台页面。
- 管理员可新增账号、维护账号状态、配置仓库权限。
- 普通用户提交任务时仍可粘贴完整 SVN URL。
- 后端根据 SVN URL 前缀识别仓库分类，并进行权限校验。
- 管理员仪表盘展示平台使用情况，必须包含“用户-任务数”图表。

## 不在本阶段范围内

- 完整客户端化重构。
- SVN 账号密码托管。
- LDAP、OIDC、SSO 或企业统一身份集成。
- 复杂组织架构、部门角色和审批流。
- 密码登录体系。
- 管理员审计日志的完整闭环。

## 身份与角色

用户仍通过姓名和手机号登录。手机号经过规范化后作为唯一标识，同一手机号重复登录会更新用户姓名和 `last_seen_at`。

新增管理员角色：

- `users.is_admin` 表示用户是否为管理员。
- `users.is_active` 表示账号是否启用。
- 管理员账号可通过环境变量 `ADMIN_PHONES` 初始化，例如 `ADMIN_PHONES=15866582922,13800138000`。
- 用户登录或系统初始化时，如果手机号在 `ADMIN_PHONES` 中，则自动标记为管理员。
- 非管理员访问 `/admin` 或 `/api/admin/*` 返回 `403`。
- 停用账号不能创建任务，也不能访问普通任务接口和管理接口。

## SVN 仓库清单

仓库分为公共仓库和产品仓库。公共仓库默认所有登录用户可访问，产品仓库由管理员授权。

| key | 类型 | 名称 | URL 前缀 |
| --- | --- | --- | --- |
| public_repository | 公共 | 公共仓库 | `https://192.168.0.233/svn/02_public_repository` |
| documents | 公共 | 文档仓库 | `https://192.168.0.233/svn/documents` |
| energy | 产品 | 高压 | `https://192.168.0.233/svn/src_energy` |
| home | 产品 | 户储 | `https://192.168.0.233/svn/src_home` |
| bs | 产品 | 基站 | `https://192.168.0.233/svn/src_bs` |
| moto | 产品 | 动力 | `https://192.168.0.233/svn/src_moto` |
| lcd | 产品 | 显示屏 | `https://192.168.0.233/svn/src_lcd` |
| linux | 产品 | Linux | `https://192.168.0.233/svn/src_linux` |
| pace_tools | 产品 | 上位机 | `https://192.168.0.233/svn/src_PaceTools` |
| power | 产品 | 电源 | `https://192.168.0.233/svn/src_power` |

仓库清单第一版可以写入后端配置常量，避免引入额外配置管理复杂度。后续如仓库频繁变化，再迁移为数据库表或配置文件。

## 普通用户任务台

任务提交区保留完整 SVN URL 输入框，适配用户从 SVN 工具或文档中直接复制完整地址的习惯，例如：

```text
https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T
```

页面在输入框下方展示“可用仓库”辅助区：

- 显示当前用户可访问的公共仓库和已授权产品仓库。
- 每个仓库以前缀标签或按钮形式展示。
- 点击仓库前缀时，将对应 URL 前缀填入 SVN URL 输入框。
- 用户仍可直接粘贴完整 SVN URL。

提交时前端继续发送：

```json
{
  "svn_url": "https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T",
  "old_revision": "r15609",
  "new_revision": "r15652"
}
```

后端是权限判断的唯一可信边界。即使前端只展示可用仓库，后端仍必须解析和校验完整 URL。

## SVN URL 校验规则

后端对 `svn_url` 做以下处理：

1. 去除首尾空白。
2. 禁止空值和非 HTTPS URL。
3. 规范化仓库前缀匹配，要求 URL 等于仓库前缀，或以前缀加 `/` 开头。
4. 从仓库清单中识别 `repository_key`。
5. 未匹配任何仓库时返回 `400`。
6. 匹配公共仓库时允许所有启用用户提交。
7. 匹配产品仓库时，检查 `user_repository_permissions` 中是否有授权。
8. 未授权时返回 `403`。

为了避免前缀误匹配，`https://192.168.0.233/svn/src_home_other` 不能被识别为 `src_home`。

## 管理员入口与页面

在任务台右上角用户区域增加“管理后台”入口，位置与当前用户名、手机号、退出按钮相邻。仅管理员可见。

页面路由：

- `GET /admin` 返回管理员页面。
- 页面静态资源为 `static/admin.html` 和 `static/admin.js`。

管理员页面包含三块：

1. 仪表盘
2. 账号管理
3. 仓库权限管理

第一版可以使用同一个页面内的分区或轻量标签页，不引入前端框架。

## 仪表盘

仪表盘用于回答“平台使用情况如何”。第一版必须包含：

- 用户总数。
- 管理员数量。
- 启用账号数量。
- 任务总数。
- 今日任务数。
- 各状态任务数：`pending`、`running`、`success`、`failed`、`enqueue_failed`。
- 用户使用次数图表：按用户统计任务数。
- 仓库使用分布：按 `repository_key` 统计任务数。
- 最近任务列表。

用户使用次数图表第一版使用原生 HTML/CSS 横向柱状图，避免引入 ECharts 等新依赖。接口返回排序后的前若干名用户，默认按任务数倒序。

## 账号管理

管理员可执行：

- 新增账号：姓名、手机号、是否管理员。
- 查看账号列表：姓名、手机号、管理员标识、启用状态、最近登录时间、任务数。
- 编辑账号：姓名、是否管理员、启用状态。
- 查看或维护某个用户的产品仓库权限。

公共仓库不需要配置，页面显示为“默认开放”。

手机号仍为唯一键。管理员新增账号时，如果手机号已存在，应返回明确错误，或按接口设计更新现有账号。推荐第一版返回 `409`，避免误覆盖。

## 仓库权限管理

管理员在用户详情或账号列表侧边区域维护产品仓库权限。

交互方式：

- 选择一个用户。
- 展示产品仓库复选框。
- 勾选表示该用户可提交该仓库下任务。
- 保存后整体替换该用户的产品仓库授权列表。
- 公共仓库显示为只读项。

后端保存到 `user_repository_permissions` 表。只保存产品仓库授权，公共仓库由规则默认开放。

## 数据库变更

`users` 新增字段：

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
```

新增用户仓库权限表：

```sql
CREATE TABLE IF NOT EXISTS user_repository_permissions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repository_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, repository_key)
);
```

`tasks` 建议新增字段：

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_key TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_name TEXT;
```

新增字段用于仪表盘统计和后续排查，不改变现有 `svn_url` 的保存方式。

## 后端 API

普通接口：

- `GET /api/repositories`：返回当前用户可访问仓库列表，供任务台展示。
- `POST /api/tasks`：继续接收完整 `svn_url`，新增仓库识别和权限校验。
- `GET /api/session`：返回当前用户时增加 `is_admin`，用于前端判断是否展示管理入口。

管理员接口：

- `GET /api/admin/dashboard`：返回仪表盘统计数据。
- `GET /api/admin/users`：返回用户列表和基础统计。
- `POST /api/admin/users`：新增账号。
- `PATCH /api/admin/users/{user_id}`：更新姓名、管理员状态、启用状态。
- `GET /api/admin/users/{user_id}/repositories`：查询某用户产品仓库权限。
- `PUT /api/admin/users/{user_id}/repositories`：整体保存某用户产品仓库权限。

所有 `/api/admin/*` 接口都必须使用统一的 `current_admin_user` 守卫。

## 数据流

普通用户提交任务：

1. 用户登录。
2. 前端调用 `GET /api/repositories`。
3. 页面展示完整 SVN URL 输入框和可用仓库前缀。
4. 用户粘贴完整 URL 或点击前缀后补全路径。
5. 前端调用 `POST /api/tasks`。
6. 后端识别仓库并校验权限。
7. 权限通过后创建任务，写入 `repository_key` 和 `repository_name`。
8. 任务进入现有 Redis 调度与 Worker 执行流程。

管理员维护权限：

1. 管理员登录。
2. 前端展示管理后台入口。
3. 管理员进入 `/admin`。
4. 页面加载仪表盘和用户列表。
5. 管理员新增用户或修改权限。
6. 后端保存用户和仓库权限。
7. 用户下次刷新任务台后看到新的可用仓库列表。

## 错误处理

- 未登录访问普通 API 返回 `401`。
- 停用账号访问 API 返回 `403`。
- 普通用户访问管理页面或管理 API 返回 `403`。
- SVN URL 不属于配置仓库返回 `400`。
- SVN URL 属于未授权产品仓库返回 `403`。
- 新增账号手机号冲突返回 `409`。
- 仓库权限保存时包含未知 `repository_key` 返回 `400`。

## 测试计划

后端测试：

- `ADMIN_PHONES` 中的手机号登录后成为管理员。
- 非管理员看不到管理能力，访问管理 API 返回 `403`。
- 管理员可新增账号。
- 管理员可修改用户管理员状态和启用状态。
- 管理员可保存用户产品仓库权限。
- 所有用户可提交公共仓库任务。
- 未授权用户提交产品仓库任务返回 `403`。
- 已授权用户提交对应产品仓库任务成功。
- URL 前缀相似但不等价时不能绕过权限。
- 任务保存 `repository_key` 和 `repository_name`。
- 仪表盘返回用户任务数统计。

前端静态测试：

- 任务台包含管理员入口挂载点。
- 管理员入口仅依赖 `session.user.is_admin` 显示。
- 任务台保留完整 SVN URL 输入框。
- 页面渲染可用仓库前缀辅助区。
- 管理员页面包含仪表盘、账号管理、仓库权限管理区域。
- 管理员页面包含用户使用次数图表容器。

## 后续演进

本阶段是平台层临时权限控制，解决短期 SVN 权限风险。后续客户端化重构时，可复用以下资产：

- 用户与手机号身份数据。
- 仓库分类清单。
- 用户仓库授权关系。
- 仪表盘统计口径。
- 任务与仓库分类关联字段。

客户端化后，平台权限可转为“页面展示和任务归属控制”，SVN 实际访问权限由用户本机或客户端侧凭据承担。
