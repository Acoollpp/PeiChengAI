# Code Review Task Management Design

Date: 2026-05-29

## Context

The current admin task page lists code review tasks directly under `任务管理`. The platform is expected to grow into a broader company AI management platform, so task management needs a clearer structure that can hold multiple task categories over time.

The current task table also combines execution client details in a single column and does not expose the task creator's real name or SVN account. Administrators need to search tasks by user identity and remove task records, including uploaded reports.

Electron client task persistence is out of scope for this design.

## Goals

- Change task management from a single sidebar item into a grouped navigation area.
- Add `代码审查任务管理` as the first child under `任务管理`.
- Show task creator identity as two separate fields: real user name and SVN account.
- Add server-backed filters for user name and SVN account.
- Add task deletion that also removes the associated uploaded report file.
- Keep the existing review task data model unless a schema change is required.

## Non-Goals

- Do not implement Electron client task persistence.
- Do not introduce a generic task type abstraction yet.
- Do not add broad fuzzy search across SVN URL, revision, status, or client fields.
- Do not change how review tasks are created or how reports are uploaded.

## Recommended Approach

Use route and navigation hierarchy for the task management structure, and enhance the existing review task API for admin filtering and deletion.

This avoids premature abstraction while still preparing the UI for additional AI task categories later. The existing `review_task` table remains the source of truth for code review tasks.

## Information Architecture

The admin sidebar should represent `任务管理` as an expandable group:

```text
任务管理
  └─ 代码审查任务管理
```

The code review task page should move to:

```text
/admin/tasks/review
```

The existing `/admin/tasks` route should redirect to `/admin/tasks/review` so old links continue to work without adding an extra overview page.

## Code Review Task Page

The page title should become `代码审查任务管理`.

The page should include a compact filter area above the table:

- 用户姓名 input
- SVN账号 input
- 搜索 button
- 重置 button

Search should run only when the user clicks `搜索`. Reset clears both inputs and reloads the unfiltered list.

The table columns should be:

```text
用户名称 | SVN账号 | SVN地址 | 版本 | 状态 | 执行客户端 | 报告 | 操作
```

Field behavior:

- `用户名称`: display `User.full_name`; show `-` when empty.
- `SVN账号`: display `User.svn_username`; show `-` when empty.
- `执行客户端`: keep using `client_hostname / client_version`; show `-` when both are empty.
- `报告`: keep the current open and download actions when `report_path` exists.
- `操作`: add a delete icon button.

Delete behavior:

- Clicking delete opens a confirmation dialog.
- The confirmation copy must make clear that the task record and uploaded report file will both be deleted.
- On success, refresh the task list and show a success toast.
- On failure, keep the row visible and show an error toast.

## Backend API

The existing list endpoint should support two optional filters:

```text
GET /api/v1/review-tasks?skip=0&limit=100&user_name=张三&svn_username=zhangsan
```

Filter behavior:

- `user_name` filters by partial match against `User.full_name`.
- `svn_username` filters by partial match against `User.svn_username`.
- When both filters are present, both must match.
- Admin users search across all review tasks.
- Normal users search only within their own review tasks.

The task public response should include user identity fields:

```text
user_name: string | null
svn_username: string | null
```

These fields are derived from the related `User` row:

- `user_name` maps to `User.full_name`.
- `svn_username` maps to `User.svn_username`.

The endpoint must not expose unnecessary user fields such as email, hashed password, or credential data.

Add a delete endpoint:

```text
DELETE /api/v1/review-tasks/{task_id}
```

Delete permissions:

- Admin users can delete any review task.
- Normal users can delete only their own review tasks.

Delete file handling:

- If `report_path` is set and the file exists, delete the report file before deleting the database record.
- If `report_path` is set but the file does not exist, still delete the database record.
- If the report file exists but cannot be deleted, return an error and leave the database record intact.

Successful deletion can return:

```json
{ "message": "Review task deleted" }
```

## Data Model

No database migration is needed.

The design uses existing fields:

- `ReviewTask.user_id`
- `User.full_name`
- `User.svn_username`
- `ReviewTask.client_hostname`
- `ReviewTask.client_version`
- `ReviewTask.report_path`

The response model changes are API-level only.

## Error Handling

- Invalid or unauthorized task deletion returns the existing 404 or 403 behavior from task ownership checks.
- Report file deletion failure returns a server error and does not delete the task row.
- Missing report files do not block task deletion.
- Search filters with empty strings should be treated as absent filters.

## Testing

Backend tests should cover:

- Admin list response includes `user_name` and `svn_username`.
- `user_name` filter matches only tasks owned by users with matching names.
- `svn_username` filter matches only tasks owned by users with matching SVN accounts.
- Combined filters use AND semantics.
- Normal users cannot use filters to see other users' tasks.
- Delete removes the task row.
- Delete removes an existing report file.
- Delete succeeds when the report file is already missing.

Frontend tests should cover:

- The sidebar shows `任务管理` with `代码审查任务管理` as a child item for admins.
- `/admin/tasks` redirects to `/admin/tasks/review`.
- The task page renders the two filter inputs.
- Searching sends `user_name` and `svn_username` query parameters.
- Deleting a task shows confirmation and refreshes the table after success.

## Rollout Notes

Because no schema migration is required, rollout is limited to backend and frontend application deployment. Existing review task records will immediately display user name and SVN account based on their linked user.
