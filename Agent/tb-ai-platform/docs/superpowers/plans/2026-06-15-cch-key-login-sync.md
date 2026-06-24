# CCH Key Login Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CCH key-based login, local user/key synchronization, server-side sessions, and audit logging to the TB AI Platform.

**Architecture:** Keep the current small Node/CommonJS app, but split server responsibilities into focused modules under `src/`. Use SQLite as TB's local state store, `pg` only for syncing CCH source rows, and HttpOnly cookies for browser sessions. `/api/run` becomes authenticated while existing Codex streaming behavior remains intact.

**Tech Stack:** Node.js CommonJS, `better-sqlite3`, `pg`, built-in `http`, `crypto`, and focused `node` test scripts.

---

## File Structure

- Create `src/config.js`: load `.env`, expose normalized config defaults.
- Create `src/db.js`: initialize SQLite schema and provide small query helpers.
- Create `src/cchSync.js`: map CCH `users`/`keys` rows and upsert local rows.
- Create `src/auth.js`: session cookie parsing/signing, login, logout, current-user lookup.
- Modify `server.js`: wire modules, add auth APIs, protect `/api/run`, record audit logs.
- Modify `public/index.html`: add login surface and logged-in user/logout controls.
- Modify `public/app.js`: add `/api/me`, `/api/login`, `/api/logout` state flow.
- Modify `public/styles.css`: style login and account controls.
- Modify `.env.example`: keep CCH/session settings visible.
- Modify `package.json`: add dependencies and test scripts.
- Create tests under `test/`: `auth.test.js`, `sync.test.js`, and update run auth coverage.

## Task 1: Add Dependencies and Configuration

**Files:**
- Modify: `Agent/tb-ai-platform/package.json`
- Create: `Agent/tb-ai-platform/src/config.js`
- Test: `Agent/tb-ai-platform/test/config.test.js`

- [ ] **Step 1: Write the failing config test**

```js
const assert = require("assert");
const { loadConfig } = require("../src/config");

const config = loadConfig({
  PORT: "9999",
  HOST: "127.0.0.1",
  CODEX_BIN: "/tmp/codex",
  SESSION_SECRET: "secret-value",
  SESSION_TTL_HOURS: "12",
  CCH_SYNC_INTERVAL_MS: "30000",
  TB_DATA_DIR: "/tmp/tb-data"
});

assert.strictEqual(config.port, 9999);
assert.strictEqual(config.host, "127.0.0.1");
assert.strictEqual(config.codexBin, "/tmp/codex");
assert.strictEqual(config.sessionSecret, "secret-value");
assert.strictEqual(config.sessionTtlHours, 12);
assert.strictEqual(config.cchSyncIntervalMs, 30000);
assert.strictEqual(config.dataDir, "/tmp/tb-data");
console.log("ok - config loads typed values");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/config.test.js`
Expected: FAIL with `Cannot find module '../src/config'`.

- [ ] **Step 3: Implement config module and dependencies**

Add dependencies in `package.json`: `better-sqlite3` and `pg`. Create `src/config.js` with `loadEnvFile()` and `loadConfig(env = process.env)` that returns typed defaults.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/config.test.js`
Expected: PASS with `ok - config loads typed values`.

## Task 2: Add SQLite Schema and Local Store

**Files:**
- Create: `Agent/tb-ai-platform/src/db.js`
- Test: `Agent/tb-ai-platform/test/db.test.js`

- [ ] **Step 1: Write failing schema test**

Test opens a temp SQLite file, calls `createStore({ databasePath })`, then verifies tables `users`, `api_keys`, `sessions`, and `audit_logs` exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/db.test.js`
Expected: FAIL with missing `src/db`.

- [ ] **Step 3: Implement store**

`createStore()` should create parent directories, run migrations with `CREATE TABLE IF NOT EXISTS`, and expose methods: `upsertUser`, `upsertApiKey`, `findUserByKey`, `createSession`, `getSessionUser`, `deleteSession`, and `recordAuditLog`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/db.test.js`
Expected: PASS with schema and helper assertions.

## Task 3: Add CCH Sync Mapping

**Files:**
- Create: `Agent/tb-ai-platform/src/cchSync.js`
- Test: `Agent/tb-ai-platform/test/sync.test.js`

- [ ] **Step 1: Write failing sync test**

Use in-memory rows for CCH `users` and `keys`. Assert active rows become active local users/keys, disabled/deleted/expired rows become inactive, and keys owned by inactive users are inactive.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/sync.test.js`
Expected: FAIL with missing `src/cchSync`.

- [ ] **Step 3: Implement sync module**

Export `syncRows(store, { users, keys }, now)` and `syncFromCchDatabase(store, databaseUrl, now)`. Use `pg.Pool` for database reads and quote only fixed table names `users` and `keys`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/sync.test.js`
Expected: PASS with sync counters.

## Task 4: Add Session Auth

**Files:**
- Create: `Agent/tb-ai-platform/src/auth.js`
- Test: `Agent/tb-ai-platform/test/auth.test.js`

- [ ] **Step 1: Write failing auth test**

Seed an active user/key in SQLite. Assert `loginWithKey` rejects blank/unknown keys, accepts an active key, returns a `Set-Cookie` header with `HttpOnly`, and `getCurrentUser` resolves the cookie back to the user.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/auth.test.js`
Expected: FAIL with missing `src/auth`.

- [ ] **Step 3: Implement auth module**

Use `crypto.randomBytes` for session ids and HMAC signatures. Cookie name should be `tb_session`. Set `HttpOnly; SameSite=Lax; Path=/` and `Max-Age` from `SESSION_TTL_HOURS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/auth.test.js`
Expected: PASS with login/session assertions.

## Task 5: Wire Auth APIs and Protect Run

**Files:**
- Modify: `Agent/tb-ai-platform/server.js`
- Modify: `Agent/tb-ai-platform/test/no-token-run.test.js`
- Test: `Agent/tb-ai-platform/test/server-auth.test.js`

- [ ] **Step 1: Write failing server tests**

Assert `GET /api/me` returns `401` before login, `POST /api/run` returns `401` before login, login with seeded key returns user JSON and cookie, and authenticated empty run reaches business validation with `400 请输入任务内容`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/server-auth.test.js`
Expected: FAIL because `/api/login` and auth protection do not exist.

- [ ] **Step 3: Implement server routes**

Refactor `server.js` to export `createServer({ config, store, syncState })` for tests and start only when run directly. Add `/api/login`, `/api/me`, `/api/logout`, health sync fields, auth guard for `/api/run`, and audit logging after `runId` is created.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/server-auth.test.js`
Expected: PASS with authenticated flow.

## Task 6: Add Frontend Login State

**Files:**
- Modify: `Agent/tb-ai-platform/public/index.html`
- Modify: `Agent/tb-ai-platform/public/app.js`
- Modify: `Agent/tb-ai-platform/public/styles.css`

- [ ] **Step 1: Write static UI checks**

Add `test/frontend-static.test.js` that verifies login form ids, account display ids, and no Authorization header usage.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/frontend-static.test.js`
Expected: FAIL until UI elements are added.

- [ ] **Step 3: Implement frontend state**

On load call `/api/me`. Show login panel when unauthenticated. On login, POST key to `/api/login`; on logout POST `/api/logout`. Hide task workspace until logged in and submit `/api/run` with cookie-based session only.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/frontend-static.test.js`
Expected: PASS.

## Task 7: Startup Sync and Deployment Notes

**Files:**
- Modify: `Agent/tb-ai-platform/server.js`
- Modify: `Agent/tb-ai-platform/README.md`
- Modify: `Agent/tb-ai-platform/.env.example`
- Test: all tests

- [ ] **Step 1: Add startup sync behavior**

When `CCH_DATABASE_URL` is present, run sync once at startup and every `CCH_SYNC_INTERVAL_MS`. Store `lastSyncAt`, `lastSyncError`, and counters in memory.

- [ ] **Step 2: Update docs**

Document `npm install`, `npm test`, PM2 restart, required `.env` values, and the CCH host-side database URL requirement.

- [ ] **Step 3: Run full tests**

Run: `npm test`
Expected: every test script passes.

- [ ] **Step 4: Commit**

Run:

```bash
git add Agent/tb-ai-platform
git commit -m "add cch key login to tb platform"
```

## Self-Review

- Spec coverage: login, local cache, CCH sync, sessions, run protection, audit logs, frontend, and docs are covered.
- Placeholder scan: plan uses concrete files, commands, and expected outcomes.
- Type consistency: user/key/session/audit names match the design spec and planned modules.
