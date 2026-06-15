const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const WORKSPACE = path.join(ROOT, "workspace");

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const CODEX_BIN = process.env.CODEX_BIN || path.join(process.env.HOME || "/home/gpt", ".local/bin/codex");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

fs.mkdirSync(WORKSPACE, { recursive: true });

const modes = {
  create: {
    title: "创建钉钉 TB 项目",
    skill: "通用-钉钉创建项目",
    promptPrefix:
      "你正在通过网站后台执行钉钉 TB 项目创建任务。必须使用 skill `通用-钉钉创建项目`；如果需要先查审批信息，也要使用 `通用-审批信息查找`。请用中文输出执行过程和结果，不要泄露任何 AppSecret、accessToken 或完整敏感凭证。用户需求如下："
  },
  change: {
    title: "创建项目变更迭代",
    skill: "通用-钉钉项目变更",
    promptPrefix:
      "你正在通过网站后台执行钉钉 TB 项目变更任务。必须使用 skill `通用-钉钉项目变更`；如果需要先查审批信息，也要使用 `通用-审批信息查找`。请用中文输出执行过程和结果，不要泄露任何 AppSecret、accessToken 或完整敏感凭证。用户需求如下："
  }
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
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

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let file = decodeURIComponent(url.pathname);
  if (file === "/") file = "/index.html";
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC)) return sendJson(res, 403, { error: "拒绝访问" });

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

async function runCodex(req, res) {
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

  const runId = crypto.randomUUID();
  const prompt = `${mode.promptPrefix}\n\n${message}`;
  const startedAt = new Date().toISOString();

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no"
  });
  res.write(JSON.stringify({ type: "start", runId, mode: body.mode, title: mode.title, startedAt }) + "\n");

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    WORKSPACE,
    "-"
  ];
  const child = spawn(CODEX_BIN, args, {
    cwd: WORKSPACE,
    env: {
      ...process.env,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdin.end(prompt);

  child.stdout.on("data", chunk => {
    res.write(JSON.stringify({ type: "stdout", data: chunk.toString("utf8") }) + "\n");
  });

  child.stderr.on("data", chunk => {
    res.write(JSON.stringify({ type: "stderr", data: chunk.toString("utf8") }) + "\n");
  });

  child.on("error", err => {
    res.write(JSON.stringify({ type: "error", error: err.message }) + "\n");
    res.end();
  });

  child.on("close", code => {
    res.write(JSON.stringify({ type: "done", code, finishedAt: new Date().toISOString() }) + "\n");
    res.end();
  });

  req.on("close", () => {
    if (!child.killed) child.kill("SIGTERM");
  });
}

function router(req, res) {
  if (req.method === "GET" && req.url.startsWith("/api/health")) {
    return sendJson(res, 200, {
      ok: true,
      codexBin: CODEX_BIN,
      authRequired: false,
      modes: Object.fromEntries(Object.entries(modes).map(([key, value]) => [key, value.title]))
    });
  }

  if (req.method === "POST" && req.url.startsWith("/api/run")) {
    return runCodex(req, res);
  }

  if (req.method === "GET") return serveStatic(req, res);
  sendJson(res, 405, { error: "方法不支持" });
}

http.createServer(router).listen(PORT, HOST, () => {
  console.log(`TB AI Platform listening on http://${HOST}:${PORT}`);
});
