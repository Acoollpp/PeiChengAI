# 任务统计平均运行时间设计

## 背景

首页 `任务统计` 当前展示总任务数、成功数、失败/异常数、运行中数、报告生成数和状态分布。用户希望将顶部摘要卡中的 `运行中数` 替换为任务平均运行时间，并让任务统计和意见统计一样支持 `今日`、`昨日`、`累计` 三个统计维度。

本次只做数据看板增强，不修改数据库结构，不改变任务创建、执行、状态更新或报告上传流程。

## 已确认决策

- 继续在当前 `5174` 端口预览本次分支效果。
- `15174` 才是测试服务端口；本次不要把 `5174` 称为测试服务。
- 不做数据库迁移。
- 后端沿用 `review_task.created_at` 做统计范围过滤。
- 平均运行时间使用现有 `started_at` 和 `finished_at` 计算。
- 首页顶部摘要不再展示 `运行中数`，改为 `平均运行时间`。
- `running` 字段暂时保留在 API 响应中，避免影响旧调用方。

## 数据口径

### 时间范围

- `today` / `今日`：Asia/Shanghai 今天 00:00 至当前时间。
- `yesterday` / `昨日`：Asia/Shanghai 昨天 00:00 至今天 00:00。
- `all` / `累计`：当前权限范围内全部历史任务。

时间过滤字段为 `ReviewTask.created_at`。前端只传范围枚举，不在浏览器计算起止时间。

### 权限范围

- 普通用户：只统计 `ReviewTask.user_id == current_user.id` 的任务。
- 管理员：统计全部任务，并继续展示报告生成数排行。

### 平均运行时间

`average_duration_seconds` 只统计所选范围内同时满足以下条件的任务：

- `started_at` 不为空。
- `finished_at` 不为空。
- `finished_at >= started_at`。

计算方式为 `finished_at - started_at` 的平均秒数，向下取整为整数秒。没有可计算任务时返回 `null`，前端显示 `-`。

### 其他指标

以下指标都跟随 `range` 变化：

- `total`
- `success`
- `running`
- `failed_or_error`
- `by_status`
- `reports_by_user`

## 后端设计

在 `ReviewTaskStatsPublic` 中新增字段：

```text
range: FeedbackStatsRange
average_duration_seconds: int | None
```

复用已有 `FeedbackStatsRange` 枚举，避免再创建一套含义完全相同的范围类型。`GET /api/v1/review-tasks/stats` 新增查询参数：

```text
range=today | yesterday | all
```

默认值为 `today`，与意见统计保持一致。

## 前端设计

`TaskStatsPanel` 增加 `今日 / 昨日 / 累计` 切换按钮，交互和 `FeedbackStatsPanel` 保持一致。

顶部摘要卡调整为：

- `总任务数`
- `成功数`
- `失败/异常数`
- `平均运行时间`

平均运行时间格式化规则：

- `null`：`-`
- 小于 1 小时：按分钟展示，例如 `45分钟`
- 小于 1 天：按小时展示，例如 `3小时`
- 1 天及以上：按天展示，例如 `2天`

## 验收标准

1. 首页任务统计可切换 `今日`、`昨日`、`累计`。
2. 顶部摘要不展示 `运行中数`，展示 `平均运行时间`。
3. 统计接口不修改数据库结构，不新增迁移。
4. 普通用户和管理员统计范围仍遵守现有权限。
5. 后端接口测试和前端类型检查通过。
