# Login, PostgreSQL, Redis Scheduling, and SSE Design

## Purpose

Add user identity, usage statistics, PostgreSQL persistence, Redis-backed per-user scheduling, and dynamic task status updates to the code review web service.

The login system is identity registration, not password authentication. Users identify themselves with a name and phone number so the system can associate tasks with people, show user-specific task views, and calculate usage statistics.

## Current Baseline

The current service is a FastAPI application with a static frontend. Task data is stored in SQLite through `TaskRepository`. A background worker polls the database, claims the oldest pending task, runs Codex, and writes the result report to disk. The frontend submits tasks and polls task details, but there is no login state and no per-user concurrency control.

## Chosen Approach

Use PostgreSQL as the source of truth, Redis as the runtime scheduler and event channel, and Server-Sent Events for browser updates.

PostgreSQL stores users, tasks, durable task state, report paths, timestamps, worker metadata, and statistics source data. Redis stores queues, per-user running locks, ready-user scheduling state, and event notifications. Redis state can be rebuilt from PostgreSQL if needed.

This approach keeps durable data in one database while using Redis for the concurrency problem it is best suited to: fast atomic scheduling and lock coordination.

## User Identity and Login

Add a dedicated `/login` page. Users enter:

- Name
- Phone number

The backend normalizes the phone number, finds or creates a user by phone, updates the display name and `last_seen_at`, and returns a browser session cookie.

The login page is separate from the task console:

- Unauthenticated access to `/` redirects to `/login`, or the frontend sends the user to `/login` after `GET /api/session` returns unauthenticated.
- Successful login redirects to `/`.
- Authenticated access to `/login` can redirect to `/`.
- The current task console layout remains unchanged except for small login-state additions.

The task console should display the current user and a logout control in an existing header/status area. The task submission form no longer needs a trusted `requester` field; the backend derives the requester from the session user.

## PostgreSQL Data Model

Add a `users` table:

- `id UUID PRIMARY KEY`
- `name TEXT NOT NULL`
- `phone TEXT NOT NULL UNIQUE`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`
- `last_seen_at TIMESTAMPTZ NOT NULL`

Move `tasks` from SQLite to PostgreSQL and keep the existing task fields, with these additions:

- `user_id UUID NOT NULL REFERENCES users(id)`
- `queue_position INTEGER NULL`, optional cached display value
- `claimed_by TEXT NULL`, worker identifier for diagnostics
- `heartbeat_at TIMESTAMPTZ NULL`, worker liveness timestamp

Keep `requester TEXT` during the transition and write the user's display name into it for compatibility with existing response models and reports. It can be removed in a later migration once all UI and reporting paths use `user_id`.

Task status values:

- `pending`
- `running`
- `success`
- `failed`
- `enqueue_failed`

`enqueue_failed` is used when a task was created in PostgreSQL but Redis enqueue failed. It gives operators an explicit state to diagnose and recover instead of silently losing scheduler intent.

## Redis Scheduler Model

Redis keys:

- `queue:user:{user_id}`: list of waiting task IDs for one user, ordered by submission time.
- `users:ready`: set or sorted set of users who have waiting tasks and no active running lock.
- `running:user:{user_id}`: per-user running lock whose value is the active task ID and whose TTL is refreshed by the worker.
- `task:user:{task_id}`: task-to-user mapping for cleanup and recovery.
- `events:user:{user_id}`: event channel or stream for SSE notifications.

Scheduling rule:

One user can have at most one running task at a time.

Task creation flow:

1. Validate request and require an authenticated session.
2. Create a `pending` task in PostgreSQL with `user_id`.
3. Push the task ID to `queue:user:{user_id}`.
4. If `running:user:{user_id}` does not exist, add the user to `users:ready`.
5. Publish a user event so the browser refreshes task list and status.

Worker claim flow:

1. Atomically choose a ready user.
2. Confirm `running:user:{user_id}` does not exist.
3. Pop the next task ID from that user's queue.
4. Set `running:user:{user_id}` to the task ID with TTL.
5. Mark the PostgreSQL task `running`, setting `started_at`, `updated_at`, `heartbeat_at`, and `claimed_by`.

The claim operation should be implemented as a Redis Lua script or an equivalent atomic Redis transaction so multiple workers cannot claim two tasks for the same user.

Completion flow:

1. Update PostgreSQL task status to `success` or `failed`.
2. Clear `running:user:{user_id}` if it still points to the completed task.
3. If `queue:user:{user_id}` still has pending tasks, add the user back to `users:ready`.
4. Publish a user event.

The first production configuration can still run one worker. The design supports more workers later by increasing worker count while preserving the per-user running limit.

## SSE Dynamic Updates

Add `GET /api/events` for authenticated users. The connection streams events for the current session user only.

Events should be lightweight refresh hints, for example:

```json
{"type":"task_updated","task_id":"...","status":"running"}
```

The browser should treat SSE as a notification channel, not the source of truth. On an event, it calls existing REST APIs to refresh the current task, recent tasks, report availability, and statistics.

Frontend behavior:

- Login succeeds, redirects to `/`, loads session and current user's tasks.
- Task submission immediately updates the UI with a pending task.
- `running`, `success`, and `failed` transitions arrive through SSE.
- On success, the frontend automatically loads the Markdown report and enables download.
- SSE reconnects automatically.
- After reconnect, the frontend performs a full refresh to cover missed events.
- A low-frequency fallback refresh, such as every 30 to 60 seconds, protects against proxy or browser SSE issues.

The existing task console layout should stay intact. The main frontend change is state management, session handling, and SSE-driven refresh.

## API Design

New endpoints:

- `GET /login`: serve the login page.
- `POST /api/session`: create or refresh a session using name and phone.
- `GET /api/session`: return the current authenticated user.
- `DELETE /api/session`: log out.
- `GET /api/events`: SSE stream for the current user.
- `GET /api/users/me/stats`: current user's usage statistics.

Adjusted endpoints:

- `POST /api/tasks`: requires login and uses the session user instead of trusting `requester`.
- `GET /api/tasks`: defaults to the current user's tasks.
- `GET /api/tasks/{task_id}`: requires ownership of the task.
- `GET /api/tasks/{task_id}/report`: requires ownership of the task.
- `GET /api/tasks/{task_id}/download`: requires ownership of the task.

Admin views and cross-user task access are out of scope for the first version.

## Error Handling and Recovery

If PostgreSQL is unavailable, login, task creation, task listing, worker state changes, and report metadata are unavailable. Return clear 5xx errors.

If Redis is unavailable:

- Login still works.
- Existing task history and report downloads still work.
- Creating new tasks returns a clear 503 because the task cannot be scheduled.
- Workers stop claiming new work.
- On recovery, reconciliation rebuilds Redis scheduling state from PostgreSQL.

If PostgreSQL task creation succeeds but Redis enqueue fails, mark the task `enqueue_failed` and return a clear error to the user. A recovery tool can re-enqueue these tasks after Redis is healthy.

Workers refresh both Redis lock TTL and PostgreSQL `heartbeat_at` while running. Startup or periodic reconciliation checks stale `running` tasks. The first version marks stale running tasks `failed`, releases the user's Redis running lock, and then allows that user's next queued task to proceed. Requeueing partially executed tasks is out of scope for the first version.

Redis is not durable truth. PostgreSQL remains authoritative for task history and status.

## Migration

The first implementation can initialize a new PostgreSQL database instead of performing a full online migration.

If old SQLite data needs to be preserved, provide a one-time migration script:

- Copy old tasks into PostgreSQL.
- Preserve `requester` text.
- Assign old tasks to a generated `legacy` user because phone numbers are not available in the old schema.
- Keep old report paths where safe, while continuing to enforce the current reports directory boundary checks.

New writes after cutover go only to PostgreSQL.

## Testing

User/session tests:

- New phone creates a user.
- Repeated login with the same phone updates name and `last_seen_at`.
- Session cookie authenticates subsequent requests.
- Logout clears the session.

Repository tests:

- PostgreSQL schema initialization or migrations.
- Task creation with `user_id`.
- User-scoped task listing.
- Status transitions and heartbeat updates.
- User statistics.

Scheduler tests:

- One user with multiple tasks yields only one running task.
- After completion, the same user's next task becomes claimable.
- Multiple users can rotate through the ready set.
- Redis claim operation is atomic under concurrent workers.
- Redis state can be rebuilt from PostgreSQL pending tasks.

Worker tests:

- Claim through scheduler.
- Mark running with worker metadata.
- Refresh heartbeat and lock TTL.
- Release user lock on success or failure.
- Publish user events.

API tests:

- Unauthenticated task APIs reject or redirect appropriately.
- Authenticated task creation uses session user.
- Users cannot access other users' tasks, reports, or downloads.
- Redis enqueue failure returns a clear error and records `enqueue_failed`.

SSE tests:

- Authenticated users can connect.
- Unauthenticated users cannot connect.
- Task state changes publish events.
- Events are refresh hints and REST responses remain authoritative.

Frontend static tests:

- `/login` is served.
- Existing task console layout markers remain present.
- Task console initializes session state.
- JavaScript uses `EventSource` for `/api/events`.
- Success events trigger report loading.

## Out of Scope

- Password authentication.
- Admin roles and cross-user dashboards.
- OIDC, LDAP, or SSO integration.
- Full SPA framework migration.
- Complex historical SQLite migration unless old data must be retained.
