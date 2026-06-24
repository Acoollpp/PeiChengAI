const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore } = require("../src/db");
const { createAuthService } = require("../src/auth");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-auth-"));
const store = createStore({ databasePath: path.join(tmpDir, "state.sqlite") });
const auth = createAuthService({
  store,
  sessionSecret: "test-secret",
  sessionTtlHours: 24
});

const user = store.upsertUser({
  cchUserId: 201,
  fullName: "Auth User",
  role: "user",
  isActive: true,
  disabledReason: null,
  syncedAt: "2026-06-15T00:00:00.000Z"
});
store.upsertApiKey({
  cchKeyId: 3001,
  userId: user.id,
  key: "login-key",
  name: "login",
  isActive: true,
  disabledReason: null,
  syncedAt: "2026-06-15T00:00:00.000Z"
});

assert.strictEqual(auth.loginWithKey("").ok, false);
assert.strictEqual(auth.loginWithKey("missing").ok, false);

const login = auth.loginWithKey("login-key", new Date("2026-06-15T00:00:00.000Z"));
assert.strictEqual(login.ok, true);
assert.strictEqual(login.user.fullName, "Auth User");
assert.match(login.cookie, /tb_session=/);
assert.match(login.cookie, /HttpOnly/);
assert.match(login.cookie, /SameSite=Lax/);

const currentUser = auth.getCurrentUser(
  { headers: { cookie: login.cookie } },
  new Date("2026-06-15T01:00:00.000Z")
);
assert.strictEqual(currentUser.fullName, "Auth User");

const sessionId = auth.sessionIdFromRequest({ headers: { cookie: login.cookie } });
auth.logout(sessionId);
assert.strictEqual(
  auth.getCurrentUser({ headers: { cookie: login.cookie } }, new Date("2026-06-15T01:00:00.000Z")),
  null
);

store.close();
console.log("ok - auth service logs in with active keys and resolves sessions");
