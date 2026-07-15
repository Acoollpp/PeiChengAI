# 首页周统计与客户端 SVN 地址历史 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Web 首页任务统计增加本周/上周维度和圆形报告比例图，并为 Electron 任务表单增加最近三条 SVN 地址选择。

**Architecture:** Web 只扩展现有统计组件和 E2E mock，不改后端 API。Electron 在 `TaskForm` 内封装本地历史读写，使用 `localStorage` 持久化最近三条成功提交的 SVN 地址。

**Tech Stack:** React、TypeScript、Tailwind CSS、Playwright、Vitest、Testing Library、浏览器 `localStorage`。

---

### Task 1: Web 任务统计周维度与圆形报告图

**Files:**
- Modify: `code_review_server/frontend/src/components/Home/TaskStatsPanel.tsx`
- Test: `code_review_server/frontend/tests/home.spec.ts`

- [ ] **Step 1: Write the failing test**

在 `taskStatsByRange` 增加 `this_week` 和 `last_week` mock，并更新 `Task statistics supports today yesterday and all ranges`，要求本周/上周按钮可点击且请求对应 range。增加断言报告生成数中出现 `汪思雨 100% 5份报告` 语义。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code_review_server/frontend && bunx playwright test tests/home.spec.ts --grep "Task statistics supports"`

Expected: FAIL，因为界面还没有本周/上周按钮，也没有圆形比例图语义。

- [ ] **Step 3: Write minimal implementation**

在 `TaskStatsRange` 加入 `this_week`、`last_week`，`rangeOptions` 加入「本周」「上周」。将报告生成数柱状图替换为 grid 中的环形图，使用 `conic-gradient` 根据 `item.report_count / totalReportCount` 绘制。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code_review_server/frontend && bunx playwright test tests/home.spec.ts --grep "Task statistics supports"`

Expected: PASS。

### Task 2: Electron SVN 地址最近历史

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`
- Test: `code_review_electron/src/renderer/src/components/TaskForm.test.tsx`

- [ ] **Step 1: Write the failing tests**

新增两个测试：成功提交后 `localStorage["code-review:recent-svn-urls"]` 只保留最新三条并去重；已有历史时聚焦 SVN 地址输入框显示三条历史，点击后回填。补一个失败提交不写历史的断言。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd code_review_electron && npm test -- src/renderer/src/components/TaskForm.test.tsx`

Expected: FAIL，因为当前没有历史下拉和保存逻辑。

- [ ] **Step 3: Write minimal implementation**

在 `TaskForm.tsx` 增加 `RECENT_SVN_URLS_STORAGE_KEY`、`readRecentSvnUrls`、`writeRecentSvnUrls`、`rememberRecentSvnUrl`。组件初始化读取历史，成功提交后记录当前 `svnUrl.trim()`；输入框聚焦时显示历史列表，点击按钮回填。

- [ ] **Step 4: Add styles**

在 `styles.css` 中新增 `.svn-url-field`、`.svn-url-history-list`、`.svn-url-history-item` 样式，保持当前深色表单风格。

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd code_review_electron && npm test -- src/renderer/src/components/TaskForm.test.tsx`

Expected: PASS。

### Task 3: Final verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused Web test**

Run: `cd code_review_server/frontend && bunx playwright test tests/home.spec.ts`

Expected: PASS。

- [ ] **Step 2: Run Electron renderer component test**

Run: `cd code_review_electron && npm test -- src/renderer/src/components/TaskForm.test.tsx`

Expected: PASS。

- [ ] **Step 3: Run type checks**

Run: `cd code_review_server/frontend && bun run build`

Expected: PASS。

Run: `cd code_review_electron && npm run typecheck`

Expected: PASS。
