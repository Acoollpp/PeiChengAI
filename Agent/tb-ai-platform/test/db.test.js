const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore } = require("../src/db");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-db-"));
const store = createStore({ databasePath: path.join(tmpDir, "state.sqlite") });

const tables = store.db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map(row => row.name);

for (const table of ["api_keys", "audit_logs", "sessions", "users"]) {
  assert.ok(tables.includes(table), `missing table ${table}`);
}

const user = store.upsertUser({
  cchUserId: 101,
  fullName: "Test User",
  role: "user",
  isActive: true,
  disabledReason: null,
  syncedAt: "2026-06-15T00:00:00.000Z"
});

store.upsertApiKey({
  cchKeyId: 9001,
  userId: user.id,
  key: "key-9001",
  name: "main",
  isActive: true,
  disabledReason: null,
  syncedAt: "2026-06-15T00:00:00.000Z"
});

const loginUser = store.findUserByKey("key-9001");
assert.strictEqual(loginUser.fullName, "Test User");

const session = store.createSession({
  userId: user.id,
  expiresAt: "2026-06-16T00:00:00.000Z"
});
assert.ok(session.id.length >= 32);
assert.strictEqual(store.getSessionUser(session.id, "2026-06-15T00:00:00.000Z").id, user.id);

store.recordAuditLog({
  userId: user.id,
  action: "run_codex",
  mode: "create",
  runId: "run-1",
  metadata: { ok: true }
});
assert.strictEqual(store.db.prepare("SELECT count(*) AS count FROM audit_logs").get().count, 1);

store.close();
console.log("ok - db store manages users, keys, sessions, and audit logs");
