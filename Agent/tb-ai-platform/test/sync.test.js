const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore } = require("../src/db");
const { syncRows } = require("../src/cchSync");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-sync-"));
const store = createStore({ databasePath: path.join(tmpDir, "state.sqlite") });
const now = new Date("2026-06-15T00:00:00.000Z");

const result = syncRows(
  store,
  {
    users: [
      { id: 1, name: "Active User", role: "admin", is_enabled: true, deleted_at: null, expires_at: null },
      { id: 2, name: "Disabled User", role: "user", is_enabled: false, deleted_at: null, expires_at: null },
      { id: 3, name: "Deleted User", role: "user", is_enabled: true, deleted_at: "2026-06-14T00:00:00Z", expires_at: null },
      { id: 4, name: "Expired User", role: "user", is_enabled: true, deleted_at: null, expires_at: "2026-06-14T00:00:00Z" }
    ],
    keys: [
      { id: 11, user_id: 1, key: "active-key", name: "active", is_enabled: true, deleted_at: null, expires_at: null },
      { id: 12, user_id: 1, key: "disabled-key", name: "disabled", is_enabled: false, deleted_at: null, expires_at: null },
      { id: 13, user_id: 1, key: "deleted-key", name: "deleted", is_enabled: true, deleted_at: "2026-06-14T00:00:00Z", expires_at: null },
      { id: 14, user_id: 1, key: "expired-key", name: "expired", is_enabled: true, deleted_at: null, expires_at: "2026-06-14T00:00:00Z" },
      { id: 15, user_id: 2, key: "user-disabled-key", name: "user disabled", is_enabled: true, deleted_at: null, expires_at: null }
    ]
  },
  now
);

assert.strictEqual(result.usersCreated, 4);
assert.strictEqual(result.keysCreated, 5);
assert.strictEqual(store.findUserByKey("active-key").fullName, "Active User");
assert.strictEqual(store.findUserByKey("disabled-key"), null);
assert.strictEqual(store.findUserByKey("deleted-key"), null);
assert.strictEqual(store.findUserByKey("expired-key"), null);
assert.strictEqual(store.findUserByKey("user-disabled-key"), null);

const inactiveReasons = store.db
  .prepare("SELECT key, disabled_reason FROM api_keys WHERE is_active = 0 ORDER BY key")
  .all();
assert.deepStrictEqual(inactiveReasons, [
  { key: "deleted-key", disabled_reason: "key_deleted" },
  { key: "disabled-key", disabled_reason: "key_disabled" },
  { key: "expired-key", disabled_reason: "key_expired" },
  { key: "user-disabled-key", disabled_reason: "user_disabled" }
]);

store.close();
console.log("ok - cch sync maps active and inactive users and keys");
