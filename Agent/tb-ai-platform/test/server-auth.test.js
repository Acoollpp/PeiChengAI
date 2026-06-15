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
  fs.writeFileSync(
    fakeCodex,
    [
      "#!/bin/sh",
      "echo '[[TB_STEP:step-1:done]]'",
      "echo 'RAW COMMAND SHOULD STAY SERVER SIDE'",
      "echo '[[TB_STEP:step-2:done]]'"
    ].join("\n"),
    { mode: 0o755 }
  );
  const skillRootDir = path.join(tmpDir, "skills");
  fs.mkdirSync(path.join(skillRootDir, "通用-钉钉创建项目"), { recursive: true });
  fs.mkdirSync(path.join(skillRootDir, "通用-钉钉项目变更"), { recursive: true });
  fs.writeFileSync(
    path.join(skillRootDir, "通用-钉钉创建项目", "SKILL.md"),
    "# 通用-钉钉创建项目\n\n## 必须自动执行的步骤\n\n1. 创建项目空间\n2. 回读验收\n"
  );
  fs.writeFileSync(
    path.join(skillRootDir, "通用-钉钉项目变更", "SKILL.md"),
    "# 通用-钉钉项目变更\n\n## 项目变更主流程\n\n1. 定位项目\n2. 创建变更迭代\n"
  );

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
      skillRootDir,
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

    const flows = await request(port, { path: "/api/flows", headers: { Cookie: cookie } });
    assert.strictEqual(flows.statusCode, 200);
    assert.match(flows.body, /创建项目空间/);
    assert.match(flows.body, /回读验收/);

    const runFlow = await request(port, {
      method: "POST",
      path: "/api/run",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ mode: "create", message: "创建测试项目" })
    });
    assert.strictEqual(runFlow.statusCode, 200);
    assert.match(runFlow.body, /"type":"start"/);
    assert.match(runFlow.body, /"type":"step"/);
    assert.match(runFlow.body, /step-1/);
    assert.doesNotMatch(runFlow.body, /RAW COMMAND SHOULD STAY SERVER SIDE/);
    assert.doesNotMatch(runFlow.body, /"type":"stdout"/);
    assert.doesNotMatch(runFlow.body, /"type":"stderr"/);

    const repairFlow = await request(port, {
      method: "POST",
      path: "/api/repair",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ mode: "create", message: "创建测试项目", stepId: "step-2" })
    });
    assert.strictEqual(repairFlow.statusCode, 200);
    assert.match(repairFlow.body, /"repairStepId":"step-2"/);
    assert.match(repairFlow.body, /"type":"step"/);
    assert.doesNotMatch(repairFlow.body, /RAW COMMAND SHOULD STAY SERVER SIDE/);

    const changeWithoutUrl = await request(port, {
      method: "POST",
      path: "/api/run",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ mode: "change", message: "项目名称 60411，创建变更迭代" })
    });
    assert.strictEqual(changeWithoutUrl.statusCode, 400);
    assert.match(changeWithoutUrl.body, /项目变更必须粘贴对应的项目地址/);

    const changeWithUrl = await request(port, {
      method: "POST",
      path: "/api/run",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        mode: "change",
        message: "项目地址 https://www.teambition.com/project/abc/tasks/view/def，创建变更迭代"
      })
    });
    assert.strictEqual(changeWithUrl.statusCode, 200);
    assert.match(changeWithUrl.body, /"type":"start"/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }

  console.log("ok - server requires login and accepts session cookies");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
