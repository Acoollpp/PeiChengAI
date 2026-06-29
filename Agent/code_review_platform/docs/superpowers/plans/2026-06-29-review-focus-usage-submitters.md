# Review Focus Usage Submitters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the submitter names behind each aggregated review focus user input statistic.

**Architecture:** The backend usage-stats aggregation joins `ReviewTask.user_id` to `User.full_name`, accumulates distinct submitter names per normalized input content, and returns them as `submitter_names`. The frontend displays the names in a new table column and includes the same column in Excel export.

**Tech Stack:** FastAPI, SQLModel, pytest, OpenAPI-generated TypeScript client, React, TanStack Query.

---

### Task 1: Backend Contract And Export

**Files:**
- Modify: `code_review_server/backend/tests/api/routes/test_review_focus_directions.py`
- Modify: `code_review_server/backend/app/models.py`
- Modify: `code_review_server/backend/app/api/routes/review_focus_directions.py`

- [ ] **Step 1: Write failing backend tests**

Add `full_name` support to `_create_task_with_focus_snapshot`, assert `submitter_names` in `test_admin_can_read_usage_stats_grouped_by_normalized_content`, and update Excel headers/rows in `test_admin_can_export_filtered_usage_stats_excel`.

- [ ] **Step 2: Run backend tests to verify failure**

Run: `cd code_review_server && uv run pytest backend/tests/api/routes/test_review_focus_directions.py::test_admin_can_read_usage_stats_grouped_by_normalized_content backend/tests/api/routes/test_review_focus_directions.py::test_admin_can_export_filtered_usage_stats_excel -q`

Expected: fail because `submitter_names` is not returned and Excel has no submitter column.

- [ ] **Step 3: Implement backend aggregation**

Add `submitter_names: list[str] = Field(default_factory=list)` to `ReviewFocusDirectionUsageStatPublic`, join `User` in `_build_usage_stats`, collect non-empty `full_name` values into a set per content, return sorted names, and append the Excel column.

- [ ] **Step 4: Run backend tests**

Run the same focused pytest command and expect both tests to pass.

### Task 2: Frontend Display

**Files:**
- Modify: `code_review_server/frontend/src/client/types.gen.ts`
- Modify: `code_review_server/frontend/src/client/schemas.gen.ts`
- Modify: `code_review_server/frontend/src/components/Admin/ReviewFocusDirectionsPage.tsx`

- [ ] **Step 1: Update generated client shape locally**

Add optional `submitter_names?: Array<string>` to the TypeScript type and schema so the page compiles before the next full client regeneration.

- [ ] **Step 2: Add table column**

Add a `提交用户` table header and cell that renders `stat.submitter_names?.join("、") || "-"`. Update empty/loading `colSpan` from 5 to 6.

- [ ] **Step 3: Run frontend verification**

Run: `cd code_review_server && bun run type-check`

Expected: type-check succeeds.

### Task 3: Final Verification

- [ ] **Step 1: Run focused backend tests**

Run: `cd code_review_server && uv run pytest backend/tests/api/routes/test_review_focus_directions.py::test_admin_can_read_usage_stats_grouped_by_normalized_content backend/tests/api/routes/test_review_focus_directions.py::test_admin_can_export_filtered_usage_stats_excel -q`

- [ ] **Step 2: Review diff**

Run: `git diff -- code_review_server/backend/app/models.py code_review_server/backend/app/api/routes/review_focus_directions.py code_review_server/backend/tests/api/routes/test_review_focus_directions.py code_review_server/frontend/src/client/types.gen.ts code_review_server/frontend/src/client/schemas.gen.ts code_review_server/frontend/src/components/Admin/ReviewFocusDirectionsPage.tsx docs/superpowers/plans/2026-06-29-review-focus-usage-submitters.md`
