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

function login(port) {
  return request(port, {
    method: "POST",
    path: "/api/login",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "abort-key" })
  });
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-abort-"));
  const fakeCodex = path.join(tmpDir, "codex");
  fs.writeFileSync(
    fakeCodex,
    [
      "#!/bin/sh",
      "echo '[[TB_STEP:step-1:running]]'",
      "sleep 10",
      "echo '[[TB_STEP:step-1:done]]'"
    ].join("\n"),
    { mode: 0o755 }
  );

  const skillRootDir = path.join(tmpDir, "skills");
  fs.mkdirSync(path.join(skillRootDir, "通用-钉钉创建项目"), { recursive: true });
  fs.mkdirSync(path.join(skillRootDir, "通用-钉钉项目变更"), { recursive: true });
  fs.writeFileSync(path.join(skillRootDir, "通用-钉钉创建项目", "SKILL.md"), "# 创建\n\n1. 创建项目空间\n");
  fs.writeFileSync(path.join(skillRootDir, "通用-钉钉项目变更", "SKILL.md"), "# 变更\n\n1. 定位项目\n");

  const store = createStore({ databasePath: path.join(tmpDir, "state.sqlite") });
  const user = store.upsertUser({
    cchUserId: 777,
    fullName: "Abort User",
    role: "user",
    isActive: true,
    disabledReason: null,
    syncedAt: "2026-06-15T00:00:00.000Z"
  });
  store.upsertApiKey({
    cchKeyId: 7771,
    userId: user.id,
    key: "abort-key",
    name: "abort",
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
      skillRootDir,
      sessionSecret: "abort-secret",
      sessionTtlHours: 24
    },
    store,
    syncState: { lastSyncAt: null, lastSyncError: null, lastSyncResult: null }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const loginResponse = await login(port);
    assert.strictEqual(loginResponse.statusCode, 200);
    const cookie = loginResponse.headers["set-cookie"][0];

    const runReq = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/run",
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json"
      }
    });
    runReq.end(JSON.stringify({ mode: "create", message: "创建一个很慢的项目" }));

    const runId = await new Promise((resolve, reject) => {
      runReq.on("response", res => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          raw += chunk;
          const firstLine = raw.split("\n").find(Boolean);
          if (firstLine) resolve(JSON.parse(firstLine).runId);
        });
      });
      runReq.on("error", reject);
    });

    const abort = await request(port, {
      method: "POST",
      path: "/api/abort",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ runId })
    });
    assert.strictEqual(abort.statusCode, 200);
    assert.strictEqual(JSON.parse(abort.body).ok, true);

    await new Promise(resolve => setTimeout(resolve, 200));
    const history = store.listRunHistory({ userId: user.id, mode: "create" });
    assert.strictEqual(history[0].runId, runId);
    assert.strictEqual(history[0].status, "failed");
    assert.ok(history[0].errorMessages.some(item => /用户已中止/.test(item.message)));
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }

  console.log("ok - running codex tasks can be aborted");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
