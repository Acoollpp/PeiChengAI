const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createStore } = require("../src/db");
const { createServer } = require("../server");

function request(port, { method = "GET", path = "/", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Length": Buffer.byteLength(body),
          ...headers
        }
      },
      res => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          raw += chunk;
        });
        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: raw }));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-server-"));
  const fakeCodex = path.join(tmpDir, "codex");
  fs.writeFileSync(fakeCodex, "#!/bin/sh\necho fake codex\n", { mode: 0o755 });

  const store = createStore({ databasePath: path.join(tmpDir, "state.sqlite") });
  const user = store.upsertUser({
    cchUserId: 501,
    fullName: "Server User",
    role: "user",
    isActive: true,
    disabledReason: null,
    syncedAt: "2026-06-15T00:00:00.000Z"
  });
  store.upsertApiKey({
    cchKeyId: 7001,
    userId: user.id,
    key: "server-key",
    name: "server",
    isActive: true,
    disabledReason: null,
    syncedAt: "2026-06-15T00:00:00.000Z"
  });

  const server = createServer({
    config: {
      rootDir: process.cwd(),
      publicDir: path.join(process.cwd(), "public"),
      workspaceDir: tmpDir,
      codexBin: fakeCodex,
      sessionSecret: "server-secret",
      sessionTtlHours: 24
    },
    store,
    syncState: { lastSyncAt: null, lastSyncError: null, lastSyncResult: null }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const meBefore = await request(port, { path: "/api/me" });
    assert.strictEqual(meBefore.statusCode, 401);

    const runBefore = await request(port, {
      method: "POST",
      path: "/api/run",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "create", message: "" })
    });
    assert.strictEqual(runBefore.statusCode, 401);

    const login = await request(port, {
      method: "POST",
      path: "/api/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "server-key" })
    });
    assert.strictEqual(login.statusCode, 200);
    assert.match(login.headers["set-cookie"][0], /tb_session=/);
    assert.strictEqual(JSON.parse(login.body).user.fullName, "Server User");

    const cookie = login.headers["set-cookie"][0];
    const meAfter = await request(port, { path: "/api/me", headers: { Cookie: cookie } });
    assert.strictEqual(meAfter.statusCode, 200);
    assert.strictEqual(JSON.parse(meAfter.body).user.fullName, "Server User");

    const runAfter = await request(port, {
      method: "POST",
      path: "/api/run",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ mode: "create", message: "" })
    });
    assert.strictEqual(runAfter.statusCode, 400);
    assert.match(runAfter.body, /请输入任务内容/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }

  console.log("ok - server requires login and accepts session cookies");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
