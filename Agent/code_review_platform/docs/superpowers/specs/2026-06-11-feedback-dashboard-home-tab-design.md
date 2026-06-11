# 首页意见统计 Tab 设计

## 背景

首页当前展示任务统计，包括任务总数、成功数、失败/异常数、运行中数、报告生成数和状态分布。平台已经有独立的意见管理页面，后端已有 `feedback` 与 `feedback_screenshot` 数据结构，意见状态包含 `pending`、`processing`、`resolved`，并记录提交人、创建时间、更新时间和截图元数据。

本次目标是在首页增加一个 Tab，用于展示意见管理数据看板。该功能只做统计展示，不修改数据库表结构，不改变意见提交、意见列表和状态维护流程。

## 已确认决策

- 首页增加 `任务统计` 和 `意见统计` 两个 Tab。
- 默认仍展示现有 `任务统计`。
- `意见统计` 使用现有意见数据聚合，不新增或修改数据库字段。
- 时间范围使用 `今日`、`昨日`、`累计`。
- 不展示 `带截图` 指标。
- 普通用户只统计自己的意见；管理员统计全部意见，和当前意见管理页权限保持一致。
- 管理员可看到提交人排行；普通用户不展示提交人排行。

## 目标

1. 在首页提供意见反馈处理情况的数据看板。
2. 让管理员快速看到今日、昨日和累计的意见数量、状态分布和提交人排行。
3. 让普通用户看到自己意见的处理情况。
4. 保持实现克制，不引入数据库迁移。

## 非目标

- 不修改 `feedback` 或 `feedback_screenshot` 表结构。
- 不新增处理人、优先级、标签、备注等字段。
- 不改变意见管理列表页的筛选、详情和状态修改能力。
- 不统计截图数量或带截图比例。
- 不做复杂 BI，如自定义日期范围、导出、同比环比和多维钻取。

## 推荐方案

新增一个轻量统计接口 `GET /api/v1/feedback/stats`，后端从现有 `feedback` 表聚合数据。前端首页使用现有 Tabs 组件包裹统计区域，在 `任务统计` 与 `意见统计` 间切换。

选择该方案的原因：

- 统计数据来自服务端聚合，不受列表分页影响。
- 不改数据库，风险集中在 API 和首页 UI。
- 权限逻辑可以复用意见管理页的范围规则。
- 后续如果要增加更多看板指标，可以在同一统计接口上扩展。

## 数据口径

### 时间范围

- `today` / `今日`：按服务端业务时区计算，今天 00:00 至当前时间。
- `yesterday` / `昨日`：按服务端业务时区计算，昨天 00:00 至今天 00:00。
- `all` / `累计`：当前权限范围内全部历史意见。

服务端业务时区沿用部署环境的本地时区或现有应用配置。前端只传范围枚举，不在浏览器自行计算起止时间，避免用户本地时区造成统计差异。

### 权限范围

- 普通用户：只统计 `Feedback.user_id == current_user.id` 的意见。
- 管理员：统计全部意见。

### 指标

- `total`：所选范围内意见总数。
- `pending`：所选范围内当前状态为 `pending` 的意见数。
- `processing`：所选范围内当前状态为 `processing` 的意见数。
- `resolved`：所选范围内当前状态为 `resolved` 的意见数。
- `by_status`：状态分布，包含 `pending`、`processing`、`resolved`，缺失状态补 0。
- `trend`：提交趋势。`今日`、`昨日` 按小时统计；`累计` 按日期统计，第一版最多返回最近 30 个有数据日期或最近 30 天。
- `resolution_rate`：`resolved / total`，`total` 为 0 时返回 0。
- `unresolved`：`pending + processing`。
- `average_resolution_seconds`：只统计当前状态为 `resolved` 且存在 `created_at`、`updated_at` 的意见，计算 `updated_at - created_at` 的平均秒数。
- `feedback_by_user`：管理员可见，按提交人统计意见数，按数量倒序，第一版返回前 10 名。

## 后端设计

### 响应模型

在 `models.py` 中新增公开模型：

```text
FeedbackStatsRange = today | yesterday | all
FeedbackStatusStatsPublic
FeedbackTrendPointPublic
FeedbackUserStatsPublic
FeedbackStatsPublic
```

`FeedbackStatsPublic` 字段：

```text
range: FeedbackStatsRange
total: int
pending: int
processing: int
resolved: int
unresolved: int
resolution_rate: float
average_resolution_seconds: int | None
by_status: dict[FeedbackStatus, int]
trend: list[FeedbackTrendPointPublic]
feedback_by_user: list[FeedbackUserStatsPublic]
```

`feedback_by_user` 对普通用户返回空数组。

### API

新增接口：

```text
GET /api/v1/feedback/stats?range=today
```

参数：

- `range`：可选，默认 `today`，允许 `today`、`yesterday`、`all`。

行为：

1. 根据当前用户角色生成权限过滤条件。
2. 根据 `range` 生成 `created_at` 时间过滤条件。
3. 聚合状态数量和总数。
4. 聚合趋势数据。
5. 管理员额外聚合提交人排行。
6. 返回缺省状态补 0 的稳定结构。

接口必须声明在 `/{feedback_id}` 动态路由之前，避免 `stats` 被解析成 UUID。

## 前端设计

### 首页结构

首页保留欢迎区，在统计区上方新增 Tabs：

- `任务统计`：渲染现有 `TaskStatsPanel` 内容。
- `意见统计`：渲染新增 `FeedbackStatsPanel`。

默认选中 `任务统计`，保持用户进入首页时的现有体验。

### 意见统计面板

新增组件：

```text
frontend/src/components/Home/FeedbackStatsPanel.tsx
```

组件职责：

- 使用 React Query 请求 `GET /api/v1/feedback/stats`。
- 管理 `今日 / 昨日 / 累计` 选中状态。
- 展示加载、错误、空数据和正常数据状态。
- 根据当前用户角色决定是否展示提交人排行。

### UI 内容

顶部摘要卡片：

- `总意见数`
- `待处理`
- `处理中`
- `已解决`

图表区域：

- `状态分布`：横向进度条，展示待处理、处理中、已解决。
- `提交趋势`：柱状图。今日/昨日按小时，累计按日期。

底部区域：

- `提交人排行`：管理员可见，展示前 10 名。
- `处理概览`：解决率、未解决数、平均解决耗时。

普通用户不展示提交人排行，底部布局应自适应为单栏或让处理概览占满宽度。

## 错误处理

- 统计接口返回 401：沿用全局登录失效处理。
- 统计接口返回 403：前端展示 `无权限查看意见统计`。
- 网络或服务端错误：前端展示 `意见统计加载失败，请稍后重试。`
- 无数据：摘要卡显示 0，图表区域展示空状态文案。
- 平均解决耗时无可统计数据：展示 `-`。

## 测试计划

后端测试：

1. 普通用户只统计自己的意见。
2. 管理员统计全部意见。
3. `today`、`yesterday`、`all` 时间范围过滤正确。
4. 三种状态缺失时返回 0。
5. 管理员返回提交人排行，普通用户返回空数组。
6. 平均解决耗时只统计已解决意见。

前端测试：

1. 首页显示 `任务统计` 和 `意见统计` Tab。
2. 默认展示任务统计。
3. 切换到意见统计后显示四个摘要卡片。
4. `今日 / 昨日 / 累计` 切换会重新请求统计数据。
5. 管理员可见提交人排行。
6. 普通用户不显示提交人排行。
7. 统计接口错误时显示错误状态。

## 验收标准

1. 首页可以在 `任务统计` 和 `意见统计` 间切换。
2. 意见统计不展示截图相关指标。
3. 时间范围为 `今日`、`昨日`、`累计`。
4. 统计范围遵守现有意见管理权限。
5. 不产生数据库迁移。
6. 后端和前端相关测试通过。
