const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { createAuthService } = require("./src/auth");
const { syncFromCchDatabase } = require("./src/cchSync");
const { loadConfig, loadEnvFile } = require("./src/config");
const { createStore } = require("./src/db");
const { parseCodexEvents } = require("./src/flowEvents");
const { buildModeFlow } = require("./src/skillFlow");

const modes = {
  create: {
    title: "创建钉钉 TB 项目",
    skill: "通用-钉钉创建项目",
    skills: ["通用-钉钉创建项目"],
    promptPrefix:
      "你正在通过网站后台执行钉钉 TB 项目创建任务。必须使用 skill `通用-钉钉创建项目`；如果需要先查审批信息，也要使用 `通用-审批信息查找`。不要泄露任何 AppSecret、accessToken 或完整敏感凭证。用户需求如下："
  },
  change: {
    title: "创建项目变更迭代",
    skill: "通用-钉钉项目变更",
    skills: ["通用-钉钉项目变更"],
    requireProjectUrl: true,
    promptPrefix:
      "你正在通过网站后台执行钉钉 TB 项目变更任务。用户会直接粘贴项目变更信息单，并必须提供对应的 Teambition/钉钉项目地址；不要只按项目名搜索项目。必须使用 skill `通用-钉钉项目变更`。不要泄露任何 AppSecret、accessToken 或完整敏感凭证。用户需求如下："
  }
};

function createServer({ config, store, syncState }) {
  fs.mkdirSync(config.workspaceDir, { recursive: true });
  const auth = createAuthService({
    store,
    sessionSecret: config.sessionSecret,
    sessionTtlHours: config.sessionTtlHours
  });

  async function login(req, res) {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const result = auth.loginWithKey(body.key);
    if (!result.ok) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { user: result.user }, { "Set-Cookie": result.cookie });
  }

  function me(req, res) {
    const user = auth.getCurrentUser(req);
    if (!user) return sendJson(res, 401, { error: "请先登录" });
    return sendJson(res, 200, { user });
  }

  function logout(req, res) {
    auth.logout(auth.sessionIdFromRequest(req));
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": auth.clearCookie() });
  }

  function flows(req, res) {
    const currentUser = auth.getCurrentUser(req);
    if (!currentUser) return sendJson(res, 401, { error: "请先登录" });
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const modeKey = url.searchParams.get("mode");
    if (modeKey) {
      const mode = modes[modeKey];
      if (!mode) return sendJson(res, 400, { error: "任务类型无效" });
      return sendJson(res, 200, {
        mode: modeKey,
        title: mode.title,
        skill: mode.skill,
        steps: getModeFlow(modeKey, mode, config)
      });
    }
    return sendJson(res, 200, getFlows(config));
  }

  async function runCodex(req, res) {
    const currentUser = auth.getCurrentUser(req);
    if (!currentUser) return sendJson(res, 401, { error: "请先登录" });

    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const mode = modes[body.mode];
    const message = String(body.message || "").trim();
    if (!mode) return sendJson(res, 400, { error: "任务类型无效" });
    if (!message) return sendJson(res, 400, { error: "请输入任务内容" });
    const validationError = validateTaskMessage(body.mode, mode, message);
    if (validationError) return sendJson(res, 400, { error: validationError });

    const runId = crypto.randomUUID();
    const flow = getModeFlow(body.mode, mode, config);
    const prompt = buildCodexPrompt({ mode, message, steps: flow });
    const startedAt = new Date().toISOString();

    store.recordAuditLog({
      userId: currentUser.id,
      action: "run_codex",
      mode: body.mode,
      runId,
      metadata: {
        title: mode.title,
        messageLength: message.length
      }
    });

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    });
    executeCodexStream({
      req,
      res,
      config,
      prompt,
      startEvent: { type: "start", runId, mode: body.mode, title: mode.title, startedAt, steps: flow }
    });
  }

  async function repairStep(req, res) {
    const currentUser = auth.getCurrentUser(req);
    if (!currentUser) return sendJson(res, 401, { error: "请先登录" });

    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const mode = modes[body.mode];
    const message = String(body.message || "").trim();
    if (!mode) return sendJson(res, 400, { error: "任务类型无效" });
    if (!message) return sendJson(res, 400, { error: "请输入任务内容" });
    const validationError = validateTaskMessage(body.mode, mode, message);
    if (validationError) return sendJson(res, 400, { error: validationError });

    const flow = getModeFlow(body.mode, mode, config);
    const step = flow.find(item => item.id === body.stepId);
    if (!step) return sendJson(res, 400, { error: "流程步骤无效" });
    if (!step.repairable) return sendJson(res, 400, { error: "这个步骤不支持自动修复" });

    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const prompt = buildCodexPrompt({ mode, message, steps: [step], repairStep: step });

    store.recordAuditLog({
      userId: currentUser.id,
      action: "repair_codex_step",
      mode: body.mode,
      runId,
      metadata: {
        title: mode.title,
        stepId: step.id,
        stepLabel: step.label,
        messageLength: message.length
      }
    });

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    });

    executeCodexStream({
      req,
      res,
      config,
      prompt,
      startEvent: {
        type: "start",
        runId,
        mode: body.mode,
        title: `修复：${step.label}`,
        startedAt,
        steps: [step],
        repair: true,
        repairStepId: step.id
      }
    });
  }

  function router(req, res) {
    if (req.method === "GET" && req.url.startsWith("/api/health")) {
      return sendJson(res, 200, {
        ok: true,
        codexBin: config.codexBin,
        authRequired: true,
        lastSyncAt: syncState.lastSyncAt,
        lastSyncError: syncState.lastSyncError,
        lastSyncResult: syncState.lastSyncResult,
        modes: Object.fromEntries(Object.entries(modes).map(([key, value]) => [key, value.title]))
      });
    }

    if (req.method === "GET" && req.url.startsWith("/api/me")) return me(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/flows")) return flows(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/login")) return login(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/logout")) return logout(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/run")) return runCodex(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/repair")) return repairStep(req, res);

    if (req.method === "GET") return serveStatic(req, res, config.publicDir);
    sendJson(res, 405, { error: "方法不支持" });
  }

  return http.createServer(router);
}

function getFlows(config) {
  return Object.fromEntries(
    Object.entries(modes).map(([key, mode]) => [
      key,
      {
        title: mode.title,
        steps: getModeFlow(key, mode, config)
      }
    ])
  );
}

function getModeFlow(modeKey, mode, config) {
  return buildModeFlow(modeKey, mode, config).map((step, index) => ({
    ...step,
    id: normalizeStepId(step.id, index + 1),
    title: step.title || step.label
  }));
}

function normalizeStepId(stepId, index) {
  const clean = String(stepId || "").trim();
  return /^[a-z0-9][a-z0-9_-]*$/i.test(clean) ? clean : `step-${index}`;
}

function buildCodexPrompt({ mode, message, steps, repairStep }) {
  const stepList = steps.map(step => `- ${step.id}: ${step.label}`).join("\n");
  const markerGuide = [
    "你必须按下面的 skill 流程执行，并只用机器可解析标记汇报步骤状态：",
    stepList,
    "",
    "每开始一个步骤时输出：[[TB_STEP:<stepId>:running]]",
    "每完成一个步骤时输出：[[TB_STEP:<stepId>:done]]",
    "步骤失败或无法继续时输出：[[TB_STEP:<stepId>:failed]]",
    "不要输出命令行、脚本内容、密钥、token、完整接口响应或 skill 原文。"
  ].join("\n");
  const repairGuide = repairStep
    ? `\n这是单步修复任务，只修复当前步骤 ${repairStep.id}（${repairStep.label}）。不要重复执行其他已完成步骤。`
    : "";
  return `${mode.promptPrefix}\n\n${message}\n\n${markerGuide}${repairGuide}`;
}

function validateTaskMessage(modeKey, mode, message) {
  if (modeKey === "change" && mode.requireProjectUrl && !hasProjectUrl(message)) {
    return "项目变更必须粘贴对应的项目地址，避免只按项目名查找失败";
  }
  return "";
}

function hasProjectUrl(message) {
  return /https?:\/\/[^\s，。；;]+/i.test(String(message || ""));
}

function executeCodexStream({ req, res, config, prompt, startEvent }) {
  const completedSteps = new Set();
  const failedSteps = new Set();
  const knownSteps = new Set((startEvent.steps || []).map(step => step.id));

  writeNdjson(res, startEvent);

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    config.workspaceDir,
    "-"
  ];
  const child = spawn(config.codexBin, args, {
    cwd: config.workspaceDir,
    env: {
      ...process.env,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdin.on("error", err => {
    if (err.code !== "EPIPE") writeNdjson(res, { type: "error", error: err.message });
  });
  child.stdin.end(prompt);

  const handleOutput = chunk => {
    const parsed = parseCodexEvents(chunk.toString("utf8"));
    for (const event of parsed.events) {
      const { stepId, status } = event;
      if (!knownSteps.has(stepId)) continue;
      if (status === "done") completedSteps.add(stepId);
      if (status === "failed") failedSteps.add(stepId);
      writeNdjson(res, { type: "step", stepId, status });
    }
    if (parsed.text) writeNdjson(res, { type: "log", message: parsed.text });
  };

  child.stdout.on("data", handleOutput);
  child.stderr.on("data", handleOutput);

  child.on("error", err => {
    writeNdjson(res, { type: "error", error: err.message });
    res.end();
  });

  child.on("close", code => {
    const missingSteps = [...knownSteps].filter(stepId => !completedSteps.has(stepId));
    writeNdjson(res, {
      type: "done",
      code,
      completedSteps: [...completedSteps],
      failedSteps: [...failedSteps],
      missingSteps,
      finishedAt: new Date().toISOString()
    });
    res.end();
  });

  res.on("close", () => {
    if (!res.writableEnded && !child.killed) child.kill("SIGTERM");
  });
}

function writeNdjson(res, event) {
  res.write(JSON.stringify(event) + "\n");
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error("请求内容过长"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("请求 JSON 格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, publicDir) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let file = decodeURIComponent(url.pathname);
  if (file === "/") file = "/index.html";
  const full = path.normalize(path.join(publicDir, file));
  if (!full.startsWith(publicDir)) return sendJson(res, 403, { error: "拒绝访问" });

  fs.readFile(full, (err, data) => {
    if (err) return sendJson(res, 404, { error: "页面不存在" });
    const ext = path.extname(full).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function start() {
  loadEnvFile(__dirname);
  const config = loadConfig(process.env, __dirname);
  const store = createStore({ databasePath: config.databasePath });
  const syncState = createSyncState();
  startCchSync({ config, store, syncState });
  const server = createServer({ config, store, syncState });
  server.listen(config.port, config.host, () => {
    console.log(`TB AI Platform listening on http://${config.host}:${config.port}`);
  });
}

function createSyncState() {
  return { lastSyncAt: null, lastSyncError: null, lastSyncResult: null };
}

function startCchSync({ config, store, syncState }) {
  if (!config.cchDatabaseUrl) return null;

  const run = async () => {
    try {
      const result = await syncFromCchDatabase(store, config.cchDatabaseUrl);
      syncState.lastSyncAt = new Date().toISOString();
      syncState.lastSyncError = null;
      syncState.lastSyncResult = result;
      console.log(
        `CCH sync complete: users ${result.usersCreated}/${result.usersUpdated}, keys ${result.keysCreated}/${result.keysUpdated}`
      );
    } catch (err) {
      syncState.lastSyncError = err.message;
      console.error(`CCH sync failed: ${err.message}`);
    }
  };

  run();
  const timer = setInterval(run, config.cchSyncIntervalMs);
  timer.unref?.();
  return timer;
}

if (require.main === module) {
  start();
}

module.exports = {
  createServer,
  createSyncState,
  modes,
  parseBody,
  sendJson,
  start,
  startCchSync
};
