const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createStore } = require("../src/db");
const { parseCodexEvents, parseSkillSteps } = require("../src/flowEvents");
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

function parseNdjson(raw) {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function withServer(fakeCodexSource, fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-flow-"));
  const fakeCodex = path.join(tmpDir, "codex");
  fs.writeFileSync(fakeCodex, fakeCodexSource, { mode: 0o755 });

  const store = createStore({ databasePath: path.join(tmpDir, "state.sqlite") });
  const user = store.upsertUser({
    cchUserId: 901,
    fullName: "Flow User",
    role: "user",
    isActive: true,
    disabledReason: null,
    syncedAt: "2026-06-15T00:00:00.000Z"
  });
  store.upsertApiKey({
    cchKeyId: 9901,
    userId: user.id,
    key: "flow-key",
    name: "flow",
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
      sessionSecret: "flow-secret",
      sessionTtlHours: 24
    },
    store,
    syncState: { lastSyncAt: null, lastSyncError: null, lastSyncResult: null }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const login = await request(port, {
      method: "POST",
      path: "/api/login",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "flow-key" })
    });
    assert.strictEqual(login.statusCode, 200);
    await fn(port, login.headers["set-cookie"][0]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
}

(async () => {
  const steps = parseSkillSteps(`
# 处理流程
1. 查找审批信息
2. 创建项目
- [ ] 回写结果
`);
  assert.deepStrictEqual(steps.map(step => step.title), ["查找审批信息", "创建项目", "回写结果"]);
  assert.deepStrictEqual(steps.map(step => step.id), ["step-1", "step-2", "step-3"]);

  const parsed = parseCodexEvents("noise [[TB_STEP:step-1:running]] visible\n[[TB_STEP:step-1:done]]");
  assert.deepStrictEqual(parsed.events, [
    { type: "step", stepId: "step-1", status: "running" },
    { type: "step", stepId: "step-1", status: "done" }
  ]);
  assert.strictEqual(parsed.text.includes("[[TB_STEP:"), false);
  assert.match(parsed.text, /visible/);

  await withServer(
    "#!/bin/sh\ncat >/tmp/tb-flow-prompt.txt\necho 'RAW_STDOUT_SECRET [[TB_STEP:step-1:running]] sanitized progress'\necho 'RAW_STDERR_SECRET [[TB_STEP:step-1:done]]' >&2\n",
    async (port, cookie) => {
      const flows = await request(port, { path: "/api/flows?mode=create", headers: { Cookie: cookie } });
      assert.strictEqual(flows.statusCode, 200);
      const flowBody = JSON.parse(flows.body);
      assert.strictEqual(flowBody.mode, "create");
      assert.ok(flowBody.steps.length >= 2);
      assert.strictEqual(flowBody.steps[0].id, "step-1");

      const run = await request(port, {
        method: "POST",
        path: "/api/run",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ mode: "create", message: "创建测试项目" })
      });
      assert.strictEqual(run.statusCode, 200);
      assert.strictEqual(run.body.includes("RAW_STDOUT_SECRET"), false);
      assert.strictEqual(run.body.includes("RAW_STDERR_SECRET"), false);
      assert.strictEqual(run.body.includes("[[TB_STEP:"), false);
      const events = parseNdjson(run.body);
      assert.deepStrictEqual(events.map(event => event.type), ["start", "step", "log", "step", "run_error", "done"]);
      assert.strictEqual(events[1].stepId, "step-1");
      assert.strictEqual(events[1].status, "running");
      assert.match(events[2].message, /sanitized progress/);
      assert.strictEqual(events[3].status, "done");
    }
  );

  await withServer(
    "#!/bin/sh\ncat >/tmp/tb-flow-repair-prompt.txt\necho '[[TB_STEP:step-2:running]] repairing'\necho '[[TB_STEP:step-2:done]]'\n",
    async (port, cookie) => {
      const repair = await request(port, {
        method: "POST",
        path: "/api/repair",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ mode: "create", message: "只修复第二步", stepId: "step-2" })
      });
      assert.strictEqual(repair.statusCode, 200);
      const events = parseNdjson(repair.body);
      assert.strictEqual(events[0].type, "start");
      assert.strictEqual(events[0].repair, true);
      assert.deepStrictEqual(
        events.filter(event => event.type === "step").map(event => event.stepId),
        ["step-2", "step-2"]
      );
      const prompt = fs.readFileSync("/tmp/tb-flow-repair-prompt.txt", "utf8");
      assert.match(prompt, /自动修复并续跑任务/);
      assert.match(prompt, /step-2/);
      assert.match(prompt, /step-3/);
    }
  );

  console.log("ok - flow steps and structured events");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
