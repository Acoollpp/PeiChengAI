# Issue #88 主题覆盖验证记录

## 自动化命令

- `node --check scripts/capture-issue-88-theme-coverage.mjs`：通过
- `node scripts/capture-issue-88-theme-coverage.mjs`：通过，生成截图证据
- `npm run typecheck`：通过
- `npm test -- App.theme.test.tsx ProductionReviewWorkbench.test.tsx ReviewWorkbenchPreview.test.tsx ReviewItemSelector.test.tsx MarkdownPreview.test.tsx SubmitFeedbackDialog.test.tsx ReportFeedbackWindow.test.tsx UpdateDialog.test.tsx SvnBindingDialog.test.tsx report-pdf-generator.test.ts theme-coverage.css.test.ts`：11 files / 178 tests passed
- `npm test`：54 files / 848 tests passed
- `npm run build`：通过
- `git diff --check`：通过
- `codegraph sync . && codegraph status`：主工作树索引最新

## 视觉验收覆盖

截图位于 `docs/issue-88/screenshots/`。

- 尺寸：`920×620`、`1180×760`、`1440×900`
- 主题：浅色、深色
- 主窗口页面：登录、任务管理、环境异常、报告中心、审查项选择、意见反馈
- 主窗口弹窗：SVN 绑定、更新弹窗
- 固定浅色例外：独立报告问题反馈窗口 `report-feedback-window-fixed-light-920x620.png`

## 用户反馈验证点

- 深色报告中心 Markdown 正文、表格、代码块、引用和链接均通过脚本对比度采样；`report-center-dark-920x620.png` 已覆盖最低尺寸。
- 浅色任务管理页任务标题、SVN 地址、进度、状态、更新时间等关键文字通过脚本字号和对比度采样；`task-management-light-920x620.png` 已覆盖最低尺寸。

## 说明

当前 Electron 侧没有可靠 GitHub CI，本记录中的命令为本地验证证据。
