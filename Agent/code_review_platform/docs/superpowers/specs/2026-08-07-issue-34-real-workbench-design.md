# Issue #34：工作台真实任务状态接入设计

## 背景

#37 已建立并经人工验收的 2.0 工作台组件；#30 已将生产入口接到 Electron bridge；#31、#32、#33 已依次完成 DS-01 本地材料、多审查项执行和 DS-02 生产选择器。当前 `origin/main` 已包含真实提交、两槽本地队列、任务事件、取消、从头重试、日志、报告和反馈链路。

#34 只补齐真实工作台的剩余适配：复用现有 Electron 本地队列与任务事件，接入现有服务端 `/api/v1/review-tasks/stats` 统计，并为统计失败提供不阻断任务主流程的降级状态。本 Issue 不重新设计页面，不修改 Skill、提示词、材料协议、服务端统计口径，也不接入报告中心真实数据。

## 开始前审计

| #34 验收标准 | 现有实现 | 缺失内容 | 需要修改的位置 |
| --- | --- | --- | --- |
| 生产首屏复用 #37 的创建、总览、执行与等待组件并保留全部输入摘要 | `App.tsx` 生产入口渲染 `ProductionReviewWorkbench`，后者复用 `ReviewWorkbenchPreview`、`ReviewItemSelector`；SVN、revision、部门、DS-01/02/03、逐项规则和材料摘要已接通 | 服务端统计尚未进入既有总览组件 | `workbench-preview/types.ts`、`ProductionReviewWorkbench.tsx`、`ReviewWorkbenchPreview.tsx` |
| 真实等待/执行替换 fixture，提交、取消、重试、日志调用生产命令 | `useTaskQueue` 已调用 `executeTask`、`cancelTask`、`retryTask`；`ProductionReviewWorkbench` 已调用 `openTaskLog`；生产入口不导入 fixture | 需要用定向测试锁定真实命令和等待取消行为，禁止另建队列或命令接口 | 既有生产组件与 `useTaskQueue` 测试；实现原则上不重写业务代码 |
| 准确表达全部真实阶段 | `TaskProgressEvent` 与 `task-agent` 已发出 created、环境检查、准备工作区、执行 Codex、上传报告、成功、失败；队列本地维护等待和取消 | `uploading_report` 当前展示为“整理报告”，需统一为“上传报告”；补齐事件到工作台阶段的穷举测试 | `ProductionReviewWorkbench.tsx`、相关测试 |
| 不展示无来源的百分比、趋势或预计时间 | 当前工作台未展示此类数据 | 接入统计时只使用服务端已有精确计数，不消费 `trend` 和 `average_duration_seconds` 做装饰性展示 | 统计类型和总览渲染测试 |
| 每客户端最多两个并发，第三项等待，终态释放槽位 | `MAX_CONCURRENT_REVIEW_TASKS = 2`；队列 effect 按本地执行数启动；完成、异常、超时、取消都会转终态 | 按 #34 场景补齐“两个运行 + 第三个等待”以及完成、失败、取消分别释放槽位的集中回归 | `hooks/useTaskQueue.test.tsx` |
| 等待任务不提前建服务端记录；等待数来自当前实例 | `submitTask` 只创建本地项，进入槽位后才调用 `task:execute`，服务端记录在 `executeReviewTask` 中创建；`queueIndex` 与 queued 数均来自 hook 内存 | 用自动化测试明确断言第三项等待期间未调用执行 IPC；总览等待值必须始终绕过服务端统计 | `useTaskQueue` 测试、`ReviewWorkbenchPreview` 总览逻辑 |
| 服务端统计失败不阻断创建/队列/执行并显示明确错误 | 后端统计端点已存在并按权限范围返回 today/this_week/last_week/yesterday/all；Electron 尚无统计 API/IPC | 增加只读统计契约、独立加载状态、明确错误提示和重试；统计请求不得参与创建可用性判断 | `main/api-client.ts`、`main/ipc.ts`、`preload/index.ts`、`renderer/code-review-api.ts`、`shared/types.ts`、生产工作台与测试 |
| 生产不读 fixture，预览和 fixture adapter 保留 | `renderer-entry.test.ts` 已锁定生产/预览隔离；fixture adapter 独立存在 | 新增统计视图模型后需同步 fixture adapter，但生产仍只能通过 bridge 读取真实统计 | `fixture-adapter.ts` 及其测试、入口隔离测试 |
| 真实状态继续满足 #37 视觉基线 | 已有三视口 production harness 和截图脚本，覆盖长名称、长规则、长文件名、焦点与溢出 | 增加统计加载、错误、空队列和多任务状态的真实组件验收；不得重做布局 | `production-harness-main.tsx`、`capture-workbench-preview.mjs`、视觉验收文档/截图 |
| 自动化覆盖并发、排队、释放、阶段、取消、重试和适配器隔离 | 前序测试覆盖大量队列、DS 与 IPC 行为 | 汇总补齐 #34 指定场景，尤其统计降级、阶段文案和生产统计 IPC | Electron 相关测试文件 |

## 目标

- 保持 #37 的组件结构和现有生产入口。
- 继续以 `useTaskQueue` 作为当前 Electron renderer 实例的唯一等待队列来源。
- 通过现有 Electron IPC 三层契约读取服务端今日任务统计。
- 统计加载、刷新或失败不影响环境状态、表单、队列、执行和日志操作。
- 展示可验证阶段与计数，不展示无可靠来源的比例、趋势和预计时间。

## 非目标

- 不接入报告中心的真实分页、搜索或服务端报告数据；该范围属于 #35。
- 不增加服务端队列、客户端持久化队列、租约、心跳或跨客户端恢复。
- 不修改后端统计端点、数据库模型或迁移。
- 不修改 DS-01/02/03 目录、材料规则、工作区复制、提示词或 revision 传递。
- 不修改正式 Skill。

## 设计

### 服务端统计契约

Electron 共享类型新增与既有 `ReviewTaskStatsPublic` 兼容的只读结构。主进程 `ApiClient` 新增读取 `/api/v1/review-tasks/stats?range=today` 的方法；IPC、preload 和 renderer API 增加同一个只读命令。保持现有 IPC 镜像方式，不让 renderer 直接访问网络。

生产工作台独立加载统计。加载成功后，既有四项总览中的服务端指标使用 `running`、`failed_or_error` 和 `success`；“本机等待”始终使用 `useTaskQueue().queuedTasks` 对应的 view model 数量。总览文案明确服务端指标的时间范围；不展示服务端 `trend` 或 `average_duration_seconds`。

加载中使用占位状态。加载失败显示明确的可重试错误提示，并保留本机等待数、任务创建表单、执行与等待列表、取消、重试和日志操作。统计错误不写入 `canCreateTask`，也不复用全局成功提示覆盖任务事件。

首次加载和用户手动重试显示加载态；后台自动刷新保留当前已显示的统计值。工作台只观察任务的服务端统计语义：本地等待/尚未绑定、已绑定运行、服务端终态。任务首次绑定服务端记录，以及进入成功、失败或环境异常终态时各刷新一次；运行任务取消则等待远端取消流程结束后刷新，避免本地取消状态抢先读到服务端旧值，即使远端取消失败也刷新一次以呈现服务端真实状态。本地等待取消、Codex 日志和相同语义阶段的重复事件不触发刷新。同一批状态变化合并为一次请求，请求序号保证迟到的旧响应不能覆盖新值。首次载入的服务端历史任务只登记当前语义，不额外刷新。

### 任务阶段

阶段继续完全由 `TaskProgressEvent`、本地 queued 状态和执行结果派生：

| 来源 | 工作台阶段 | 显示文案 |
| --- | --- | --- |
| 本地 `queued` | `waiting` | 本机等待 |
| `created` / `checking_environment` | `checking_environment` | 环境检查 |
| `preparing_workspace` | `preparing_workspace` | 准备工作区 |
| `running_codex` | `running_review` | 执行 Skill |
| `uploading_report` | `uploading_report` | 上传报告 |
| `success` | `completed` | 完成 |
| `failed` / `environment_error` / rejected promise | `failed` | 失败 |
| 本地取消或执行结果 `cancelled` | `cancelled` | 已取消 |

不引入百分比、预计完成时间或基于日志猜测的阶段。

### 队列与服务端记录

不改变现有调度算法。提交只加入 renderer 内存队列；只有 slot effect 将任务置为 starting 并调用 `task:execute` 后，主进程才在 `executeReviewTask` 内调用服务端 `createTask`。运行 promise 的成功、失败、超时或取消都清理 active run 并把 `isLocallyExecuting` 置为 false，现有 effect 自动补位。

等待任务取消只改本地终态，不调用远端取消，因为服务端记录尚不存在。失败后重试保留原始 `executePayload`；已有服务端任务则调用 `task:retry` 从头执行。

### 兼容性

- 统计类型和 IPC 只新增，不删除旧接口或字段。
- 历史任务缺少 `review_item_ids` 时继续走现有显示和匹配兜底。
- DS-01 材料继续只保存在本地，并在任务真正开始后复制到工作区。
- DS-02、DS-03 继续无专项材料；逐项规则、材料和 revision 结构不变。
- fixture adapter 继续服务开发预览；生产入口不得导入或读取 fixture。
- 统计失败属于只读副流程失败，不得阻断任务创建和执行。

## 测试策略

- API client、main IPC、preload 和 renderer 类型测试锁定统计路径、鉴权和三层 channel。
- `useTaskQueue` 测试覆盖两运行一等待，以及成功、失败、取消分别释放槽位，等待取消不调用远端，等待期间无服务端执行请求，从头重试与日志命令。
- 生产工作台测试覆盖统计成功、加载和失败降级，任务绑定/终态自动刷新、重复事件去重与请求竞态，且失败时仍可创建、取消、重试和打开日志。
- 阶段映射测试穷举等待、环境检查、准备工作区、执行 Skill、上传报告、完成、失败、取消。
- 入口隔离与 fixture adapter 测试证明生产不读 fixture、预览仍可独立运行。
- 回归 DS-01、DS-02、DS-03 单选和组合、逐项规则/材料隔离、DS-01 本地复制、提示词与 revision 原样传递。
- 运行 Electron 全量测试、类型检查、构建和三视口真实组件截图检查。
