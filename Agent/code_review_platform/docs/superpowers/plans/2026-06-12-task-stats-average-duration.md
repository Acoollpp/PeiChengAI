# 任务统计平均运行时间 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the home task statistics dashboard to support 今日、昨日、累计 and replace the running-count summary card with average task duration.

**Architecture:** Extend the existing `GET /api/v1/review-tasks/stats` endpoint with a range parameter and an `average_duration_seconds` field computed from existing timestamps. Update `TaskStatsPanel` to request the selected range, render the same segmented controls as feedback stats, and display formatted average duration.

**Tech Stack:** FastAPI, SQLModel, PostgreSQL, React, TanStack Query, Playwright, Docker Compose.

---

## File Structure

- Modify `Agent/code_review_platform/code_review_server/backend/app/models.py`
  - Add `range` and `average_duration_seconds` to `ReviewTaskStatsPublic`.
- Modify `Agent/code_review_platform/code_review_server/backend/app/api/routes/review_tasks.py`
  - Add range-bound helpers, apply range filters to task stats queries, and compute average duration.
- Modify `Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_review_tasks.py`
  - Add tests for range filtering and average duration.
- Modify `Agent/code_review_platform/code_review_server/frontend/src/components/Home/TaskStatsPanel.tsx`
  - Add range state, range buttons, average duration formatting, and replace the `运行中数` card.
- Modify `Agent/code_review_platform/code_review_server/frontend/tests/home.spec.ts`
  - Update home assertions and mock task stats range switching.
- Regenerate frontend client files if the OpenAPI-generated types change.

---

### Task 1: Backend Stats Range and Average Duration

**Files:**
- Modify: `Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_review_tasks.py`
- Modify: `Agent/code_review_platform/code_review_server/backend/app/models.py`
- Modify: `Agent/code_review_platform/code_review_server/backend/app/api/routes/review_tasks.py`

- [ ] **Step 1: Write failing tests**

Add tests that create tasks with explicit `created_at`, `started_at`, and `finished_at`, then assert:

- `range=today` only counts today's tasks.
- `range=yesterday` only counts yesterday's tasks.
- `range=all` counts all scoped tasks.
- `average_duration_seconds` averages only valid completed durations.
- Normal users still only see their own scoped tasks.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
cd Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py::test_task_stats_support_today_yesterday_and_all_ranges tests/api/routes/test_review_tasks.py::test_task_stats_average_duration_uses_valid_finished_tasks -q
```

Expected: fail because the endpoint does not yet accept `range` or return `average_duration_seconds`.

- [ ] **Step 3: Implement the backend**

Add range helpers using Asia/Shanghai day boundaries, filter all task stats queries with those bounds, and return `range` plus `average_duration_seconds`.

- [ ] **Step 4: Verify backend tests pass**

Run:

```bash
cd Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -q
```

- [ ] **Step 5: Commit**

```bash
git add Agent/code_review_platform/code_review_server/backend/app/models.py Agent/code_review_platform/code_review_server/backend/app/api/routes/review_tasks.py Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "新增任务统计平均运行时间"
```

### Task 2: Frontend Task Stats Panel

**Files:**
- Modify: `Agent/code_review_platform/code_review_server/frontend/src/components/Home/TaskStatsPanel.tsx`
- Modify: `Agent/code_review_platform/code_review_server/frontend/tests/home.spec.ts`
- Modify generated client files if needed.

- [ ] **Step 1: Write failing frontend test updates**

Update home specs so task statistics expect:

- `今日`、`昨日`、`累计` range controls.
- `平均运行时间` visible.
- `运行中数` not visible.
- Switching ranges requests `today`、`yesterday`、`all`.

- [ ] **Step 2: Verify the frontend test fails**

Run:

```bash
cd Agent/code_review_platform/code_review_server/frontend
npx playwright test tests/home.spec.ts --grep "task statistics"
```

Expected: fail before `TaskStatsPanel` implements the new controls and label.

- [ ] **Step 3: Implement frontend panel changes**

Update `TaskStatsPanel` to track selected range, call `/api/v1/review-tasks/stats?range=<value>`, format average duration, and replace the running summary card.

- [ ] **Step 4: Verify frontend checks pass**

Run:

```bash
cd Agent/code_review_platform/code_review_server/frontend
npx tsc -p tsconfig.build.json --noEmit
npx biome check src/components/Home/TaskStatsPanel.tsx tests/home.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add Agent/code_review_platform/code_review_server/frontend/src/components/Home/TaskStatsPanel.tsx Agent/code_review_platform/code_review_server/frontend/tests/home.spec.ts Agent/code_review_platform/code_review_server/frontend/src/client
git commit -m "更新任务统计时间维度展示"
```

### Task 3: Preview Service Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run combined verification**

Run backend and frontend checks that can execute in the current environment:

```bash
cd Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py tests/api/routes/test_feedback.py -q
cd ../frontend
npx tsc -p tsconfig.build.json --noEmit
npx biome check src/components/Home/TaskStatsPanel.tsx src/components/Home/FeedbackStatsPanel.tsx tests/home.spec.ts
```

- [ ] **Step 2: Rebuild the 5174 preview service**

Run:

```bash
cd Agent/code_review_platform/code_review_server
docker compose up -d --build backend frontend
```

- [ ] **Step 3: Smoke check the preview**

Run:

```bash
curl -fsS http://localhost:8000/api/v1/utils/health-check/
curl -fsSI http://localhost:5174/
```

- [ ] **Step 4: Report preview URL**

Tell the user to preview at `http://172.23.17.242:5174`, and explicitly state that no merge has been performed.
