const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore } = require("../src/db");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-db-"));
const store = createStore({ databasePath: path.join(tmpDir, "state.sqlite") });
assert.strictEqual((fs.statSync(path.join(tmpDir, "state.sqlite")).mode & 0o777), 0o600);

const tables = store.db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map(row => row.name);

for (const table of ["api_keys", "audit_logs", "run_history", "sessions", "users"]) {
  assert.ok(tables.includes(table), `missing table ${table}`);
}

const runHistoryColumns = store.db.prepare("PRAGMA table_info(run_history)").all().map(row => row.name);
for (const column of ["message_text", "project_url", "ai_test", "result_urls_json", "error_messages_json", "item_results_json"]) {
  assert.ok(runHistoryColumns.includes(column), `missing run_history column ${column}`);
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

store.createRunHistory({
  userId: user.id,
  runId: "history-1",
  mode: "create",
  title: "创建钉钉 TB 项目",
  message: "项目名称：A\n项目编号：P001",
  itemCount: 2,
  projectUrl: "https://www.teambition.com/project/demo",
  aiTest: true
});
store.finishRunHistory({
  runId: "history-1",
  status: "success",
  code: 0,
  completedSteps: ["item-1:step-1"],
  failedSteps: [],
  missingSteps: [],
  resultUrls: [{ itemId: "item-1", url: "https://www.teambition.com/project/demo" }],
  errorMessages: [],
  itemResults: [{ itemId: "item-1", code: 0 }]
});
const history = store.listRunHistory({ userId: user.id });
assert.strictEqual(history.length, 1);
assert.strictEqual(history[0].itemCount, 2);
assert.strictEqual(history[0].status, "success");
assert.strictEqual(history[0].messageText, "项目名称：A\n项目编号：P001");
assert.strictEqual(history[0].projectUrl, "https://www.teambition.com/project/demo");
assert.strictEqual(history[0].aiTest, true);
assert.deepStrictEqual(history[0].completedSteps, ["item-1:step-1"]);
assert.deepStrictEqual(history[0].resultUrls, [{ itemId: "item-1", url: "https://www.teambition.com/project/demo" }]);
assert.deepStrictEqual(history[0].itemResults, [{ itemId: "item-1", code: 0 }]);

store.close();
console.log("ok - db store manages users, keys, sessions, and audit logs");
