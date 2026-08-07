# Issue #33：DS-02 与生产审查项选择器实施计划

## Goal

在现有 2.0 Workbench 和 #37 选择器上正式发布 DS-02，把全部选择交互接入生产任务草稿和真实本机任务载荷，同时保持服务端、本机队列、DS-01 材料和旧客户端兼容行为不变。

## Architecture

以 `src/shared/review-items.ts` 作为生产审查项目录唯一来源。生产 Workbench 把启用目录项映射为现有选择器 ViewModel；选择器只管理一次弹窗会话的临时草稿，主表单只接收“完成选择”的深拷贝结果。真实提交继续复用 `review_items -> useTaskQueue -> IPC -> task-agent` 链路，由主进程解析目录、在执行前准备 DS-01 材料，并向服务端仅发送 `review_item_ids`。

## Tech Stack

- Electron 39 / React 19 / TypeScript 5.9 strict
- Vitest / Testing Library / user-event
- electron-vite

## File Structure

- `docs/superpowers/specs/2026-08-07-issue-33-ds02-review-selector-design.md`：设计边界。
- `docs/superpowers/plans/2026-08-07-issue-33-ds02-review-selector.md`：本计划。
- `code_review_electron/src/shared/review-items.ts`：正式目录、稳定 ID 和输入解析。
- `code_review_electron/src/shared/review-items.test.ts`：目录与材料归属测试。
- `code_review_electron/src/renderer/src/workbench-preview/types.ts`：复用共享稳定 ID 类型。
- `code_review_electron/src/renderer/src/workbench-preview/ProductionReviewWorkbench.tsx`：正式目录适配与真实载荷。
- `code_review_electron/src/renderer/src/workbench-preview/ProductionReviewWorkbench.test.tsx`：生产任务表单集成测试。
- `code_review_electron/src/renderer/src/workbench-preview/ReviewItemSelector.tsx`：沿用现有选择器，统一“完成选择”语义。
- `code_review_electron/src/renderer/src/workbench-preview/ReviewItemSelector.test.tsx`：弹窗事务、键盘和逐项隔离测试。
- `code_review_electron/src/main/__tests__/review-task-prompt.test.ts`、`task-agent.test.ts`、`api-client.test.ts`：真实主进程载荷边界回归。

## Task 1：正式目录发布 DS-02

### 测试先行

在共享目录测试中先断言：

- 目录版本递增并按 10/20/30 排列三项。
- DS-02 的稳定 ID、分类、名称、简介、详情、启用状态和空材料定义完整。
- DS-02 单选及 DS-01 + DS-02、DS-02 + DS-03 解析成功。
- 各项额外规则独立，DS-02 拒绝夹带 DS-01 材料字段。

预期失败：当前目录不存在 DS-02，目录版本和解析均不满足断言。

### 最小实现

- 新增共享 `ReviewItemId` 类型。
- 在 DS-01 与 DS-03 之间加入 DS-02 正式元数据并递增目录版本。
- 保持外部输入 ID 为字符串，继续通过运行时解析兼容未知输入。

预期通过：共享目录测试全部通过。

## Task 2：生产选择器接入与草稿事务

### 测试先行

在生产 Workbench 和选择器测试中逐项加入：

- 生产目录出现 DS-02，分类、搜索、按分类选择、仅看已选、清空、数量和右侧详情来自正式目录。
- DS-02 单选确认后主表单显示，取消不回填。
- 已确认内容重开可见；二次修改后通过取消、关闭按钮、遮罩和 Escape 退出均恢复已确认内容。
- DS-01、DS-02、DS-03 的长额外规则切换后独立，DS-02 不显示文件选择按钮。
- 完成按钮文案与事务语义一致，关闭后焦点回到触发按钮。

预期失败：生产白名单排除 DS-02，现有测试未覆盖完整事务语义，按钮文案仍为“确认选择”。

### 最小实现

- 生产目录从所有已启用的正式稳定 ID 派生并按 `sortOrder` 排序，删除 DS-01/DS-03 白名单漂移点。
- Workbench ViewModel 复用共享稳定 ID 类型。
- 保留选择器内部深拷贝草稿，仅调整必要文案和防御性空目录处理。

预期通过：选择器与生产 Workbench 局部测试通过。

## Task 3：真实任务载荷与主进程边界

### 测试先行

从生产 UI 提交并断言：

- DS-02 单选载荷只含 DS-02 ID 和自身额外规则，无 `materials`。
- DS-01 + DS-02 载荷中 Excel/PDF 只属于 DS-01。
- DS-02 + DS-03 载荷中两项规则各自独立，均无材料。
- DS-01 + DS-03 旧组合载荷保持不变。
- old/new revision 保留用户原始大小写和 `r` 前缀。

从主进程公开边界断言：

- `resolveReviewItemInputs` 和 Skill 提示词包含 DS-02，逐项段落无串项。
- `ApiClient.createTask` 不向服务端发送 `review_items` 或本地材料，只发送 `review_item_ids`。
- `task-agent` 把原始 revision 与逐项输入交给本机准备/执行依赖。

预期失败：生产 UI 无法选择 DS-02；补齐目录后其余通用链路应直接转绿，若有失败只做最小契约修复。

## Task 4：fixture 隔离与旧功能回归

### 验证

- 生产 UI 不显示“填入验收样例”或“推进任务阶段”，真实命令只来自 `window.codeReview`。
- preview 入口及 fixture adapter 测试继续独立通过。
- DS-01 材料准备测试证明只在执行前复制到任务工作区。
- 队列旧测试证明两个并发槽、等待序号、取消和失败后从头重试不变。
- 旧任务缺少 `review_item_ids`、旧客户端缺少 `review_items` 的测试继续通过。

## Task 5：完整验证与自检

在 `code_review_electron` 执行：

```bash
npm run typecheck
npm test
npm run build
```

补充运行受影响测试文件，保留每轮 Red/Green 结果。最后检查：

- `git status --short` 只包含 Issue #33 文件。
- 未修改后端、数据库、Skill、服务端状态与报告路径。
- CSS 的双栏滚动、文件名溢出、textarea 滚动和 `:focus-visible` 规则仍存在。
- 记录真实 Electron 界面仍需人工检查的视口、长文本和键盘操作。
