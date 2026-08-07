# Issue #34：工作台真实任务状态接入实施计划

## Goal

在不重写 #30/#31/#32/#33 真实任务链路和 #37 组件的前提下，接通现有服务端任务统计，修正真实阶段展示，并用自动化与三视口验收锁定 Electron 本地两槽队列、降级行为和旧功能兼容。

## Architecture

- 服务端既有 `/api/v1/review-tasks/stats?range=today` 是统计唯一来源。
- Electron main `ApiClient` 负责 HTTP；main IPC、preload、renderer API 保持三层镜像。
- `ProductionReviewWorkbench` 组合真实统计与 `useTaskQueue`；fixture adapter 只服务预览。
- `useTaskQueue` 保持唯一的本地等待队列与两槽调度器。
- `ReviewWorkbenchPreview` 继续作为共享 UI，只消费视图模型和命令。

## Task 1：增加只读统计契约

文件：

- `code_review_electron/src/shared/types.ts`
- `code_review_electron/src/main/api-client.ts`
- `code_review_electron/src/main/__tests__/api-client.test.ts`
- `code_review_electron/src/main/ipc.ts`
- `code_review_electron/src/main/__tests__/ipc.test.ts`
- `code_review_electron/src/preload/index.ts`
- `code_review_electron/src/preload/index.test.ts`
- `code_review_electron/src/renderer/src/code-review-api.ts`

步骤：

1. 先写失败测试，断言统计请求使用 today 范围、Authorization 和固定 API 路径。
2. 为 `task:stats` 增加 main handler、preload 暴露与 renderer 类型。
3. 保持 IPC 注册顺序测试同步，不弱化既有断言。
4. 跑 API client、IPC 和 preload 定向测试。

## Task 2：接入工作台统计与降级状态

文件：

- `code_review_electron/src/renderer/src/workbench-preview/types.ts`
- `code_review_electron/src/renderer/src/workbench-preview/ProductionReviewWorkbench.tsx`
- `code_review_electron/src/renderer/src/workbench-preview/ReviewWorkbenchPreview.tsx`
- `code_review_electron/src/renderer/src/workbench-preview/workbench-preview.css`
- `code_review_electron/src/renderer/src/workbench-preview/ProductionReviewWorkbench.test.tsx`
- `code_review_electron/src/renderer/src/workbench-preview/ReviewWorkbenchPreview.test.tsx`

步骤：

1. 先写统计成功、加载、失败和重试的失败测试。
2. 增加独立统计状态；统计错误不得参与 `canCreateTask`。
3. 让运行、失败和成功计数来自服务端 today 统计，让等待数始终来自当前 renderer 队列。
4. 失败时显示明确、可重试的降级提示，继续渲染和操作表单、执行列表。
5. 任务首次绑定服务端记录、进入执行终态或完成远端取消后静默刷新；等待取消、日志与重复阶段不刷新，迟到响应不得覆盖新值。
6. 不展示 trend、增长率、精确百分比、平均耗时或预计完成时间。

## Task 3：锁定真实阶段与生产命令

文件：

- `code_review_electron/src/renderer/src/workbench-preview/ProductionReviewWorkbench.tsx`
- `code_review_electron/src/renderer/src/workbench-preview/ProductionReviewWorkbench.test.tsx`

步骤：

1. 将上传阶段统一显示为“上传报告”。
2. 穷举测试等待、环境检查、准备工作区、执行 Skill、上传报告、完成、失败、已取消。
3. 断言提交、运行中取消、等待取消、失败后从头重试和日志入口调用现有生产 bridge。

## Task 4：补齐本地队列和旧功能回归

文件：

- `code_review_electron/src/renderer/src/hooks/useTaskQueue.test.tsx`
- 受影响的既有 DS、材料、提示词和 task-agent 测试

步骤：

1. 写两个任务并行、第三个等待且未调用 `executeTask` 的测试。
2. 分别验证成功、rejected 失败和取消释放槽位并启动下一项。
3. 验证等待取消不调用 main cancel；失败任务从原始输入重新开始。
4. 回归 DS-01、DS-02、DS-03 单选和组合、逐项规则/材料隔离、DS-01 执行前复制、提示词与 revision 原样传递。

## Task 5：保持 fixture 隔离并完成视觉验收

文件：

- `code_review_electron/src/renderer/src/workbench-preview/fixture-adapter.ts`
- `code_review_electron/src/renderer/src/workbench-preview/fixture-adapter.test.ts`
- `code_review_electron/src/main/__tests__/renderer-entry.test.ts`
- `code_review_electron/src/renderer/src/production-harness-main.tsx`
- `code_review_electron/scripts/capture-workbench-preview.mjs`
- `code_review_electron/docs/issue-34/`

步骤：

1. fixture adapter 提供类型兼容的模拟统计，但生产入口不导入 fixture。
2. production harness 仅注入可控 bridge，覆盖统计成功和错误、空队列、多任务、长文本与禁用状态。
3. 在 1440x900、1280x800、1024x768 检查重叠、横向溢出、焦点、导航和按钮可用性。
4. 临时运行产物不得提交；只提交必要的验收文档和最终截图（若项目既有流程要求）。

## Final Verification

1. `npm test`
2. `npm run typecheck`
3. `npm run build`
4. `npm run capture:workbench`
5. `git diff --check origin/main...HEAD`
6. 核对生产入口无 fixture 引用，报告中心未扩展 #35 范围。
7. 核对 Worktree 只包含 #34 相关修改，主检出目录用户变更未被触碰。
