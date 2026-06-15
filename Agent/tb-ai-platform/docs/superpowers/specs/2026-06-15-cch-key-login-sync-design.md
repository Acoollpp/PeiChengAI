# TB Platform CCH Key Login Sync Design

## Context

The current TB platform is a small Node.js service in `/home/gpt/tb-ai-platform`.
It serves a static browser UI from `public/` and exposes `/api/run` to start Codex
tasks. The platform currently has no user database or login layer.

The code review platform on the same server already syncs Claude Code Hub (CCH)
users and keys into its own database. Its relevant pattern is:

- Source CCH tables: `users` and `keys`
- CCH user columns include `id`, `name`, `role`, `is_enabled`, `deleted_at`, and
  `expires_at`
- CCH key columns include `id`, `user_id`, `key`, `name`, `is_enabled`,
  `deleted_at`, and `expires_at`
- Local login checks an active API key, then checks that the owning user is
  active
- Deleted, disabled, or expired CCH users and keys are treated as inactive

## Goal

Add login protection to the TB platform using CCH keys as the credential source.
TB should keep a local user/key cache and automatically sync from CCH once per
minute so new CCH users can log in shortly after they are created.

The first version should protect platform access and task submission. It should
show the current logged-in user and record basic audit information for each run.
A full user-facing task history page is out of scope for this version.

## Recommended Approach

Use a local SQLite database owned by the TB platform.

SQLite is a good fit because TB is currently a single-process Node service with
simple state needs. It avoids coupling TB request handling to live CCH database
availability and is much smaller than introducing a TB Postgres deployment.

## Data Model

Create `data/tb-platform.sqlite` with these tables.

### users

- `id`: local integer primary key
- `cch_user_id`: unique CCH user id
- `full_name`: CCH user name
- `role`: CCH role, normalized to `admin` or `user`
- `is_active`: false when the CCH user is disabled, deleted, or expired
- `disabled_reason`: `cch_user_disabled`, `cch_user_deleted`, or
  `cch_user_expired`
- `last_synced_at`
- `created_at`
- `updated_at`

### api_keys

- `id`: local integer primary key
- `cch_key_id`: unique CCH key id
- `user_id`: local user id
- `key`: raw CCH key value
- `name`: CCH key name
- `is_active`: false when the CCH key is disabled, deleted, expired, or its user
  is inactive
- `disabled_reason`: `key_disabled`, `key_deleted`, `key_expired`, or
  `user_disabled`
- `last_synced_at`
- `created_at`
- `updated_at`

### sessions

- `id`: random opaque session id
- `user_id`: local user id
- `created_at`
- `expires_at`

Sessions should be stored server-side and referenced by an HttpOnly cookie.

### audit_logs

- `id`: local integer primary key
- `user_id`
- `action`: for this version, `run_codex`
- `mode`: `create` or `change`
- `run_id`
- `metadata_json`: compact JSON with non-sensitive request context
- `created_at`

Do not store CCH keys, Codex output, AppSecrets, access tokens, or other
sensitive values in audit logs.

## Configuration

Add these environment keys to `/home/gpt/tb-ai-platform/.env`:

- `CCH_DATABASE_URL`: Postgres URL for the CCH database
- `SESSION_SECRET`: server-side secret used to sign session cookies
- `SESSION_TTL_HOURS`: default `24`
- `CCH_SYNC_INTERVAL_MS`: default `60000`

The CCH source database URL used by the code review platform contains a
Docker-internal hostname. The TB service runs under PM2 on the host, so its
`CCH_DATABASE_URL` must use a host-reachable address. On this server, the CCH
Postgres container is published on localhost, so implementation should derive a
host-side URL with the same database, user, and password, but with the host and
port changed to the published localhost mapping.

## Backend API

### `POST /api/login`

Request body:

```json
{ "key": "cch-key-value" }
```

Behavior:

- Reject empty keys with `400`
- Find an active `api_keys` row by key
- Load the owning active user
- Create a server-side session
- Set an HttpOnly cookie
- Return the current user public payload

### `GET /api/me`

Returns the current user when the session is valid. Returns `401` when not
logged in.

### `POST /api/logout`

Deletes the current session if present and clears the cookie.

### `GET /api/health`

Keep the current health payload and add authentication/sync metadata:

- `authRequired: true`
- `lastSyncAt`
- `lastSyncError`

### `POST /api/run`

Require a valid session before parsing and executing a task. On accepted runs,
write one `audit_logs` row with the user id, mode, run id, and created time.

## Sync Behavior

Run sync at service startup and then every 60 seconds.

Sync steps:

1. Connect to `CCH_DATABASE_URL`.
2. Read all rows from CCH `users`.
3. Read all rows from CCH `keys`.
4. Upsert local users by `cch_user_id`.
5. Upsert local keys by `cch_key_id`.
6. Mark users inactive when `is_enabled` is false, `deleted_at` is set, or
   `expires_at` is in the past.
7. Mark keys inactive when `is_enabled` is false, `deleted_at` is set,
   `expires_at` is in the past, or the owning user is inactive.
8. Store sync result counters and errors in memory for `/api/health`.

If sync fails, the TB platform should keep running with the previous local
cache. The failure should be logged and exposed as `lastSyncError`.

## Frontend

When `GET /api/me` returns `401`, show a login view with one password-style
input for the CCH key.

When logged in:

- Show the current user's name in the shell header
- Show a logout button
- Keep the existing create/change task UI
- Submit tasks without manually sending the key; the browser uses the session
  cookie

## Security Notes

- Use HttpOnly cookies so frontend JavaScript cannot read session ids.
- Use `SameSite=Lax`.
- Do not log CCH key values.
- Do not return the key in any API response.
- On logout, delete the server-side session and clear the cookie.
- Expired or disabled users should fail future API requests even if they still
  have an unexpired session.

## Testing

Add focused Node tests around:

- Login rejects missing keys
- Login rejects inactive or unknown keys
- Login accepts an active key and creates a session cookie
- `/api/run` rejects unauthenticated requests
- `/api/run` accepts authenticated requests and records an audit log before
  streaming output
- Sync creates and updates users/keys from representative CCH rows
- Sync disables deleted, disabled, expired, and user-disabled keys

Manual verification on the server:

- PM2 service restarts cleanly
- `/api/health` shows auth required and sync status
- Existing task workflow still starts after login
- A newly added CCH key becomes usable after the next sync interval

## Out Of Scope

- Full task history UI
- User management UI inside TB
- Admin-only pages
- Password login
- Reusing code review platform JWT sessions
