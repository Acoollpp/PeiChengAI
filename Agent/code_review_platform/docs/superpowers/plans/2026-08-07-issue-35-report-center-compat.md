# Issue #35 报告中心真实数据与兼容实施计划

## Goal

在 #34/#37 工作台和 #36 报告反馈链路上，以真实服务端任务及 Markdown 数据完成报告中心、任务详情、新版固定模板、零问题和 1.x 历史任务兼容。

## Architecture

- 服务端继续提供任务元数据、逐问题快照计数和权限过滤，并从既有问题原文单查询聚合可空只读最高严重度，不新增数据库字段。
- Electron 共享层识别新版固定报告结构并输出问题、严重度、代码位置和分析状态。
- 生产适配器把真实任务列表转换成报告 view model，过滤成功但缺少 Markdown 路径的任务；列表就绪后自动选择并异步读取首份可读报告，其余报告逐份按点击读取，同时负责失败隔离与重试。
- #37 组件只消费明确的列表/内容/范围状态；fixture adapter 保持隔离。

## Tech Stack

- Electron 39、React 19、TypeScript、Vitest、Testing Library、Playwright。
- FastAPI、SQLModel、PostgreSQL、pytest、ruff、mypy。

## 测试边界

- `extractReviewIssues` / 报告分析器：Markdown 输入到结构化问题和摘要。
- `ProductionReviewWorkbench`：真实 preload bridge 到工作台行为。
- `ReviewWorkbenchPreview`：view model 到可见加载、空、失败、范围和操作状态。
- 报告上传、反馈 Markdown、反馈窗口和 PDF：既有公开 API/IPC 回归。
- `/review-tasks` 列表、详情、统计：HTTP 接口上的混合数据与权限。

## Task 1：固定模板 fixtures 与解析器

文件：

- `code_review_electron/src/shared/__tests__/fixtures/bms-code-reviewer-report-with-issues.md`
- `code_review_electron/src/shared/__tests__/fixtures/bms-code-reviewer-report-zero-issues.md`
- `code_review_electron/src/shared/__tests__/fixtures/review-report-fixtures.ts`
- `code_review_electron/src/shared/__tests__/review-issues.test.ts`
- `code_review_electron/src/shared/review-issues.ts`

步骤：

1. 按 Skill 固定模板写有问题、零问题和覆盖/非问题三级标题 fixture。
2. 写红测，要求只在“审查问题”章节识别 `Pxx [严重度]`，并提取描述、代码位置和严重度。
3. 最小实现新版结构解析，保留 template_1/template_2 兜底。
4. 运行共享解析测试并记录红绿结果。

## Task 2：报告摘要与审查范围 view model

文件：

- `code_review_electron/src/shared/review-report-analysis.ts`
- `code_review_electron/src/shared/__tests__/review-report-analysis.test.ts`
- `code_review_electron/src/renderer/src/workbench-preview/types.ts`
- `code_review_electron/src/renderer/src/workbench-preview/ProductionReviewWorkbench.tsx`

步骤：

1. 写红测锁定 high/medium/low/suggestion/none/unknown、现代零问题与历史未记录语义。
2. 增加分析 helper 和报告内容状态。
3. 保留原始审查项 ID，映射正式名称，空值显示历史未记录，未知 ID 不伪造名称。
4. 报告标题优先真实报告名，否则使用 SVN 范围。

## Task 3：服务端只读最高严重度摘要

文件：

- `code_review_server/backend/app/models.py`
- `code_review_server/backend/app/api/routes/review_tasks.py`
- `code_review_server/backend/tests/api/routes/test_review_tasks.py`
- `code_review_server/frontend/src/client/*`（只通过生成脚本更新）
- `code_review_electron/src/shared/types.ts`

步骤：

1. 写红测锁定有快照的四级严重度、新版零问题和无快照历史任务 `null`。
2. 在既有问题进度聚合查询中增加严重度 rank，不读取 Markdown、不做 N+1。
3. 向 `ReviewTaskPublic` 增加可空只读字段；不改数据库模型和迁移。
4. 同步 Electron 手写类型，并用生成脚本更新 Web client。

## Task 4：真实列表和选中报告按需加载

文件：

- `code_review_electron/src/renderer/src/workbench-preview/ProductionReviewWorkbench.tsx`
- `code_review_electron/src/renderer/src/workbench-preview/ProductionReviewWorkbench.test.tsx`

步骤：

1. 写列表加载、空列表、成功无路径、列表失败重试、首份兼容预览、选中报告按需加载、单份失败重试红测。
2. 列表只展示状态成功且存在 Markdown 路径的服务端元数据和最高严重度；ready 后自动选择并异步读取首份可读报告，但不依赖正文就绪，也不后台预读其他正文。
3. 避免陈旧请求覆盖新列表或当前选择；报告失败不影响工作台。
4. 证明生产端只调用真实 bridge，不读取 fixture。

## Task 5：#37 UI 状态与长内容

文件：

- `code_review_electron/src/renderer/src/workbench-preview/ReviewWorkbenchPreview.tsx`
- `code_review_electron/src/renderer/src/workbench-preview/ReviewWorkbenchPreview.test.tsx`
- `code_review_electron/src/renderer/src/workbench-preview/workbench-preview.css`
- `code_review_electron/src/renderer/src/workbench-preview/fixture-adapter.ts`

步骤：

1. 写报告列表 loading/error、正文 loading/error/parse_error、多审查项、历史空值和长文本红测。
2. 增加紧凑状态条、重试按钮、ID+名称范围和严重度完整语义。
3. 保持双栏、按钮文案、Markdown/PDF/反馈操作与响应式布局。
4. 更新 fixture 以覆盖视觉状态，但不得被生产入口导入。

## Task 6：反馈、PDF、图片和历史报告回归

文件：

- `code_review_electron/src/shared/__tests__/issue-feedback-markdown.test.ts`
- `code_review_electron/src/main/__tests__/report-uploader.test.ts`
- 必要时仅修改共享解析调用处，不改变协议。

步骤：

1. 用新版双问题 fixture 验证草稿定位和正式反馈插入不串位。
2. 验证上传快照仍为既有字段，图片资产路径不变。
3. 运行反馈窗口、PDF、Markdown 图片与旧报告级反馈测试。

## Task 7：服务端混合数据与权限证据

文件：

- `code_review_server/backend/tests/api/routes/test_review_tasks.py`

步骤：

1. 写新旧任务混合列表/详情测试，验证 `review_item_ids`、协议版本与计数语义。
2. 验证零问题任务不生成虚假问题，统计成功数保持任务口径。
3. 验证普通用户、部门管理员和管理员列表/详情/统计范围不变。
4. 仅在测试暴露缺陷时最小修复服务端；不做迁移。

## Task 8：完整验证与视觉验收

1. Electron 定向测试：解析、生产适配器、#37 UI、上传、反馈、PDF、图片和 IPC。
2. Electron：`npm test`、`npm run typecheck`、`npm run build`。
3. Backend：定向 pytest、受影响全量 pytest、`uv run ruff check app tests`、`uv run mypy app tests`。
4. 运行 preview 截图脚本和 production harness，在 1440×900、1280×800、1024×768 检查空、错误、多项和长文本。
5. `git diff --check`、`git status --short`，确认无无关改动。
6. 更新设计文档验收证据与残余风险。仓库无 `.codegraph/`，不得创建。

## 完成条件

- 所有新旧自动化测试、类型检查和构建通过；不能运行的验证有明确原因。
- 独立审核确认规格、历史兼容、行为回归、测试缺口和代码质量无阻断项。
- 不提交、不推送，由主智能体审核后按 Issue 流程交付 Draft PR。
