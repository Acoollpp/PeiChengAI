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
const { detectProjectItems } = require("./src/projectItems");
const { buildModeFlow } = require("./src/skillFlow");
const { analyzeTask, extractFields } = require("./src/taskAnalysis");

const modes = {
  create: {
    title: "创建钉钉 TB 项目",
    skill: "通用-钉钉创建项目",
    skills: ["通用-钉钉创建项目"],
    promptPrefix:
      "你正在通过网站后台执行钉钉 TB 项目创建任务。用户会直接粘贴项目创建信息单；必须使用 skill `通用-钉钉创建项目`。不要泄露任何 AppSecret、accessToken 或完整敏感凭证。用户需求如下："
  },
  change: {
    title: "创建项目变更迭代",
    skill: "通用-钉钉项目变更",
    skills: ["通用-钉钉项目变更"],
    promptPrefix:
      "你正在通过网站后台执行钉钉 TB 项目变更任务。用户会直接粘贴项目变更信息单；如果用户提供 Teambition/钉钉项目地址，必须优先用项目地址定位项目，否则用项目名称、原项目编号和新项目编号定位。必须使用 skill `通用-钉钉项目变更`。不要泄露任何 AppSecret、accessToken 或完整敏感凭证。用户需求如下："
  },
  researchCreate: {
    title: "创建研发项目",
    skill: "dingtalk-research-project-create",
    skills: ["dingtalk-research-project-create"],
    promptPrefix:
      "你正在通过网站后台执行钉钉 TB 研发项目创建任务。用户会直接粘贴项目立项开发审批单；必须使用 skill `dingtalk-research-project-create`，按研发项目创建流程创建项目空间、迭代、文件夹、任务、项目概览和成员角色。研发项目的售前工程师必须取审批提交人，也就是 `某某提交的项目立项开发` 里的某某；不要用客户负责人、商务或客户表负责人替代。创建研发项目空间时不要给 create-teambition-project-from-template.py 传 --sprint-name；必须先创建项目空间并回查当前项目顶层 `1.0` 文件夹，再单独创建迭代和目标文件夹。研发文件夹替换必须从当前项目内顶层 `1.0` 文件夹复制一级子目录，调用 `copy-teambition-template-folders.py` 时必须传 `--template-folder-id <1.0文件夹ID>` 和 `--require-template-folder-id`，禁止退回顶层 `模板文件夹/文件模板/文件夹模板`。项目概览必须写入项目重要等级和 LPDT；LPDT 优先按已存在的 PACK 技术/硬件主管映射写入成员胶囊，不允许写成普通文本。项目编号和 PCB 必须按页面模板补 `-1.0` 多行格式，例如 `BMS: 编号-1.0`、`灯板编号为: 编号-1.0`、`BMS:（PCB=PCB-1.0）`、`灯板(PCB=PCB-1.0)`。不要执行研发变更流程，不要泄露任何 AppSecret、accessToken 或完整敏感凭证。用户需求如下："
  }
};

function createServer({ config, store, syncState }) {
  fs.mkdirSync(config.workspaceDir, { recursive: true });
  const activeRuns = new Map();
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

  function history(req, res) {
    const currentUser = auth.getCurrentUser(req);
    if (!currentUser) return sendJson(res, 401, { error: "请先登录" });
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const mode = url.searchParams.get("mode");
    if (mode && !modes[mode]) return sendJson(res, 400, { error: "任务类型无效" });
    const history = store.listRunHistory({ userId: currentUser.id, mode });
    return sendJson(res, 200, { history, stats: summarizeHistory(history) });
  }

  function historyDetail(req, res) {
    const currentUser = auth.getCurrentUser(req);
    if (!currentUser) return sendJson(res, 401, { error: "请先登录" });
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const runId = url.searchParams.get("runId");
    if (!runId) return sendJson(res, 400, { error: "缺少 runId" });
    const item = store.getRunHistory({ userId: currentUser.id, runId });
    if (!item) return sendJson(res, 404, { error: "历史记录不存在" });
    return sendJson(res, 200, { item });
  }

  function auditLogs(req, res) {
    const currentUser = auth.getCurrentUser(req);
    if (!currentUser) return sendJson(res, 401, { error: "请先登录" });
    return sendJson(res, 200, { logs: store.listAuditLogs({ userId: currentUser.id }) });
  }

  function credentialHealth(req, res) {
    const currentUser = auth.getCurrentUser(req);
    if (!currentUser) return sendJson(res, 401, { error: "请先登录" });
    return sendJson(res, 200, {
      codexBin: fs.existsSync(config.codexBin),
      cchSync: !syncState.lastSyncError,
      teambitionCredential:
        Boolean(process.env.TEAMBITION_APP_ID && process.env.TEAMBITION_APP_SECRET) ||
        Boolean(process.env.TEAMBITION_APP_ACCESS_TOKEN) ||
        Boolean(process.env.TEAMBITION_APP_KEY || process.env.TEAMBITION_CLIENT_ID || process.env.TB_ACCESS_TOKEN) ||
        Boolean(process.env.TEAMBITION_TOKEN),
      lastSyncAt: syncState.lastSyncAt,
      lastSyncError: syncState.lastSyncError
    });
  }

  async function previewTask(req, res) {
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
    const projectUrl = normalizeProjectUrl(body.projectUrl);
    if (!mode) return sendJson(res, 400, { error: "任务类型无效" });
    if (!message) return sendJson(res, 400, { error: "请输入任务内容" });
    const preview = analyzeTask({ mode: body.mode, message, projectUrl });
    const rebuildRoute = await analyzeChangeRebuildRoute({ message, projectUrl });
    if (rebuildRoute) {
      preview.mode = "create";
      preview.suggestedMode = "create";
      preview.redirectMode = "create";
      preview.redirectReason = rebuildRoute.reason;
      preview.route = rebuildRoute;
      preview.warnings = [rebuildRoute.reason, ...(preview.warnings || [])];
    }
    const validationError = rebuildRoute ? "" : validateTaskMessage(body.mode, mode, message, preview.items, projectUrl);
    return sendJson(res, 200, {
      preview,
      validationError,
      canRun: !validationError,
      redirectMode: rebuildRoute?.redirectMode || "",
      redirectReason: rebuildRoute?.reason || "",
      route: rebuildRoute || null
    });
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
    const aiTest = ["create", "researchCreate"].includes(body.mode) && Boolean(body.aiTest);
    const projectUrl = normalizeProjectUrl(body.projectUrl);
    if (!mode) return sendJson(res, 400, { error: "任务类型无效" });
    if (!message) return sendJson(res, 400, { error: "请输入任务内容" });
    const items = detectProjectItems(body.mode, message);
    if (body.mode === "change") {
      const rebuildRoute = await analyzeChangeRebuildRoute({ message, projectUrl });
      if (rebuildRoute) return sendJson(res, 409, { error: rebuildRoute.reason, redirectMode: "create", route: rebuildRoute });
    }
    const validationError = validateTaskMessage(body.mode, mode, message, items, projectUrl);
    if (validationError) return sendJson(res, 400, { error: validationError });
    if (items.length > 5 && !body.confirmed) return sendJson(res, 409, { error: `将处理 ${items.length} 个项目，请先预览确认`, requiresConfirmation: true });

    const runId = crypto.randomUUID();
    const flow = getModeFlow(body.mode, mode, config);
    const startedAt = new Date().toISOString();

    store.recordAuditLog({
      userId: currentUser.id,
      action: "run_codex",
      mode: body.mode,
      runId,
      metadata: {
        title: mode.title,
        messageLength: message.length,
        itemCount: items.length,
        aiTest,
        hasProjectUrl: Boolean(projectUrl)
      }
    });

    store.createRunHistory({
      userId: currentUser.id,
      runId,
      mode: body.mode,
      title: aiTest ? `${mode.title}（AI测试）` : mode.title,
      message,
      itemCount: items.length,
      projectUrl,
      aiTest
    });

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    });
    executeCodexBatch({
      req,
      res,
      store,
      activeRuns,
      userId: currentUser.id,
      runId,
      config,
      mode,
      modeKey: body.mode,
      message,
      flow,
      items,
      aiTest,
      projectUrl,
      startEvent: { type: "start", runId, mode: body.mode, title: mode.title, startedAt, steps: flow, items, aiTest }
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
    const projectUrl = normalizeProjectUrl(body.projectUrl);
    if (!mode) return sendJson(res, 400, { error: "任务类型无效" });
    if (!message) return sendJson(res, 400, { error: "请输入任务内容" });
    const validationError = validateTaskMessage(body.mode, mode, message, [], projectUrl);
    if (validationError) return sendJson(res, 400, { error: validationError });

    const flow = getModeFlow(body.mode, mode, config);
    const stepIndex = flow.findIndex(item => item.id === body.stepId);
    const step = flow[stepIndex];
    if (!step) return sendJson(res, 400, { error: "流程步骤无效" });
    if (!step.repairable) return sendJson(res, 400, { error: "这个步骤不支持自动修复" });
    if (body.sourceRunId) {
      const sourceRun = store.getRunHistory({ userId: currentUser.id, runId: body.sourceRunId });
      const failedStepIds = new Set([...(sourceRun?.failedSteps || []), ...(sourceRun?.missingSteps || [])].map(value => String(value).split(":").pop()));
      if (!sourceRun || sourceRun.status === "success" || !failedStepIds.has(step.id)) {
        return sendJson(res, 400, { error: "只能修复历史中已失败的步骤" });
      }
    }

    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const continueAfterRepair = body.continueAfterRepair !== false;
    const repairSteps = continueAfterRepair ? flow.slice(stepIndex) : [step];
    const prompt = buildCodexPrompt({
      modeKey: body.mode,
      mode,
      message,
      steps: repairSteps,
      repairStep: step,
      projectUrl,
      continueAfterRepair
    });

    store.recordAuditLog({
      userId: currentUser.id,
      action: "repair_codex_step",
      mode: body.mode,
      runId,
      metadata: {
        title: mode.title,
        stepId: step.id,
        stepLabel: step.label,
        messageLength: message.length,
        continueAfterRepair
      }
    });
    store.createRunHistory({
      userId: currentUser.id,
      runId,
      mode: body.mode,
      title: `修复：${step.label}`,
      message,
      itemCount: 1,
      projectUrl
    });

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    });

    executeCodexStream({
      req,
      res,
      controller: createRunController({ activeRuns, runId, userId: currentUser.id, modeKey: body.mode }),
      config,
      prompt,
      startEvent: {
        type: "start",
        runId,
        mode: body.mode,
        title: `修复：${step.label}`,
        startedAt,
        steps: repairSteps,
        repair: true,
        repairStepId: step.id
      },
      onDone: result => {
        activeRuns.delete(runId);
        const resultUrls = result.url ? [{ itemId: result.itemId, itemTitle: result.itemTitle, url: result.url }] : [];
        const errorMessages = result.error ? [{ itemId: result.itemId, itemTitle: result.itemTitle, message: result.error }] : [];
        store.finishRunHistory({
          runId,
          status:
            result.code === 130
              ? "aborted"
              :
            result.code === 0 && result.failedSteps.length === 0 && result.missingSteps.length === 0
              ? "success"
              : "failed",
          ...result,
          resultUrls,
          errorMessages,
          itemResults: [result]
        });
      }
    });
  }

  async function abortRun(req, res) {
    const currentUser = auth.getCurrentUser(req);
    if (!currentUser) return sendJson(res, 401, { error: "请先登录" });

    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const runId = String(body.runId || "").trim();
    if (!runId) return sendJson(res, 400, { error: "缺少 runId" });
    const active = activeRuns.get(runId);
    if (!active || active.userId !== currentUser.id) return sendJson(res, 404, { error: "没有找到正在执行的任务" });
    active.abort("用户已中止生成");
    store.recordAuditLog({
      userId: currentUser.id,
      action: "abort_codex_run",
      mode: active.modeKey,
      runId,
      metadata: { reason: "用户已中止生成" }
    });
    return sendJson(res, 200, { ok: true, runId });
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
    if (req.method === "GET" && req.url.startsWith("/api/history/detail")) return historyDetail(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/history")) return history(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/audit")) return auditLogs(req, res);
    if (req.method === "GET" && req.url.startsWith("/api/credential-health")) return credentialHealth(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/login")) return login(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/logout")) return logout(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/preview")) return previewTask(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/run")) return runCodex(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/repair")) return repairStep(req, res);
    if (req.method === "POST" && req.url.startsWith("/api/abort")) return abortRun(req, res);

    if (req.method === "GET") return serveStatic(req, res, config.publicDir);
    sendJson(res, 405, { error: "方法不支持" });
  }

  return http.createServer(router);
}

async function executeCodexBatch({
  req,
  res,
  store,
  activeRuns,
  userId,
  runId,
  config,
  mode,
  modeKey,
  message,
  flow,
  items,
  aiTest,
  projectUrl,
  startEvent
}) {
  const controller = createRunController({ activeRuns, runId, userId, modeKey });
  writeNdjson(res, startEvent);
  const results = await runWithConcurrency(items, config.batchConcurrency || 5, item =>
    executeCodexStream({
      req,
      res,
      controller,
      config,
      prompt: buildCodexPrompt({
        modeKey,
        mode,
        message: item.message,
        steps: flow,
        item,
        totalItems: items.length,
        aiTest,
        projectUrl
      }),
      startEvent: null,
      item,
      endResponse: false
    })
  );
  activeRuns.delete(runId);

  const completedSteps = results.flatMap(result => result.completedSteps.map(stepId => `${result.itemId}:${stepId}`));
  const failedSteps = results.flatMap(result => result.failedSteps.map(stepId => `${result.itemId}:${stepId}`));
  const missingSteps = results.flatMap(result => result.missingSteps.map(stepId => `${result.itemId}:${stepId}`));
  const resultUrls = results.filter(result => result.url).map(result => ({ itemId: result.itemId, itemTitle: result.itemTitle, url: result.url }));
  const errorMessages = results
    .filter(result => result.error)
    .map(result => ({ itemId: result.itemId, itemTitle: result.itemTitle, message: result.error }));
  const aborted = results.some(result => result.code === 130);
  const code = aborted ? 130 : results.every(result => result.code === 0) ? 0 : 1;
  const status = aborted ? "aborted" : code === 0 && failedSteps.length === 0 && missingSteps.length === 0 && errorMessages.length === 0 ? "success" : "failed";

  const doneEvent = {
    type: "done",
    code,
    completedSteps,
    failedSteps,
    missingSteps,
    resultUrls,
    errorMessages,
    itemResults: results,
    finishedAt: new Date().toISOString()
  };
  store.finishRunHistory({
    runId,
    status,
    code,
    completedSteps,
    failedSteps,
    missingSteps,
    resultUrls,
    errorMessages,
    itemResults: results
  });
  writeNdjson(res, doneEvent);
  res.end();
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

function buildCodexPrompt({ modeKey, mode, message, steps, repairStep, item, totalItems, aiTest, projectUrl, continueAfterRepair }) {
  const stepList = steps.map(step => `- ${step.id}: ${step.label}`).join("\n");
  const platformGuide = buildPlatformConstraintGuide(modeKey, message);
  const markerGuide = [
    "你必须按下面的 skill 流程执行，并只用机器可解析标记汇报步骤状态：",
    stepList,
    "",
    "每开始一个步骤时输出：[[TB_STEP:<stepId>:running]]",
    "每完成一个步骤时输出：[[TB_STEP:<stepId>:done]]",
    "步骤失败或无法继续时输出：[[TB_STEP:<stepId>:failed]]",
    "创建或变更成功后必须输出项目地址标记：[[TB_RESULT:<itemId>:<项目URL>]]，单项目使用 item-1。",
    "也可以输出结构化结果标记：[[TB_JSON:{\"itemId\":\"item-1\",\"url\":\"https://...\"}]]。",
    "失败时必须输出错误标记：[[TB_ERROR:<itemId>:<可读错误原因>]]，单项目使用 item-1。",
    "当前运行环境是 Linux 服务器。不要安装 PowerShell 7，不要调用 .ps1；优先直接使用 skill 的 scripts/*.py，或用 Node.js、Python、curl 调用 Teambition/OpenAPI。",
    "不要输出命令行、脚本内容、密钥、token、完整接口响应或 skill 原文。"
  ].join("\n");
  const repairGuide = repairStep
    ? continueAfterRepair
      ? `\n这是自动修复并续跑任务：先修复当前步骤 ${repairStep.id}（${repairStep.label}），修复成功后继续按上面的流程顺序执行后续步骤。不要重复执行当前步骤之前已经完成的步骤。`
      : `\n这是单步修复任务，只修复当前步骤 ${repairStep.id}（${repairStep.label}）。不要重复执行其他已完成步骤。`
    : "";
  const itemGuide = item && totalItems > 1
    ? `\n这是并行项目任务中的一个独立项目：${item.title}。平台已把多项目审批单拆成独立 item 并发执行；当前只处理下面这一份项目信息单，不要创建或变更其他项目。`
    : "";
  const aiTestGuide = aiTest
    ? "\n这是 AI 测试创建：创建项目空间、迭代、文件夹、任务等所有会显示项目名的位置，项目名称都必须追加 `（AI测试）`；如果原信息单项目名已带该后缀，不要重复追加。"
    : "";
  const projectUrlGuide = projectUrl
    ? `\n用户单独提供的项目地址：${projectUrl}\n如果这是项目变更任务，必须优先使用这个地址定位项目。`
    : "";
  return `${mode.promptPrefix}\n\n${itemGuide}${aiTestGuide}${projectUrlGuide}${platformGuide}\n\n${message}\n\n${markerGuide}${repairGuide}`;
}

function buildPlatformConstraintGuide(modeKey, message) {
  const isChangeText = /项目变更申请|原项目编号|新项目编号|变更类别|变更缘由/.test(String(message || ""));
  if (modeKey !== "change" && !(modeKey === "create" && isChangeText)) return "";
  const fields = extractFields("change", message);
  const lines = [
    "",
    modeKey === "create" && isChangeText
      ? "平台判断这是一张需要重新创建项目的变更单。必须按创建项目流程处理：用新项目编号创建新项目，不要在原项目内创建变更迭代。"
      : "平台已解析出以下项目变更硬性校验点，执行和回查必须逐项满足；不满足时对应步骤必须输出 failed，不能输出 done："
  ];
  if (fields.pcb) {
    lines.push(`- PCB/底板：${fields.pcb}。如果该值带 SST 等前缀，迭代名、文件夹名和项目概览 PCB 必须保留完整号，不能简化。`);
  } else {
    lines.push("- PCB/底板：未从输入中识别到；必须从审批信息或用户输入确认，只有确实没有新 PCB/底板时才沿用原项目 PCB。");
  }
  if (fields.presales) {
    lines.push(`- 售前工程师：${fields.presales}。项目变更默认谁提交审批谁就是售前工程师，不能用新能源PM替代。`);
  } else {
    lines.push("- 售前工程师：未识别到审批提交人；必须在执行前确认提交人，不能把新能源PM默认当售前。");
  }
  if (fields.engineer) lines.push(`- 项目工程师：${fields.engineer}。必须写入项目概览、任务项目工程师字段并设置项目角色。`);
  if (fields.pm) lines.push(`- 新能源PM：${fields.pm}。可加入 PM及售前工程师角色，但不能覆盖售前工程师。`);
  if (modeKey === "create" && isChangeText) {
    lines.push("- 多项目规则：如果审批单包含多个项目名称/原项目编号/新项目编号，平台会先按顺序拆成多个独立 item 并发执行；每个 item 只处理自己这一组项目，不得串用其他组字段。");
    lines.push("- 创建来源：这是由旧迭代截止时间规则触发的重建项目，不是创建变更迭代；必须按创建项目流程创建全新 TB 项目。");
    lines.push("- 编号规则：用变更单的新项目编号作为新项目的项目编号/版本来源；不要沿用原项目编号作为最终项目编号。");
    lines.push("- 创建验收：按普通创建项目验收项目空间、迭代、文件夹、模板任务、需求资料时间/工时、项目概览和成员角色；不要要求 TZ一类审批任务任务标识。");
  } else {
    lines.push("- 原迭代任务截止时间：定位原项目和原项目编号对应的原迭代后，必须读取该原迭代下任务的 dueDate/截止时间；如果原迭代任务截止时间早于 2025-10-01 00:00:00，则不能在老项目内创建变更迭代，必须改走新项目创建流程并按新项目创建验收。原迭代任务截止时间为 2025-10-01 当天及之后，才允许继续变更迭代。");
    lines.push("- 任务标识：所有本次变更保留任务必须是 TZ一类审批任务；目标项目没有该任务标识配置时必须失败，不能静默使用拓展项目需求等其他标识。");
    lines.push("- 需求资料：必须设置执行者温昇炎、当天北京时间 08:30-22:00、计划工时 0.2h，并回查 startDate、dueDate、plantime=720000。");
    lines.push("- 完成后必须回查：完整 PCB 迭代名、完整 PCB 文件夹名、模板子文件夹、项目概览 PCB/售前/项目工程师、任务标识、任务迭代、任务项目工程师字段、需求资料时间和工时。");
  }
  return `\n${lines.join("\n")}`;
}


async function analyzeChangeRebuildRoute({ message, projectUrl }) {
  const text = String(message || "");
  if (!/项目变更申请|原项目编号|新项目编号|变更类别|变更缘由/.test(text)) return null;
  const projectId = projectIdFromUrl(projectUrl || text);
  if (!projectId) return null;
  const fields = extractFields("change", text);
  if (!fields.projectName || !fields.oldCode) return null;
  const projectNum = projectNoFromName(fields.projectName);
  const originalVersion = versionFromCode(fields.oldCode);
  if (!projectNum || !originalVersion) return null;
  const originalPrefix = `${projectNum}-${originalVersion}`;
  const headers = teambitionApiHeaders();
  if (!headers) return null;
  const tasks = resultItems(await requestJson("GET", `https://open.teambition.com/api/v3/project/${projectId}/task/query?pageSize=200&includeArchived=false`, headers));
  const matched = tasks.filter(task => String(task.content || "").startsWith(originalPrefix));
  const dueValues = matched
    .map(task => utcSecond(task.dueDate))
    .filter(Boolean);
  if (!matched.length || !dueValues.length) return null;
  const latestDueDate = dueValues.sort().at(-1);
  const cutoff = "2025-10-01T00:00:00Z";
  if (latestDueDate >= cutoff) return null;
  return {
    redirectMode: "create",
    projectId,
    originalPrefix,
    latestDueDate,
    cutoff,
    reason: `原迭代 ${originalPrefix} 的任务最晚截止时间为 ${latestDueDate}，早于 ${cutoff}，按规则需要走创建项目流程重新创建项目。`
  };
}

function projectIdFromUrl(value) {
  const match = String(value || "").match(/\/project\/([a-f0-9]{16,32})/i);
  return match ? match[1] : "";
}

function projectNoFromName(value) {
  const head = String(value || "").split("-", 1)[0];
  return (head.match(/\d+/) || [""])[0];
}

function versionFromCode(value) {
  const parts = String(value || "").trim().split("-");
  return parts.length ? parts.at(-1) : "";
}

function utcSecond(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function resultItems(response) {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.result)) return response.result;
  if (response.result && Array.isArray(response.result.data)) return response.result.data;
  if (response.result && Array.isArray(response.result.items)) return response.result.items;
  if (Array.isArray(response.data)) return response.data;
  return [];
}

async function requestJson(method, url, headers, body) {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}

function teambitionApiHeaders() {
  const token = process.env.TEAMBITION_APP_ACCESS_TOKEN || teambitionJwt();
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "X-Tenant-Id": "6332aedbf2f7a37b02722d7c",
    "X-Tenant-Type": "organization",
    "x-operator-id": "62ac4eff73210bdb8911dad3"
  };
}

function teambitionJwt() {
  const appId = process.env.TEAMBITION_APP_ID;
  const appSecret = process.env.TEAMBITION_APP_SECRET;
  if (!appId || !appSecret) return "";
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ typ: "JWT", alg: "HS256" }));
  const payload = base64Url(JSON.stringify({ _appId: appId, iat: now, exp: now + 7200 }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", appSecret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}


function summarizeHistory(history) {
  const finished = history.filter(item => item.durationMs !== null);
  const success = history.filter(item => item.status === "success").length;
  const failed = history.filter(item => item.status === "failed").length;
  const aborted = history.filter(item => item.status === "aborted").length;
  const totalDurationMs = finished.reduce((sum, item) => sum + item.durationMs, 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayRuns = history.filter(item => String(item.createdAt || "").startsWith(today)).length;
  const projectCount = history.reduce((sum, item) => sum + (item.itemCount || 1), 0);
  return {
    total: history.length,
    success,
    failed,
    aborted,
    running: history.filter(item => item.status === "running").length,
    todayRuns,
    successRate: history.length ? Math.round((success / history.length) * 100) : null,
    averagePerProjectMs: projectCount && finished.length ? Math.round(totalDurationMs / projectCount) : null,
    topErrors: topErrors(history),
    averageDurationMs: finished.length ? Math.round(totalDurationMs / finished.length) : null,
    lastDurationMs: finished[0]?.durationMs ?? null
  };
}

function topErrors(history) {
  const counts = new Map();
  for (const item of history) {
    for (const error of item.errorMessages || []) {
      const message = String(error.message || "").slice(0, 80);
      if (message) counts.set(message, (counts.get(message) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([message, count]) => ({ message, count }));
}

function validateTaskMessage(modeKey, mode, message, items = [], projectUrl = "") {
  if (modeKey === "change" && !hasProjectUrl(`${message}\n${projectUrl}`) && !hasChangeFields(message, items)) {
    return "项目变更请粘贴项目地址，或提供项目名称、原项目编号和新项目编号";
  }
  return "";
}

function normalizeProjectUrl(value) {
  const text = String(value || "").trim();
  return hasProjectUrl(text) ? text : "";
}

function hasProjectUrl(message) {
  return /https?:\/\/[^\s，。；;]+/i.test(String(message || ""));
}

function hasChangeFields(message, items = []) {
  if (items.length > 1) return true;
  const text = String(message || "");
  return /项目名称/.test(text) && /原项目编号/.test(text) && /新项目编号/.test(text);
}

function createRunController({ activeRuns, runId, userId, modeKey }) {
  const controller = {
    runId,
    userId,
    modeKey,
    aborted: false,
    abortReason: "",
    children: new Set(),
    abort(reason = "用户已中止生成") {
      this.aborted = true;
      this.abortReason = reason;
      for (const child of this.children) killChildProcess(child);
    }
  };
  activeRuns.set(runId, controller);
  return controller;
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function executeCodexStream({ req, res, config, prompt, startEvent, item, endResponse = true, onDone, controller }) {
  const completedSteps = new Set();
  const failedSteps = new Set();
  const knownSteps = new Set((startEvent?.steps || []).map(step => step.id));
  if (!knownSteps.size && startEvent === null) {
    const markerSteps = prompt.match(/- ([a-z0-9_-]+):/gi) || [];
    markerSteps.forEach(line => knownSteps.add(line.replace(/^- /, "").replace(/:.*/, "").trim()));
  }

  if (startEvent) writeNdjson(res, startEvent);

  return new Promise(resolve => {
    let resultUrl = "";
    let errorMessage = "";
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
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    controller?.children.add(child);

    child.stdin.on("error", err => {
      if (err.code !== "EPIPE") writeNdjson(res, withItem({ type: "error", error: err.message }, item));
    });
    child.stdin.end(prompt);

    const handleOutput = chunk => {
      const outputText = chunk.toString("utf8");
      const resultEvents = parseResultEvents(outputText, item);
      for (const event of resultEvents) {
        if (event.type === "result" && usableProjectUrl(event.url)) resultUrl = event.url;
        if (event.type === "run_error") {
          errorMessage = event.message;
          const inferredUrl = projectUrlFromText(event.message);
          if (inferredUrl && !usableProjectUrl(resultUrl)) {
            resultUrl = inferredUrl;
            event.url = inferredUrl;
          }
        }
        writeNdjson(res, event);
      }
      const parsed = parseCodexEvents(outputText);
      for (const event of parsed.events) {
        const { stepId, status } = event;
        if (!knownSteps.has(stepId)) continue;
        if (status === "done") completedSteps.add(stepId);
        if (status === "failed") failedSteps.add(stepId);
        writeNdjson(res, withItem({ type: "step", stepId, status }, item));
      }
      if (parsed.text) writeNdjson(res, withItem({ type: "log", message: parsed.text }, item));
    };

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);

    child.on("error", err => {
      controller?.children.delete(child);
      writeNdjson(res, withItem({ type: "error", error: err.message }, item));
      if (endResponse) res.end();
      resolve(streamResult({ item, code: 1, completedSteps, failedSteps, knownSteps, resultUrl, errorMessage: errorMessage || err.message }));
    });

    child.on("close", code => {
      controller?.children.delete(child);
      const missing = [...knownSteps].filter(stepId => !completedSteps.has(stepId));
      const aborted = Boolean(controller?.aborted);
      if (aborted && !errorMessage) {
        errorMessage = controller.abortReason || "用户已中止生成";
        writeNdjson(res, withItem({ type: "run_error", message: errorMessage }, item));
      }
      if (!errorMessage && (code !== 0 || missing.length)) {
        errorMessage = code !== 0
          ? `Codex 退出码 ${code}`
          : `未完成步骤：${missing.join(", ")}`;
        writeNdjson(res, withItem({ type: "run_error", message: errorMessage }, item));
      }
      const result = streamResult({ item, code: aborted ? 130 : code, completedSteps, failedSteps, knownSteps, resultUrl, errorMessage });
      if (endResponse) {
        writeNdjson(res, {
          type: "done",
          code: result.code,
          completedSteps: result.completedSteps,
          failedSteps: result.failedSteps,
          missingSteps: result.missingSteps,
          finishedAt: new Date().toISOString()
        });
        onDone?.(result);
        res.end();
      }
      resolve(result);
    });

    res.on("close", () => {
      if (!res.writableEnded && !child.killed) {
        if (controller) controller.abort("用户已中止生成");
        else killChildProcess(child);
      }
    });
  });
}

function killChildProcess(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}

function streamResult({ item, code, completedSteps, failedSteps, knownSteps, resultUrl, errorMessage }) {
  const completed = [...completedSteps];
  const failed = [...failedSteps];
  return {
    itemId: item?.id || "item-1",
    itemTitle: item?.title || "项目 1",
    code,
    url: usableProjectUrl(resultUrl) || projectUrlFromText(errorMessage),
    error: errorMessage || "",
    completedSteps: completed,
    failedSteps: failed,
    missingSteps: [...knownSteps].filter(stepId => !completedSteps.has(stepId))
  };
}

function usableProjectUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return "";
  if (text === "https://..." || text === "http://...") return "";
  return text;
}

function projectUrlFromText(value) {
  const match = String(value || "").match(/https:\/\/www\.teambition\.com\/project\/[a-f0-9]{16,32}[^\s，。；;]*/i);
  return match ? match[0] : "";
}

function parseResultEvents(text, item) {
  const events = [];
  const resultRe = /\[\[TB_RESULT:([A-Za-z0-9_-]+):(https?:\/\/[^\]\s]+)\]\]/g;
  const errorRe = /\[\[TB_ERROR:([A-Za-z0-9_-]+):([^\]]+)\]\]/g;
  const jsonRe = /\[\[TB_JSON:({[\s\S]*?})\]\]/g;
  let match;
  while ((match = resultRe.exec(text))) {
    events.push({
      type: "result",
      itemId: match[1],
      itemTitle: item?.title || match[1],
      url: match[2]
    });
  }
  while ((match = errorRe.exec(text))) {
    const message = match[2].trim();
    const url = projectUrlFromText(message);
    events.push({
      type: "run_error",
      itemId: match[1],
      itemTitle: item?.title || match[1],
      message,
      ...(url ? { url } : {})
    });
  }
  while ((match = jsonRe.exec(text))) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.url) {
        events.push({
          type: "result",
          itemId: parsed.itemId || item?.id || "item-1",
          itemTitle: parsed.itemTitle || item?.title || parsed.itemId || "项目 1",
          url: parsed.url
        });
      }
      if (parsed.error) {
        events.push({
          type: "run_error",
          itemId: parsed.itemId || item?.id || "item-1",
          itemTitle: parsed.itemTitle || item?.title || parsed.itemId || "项目 1",
          message: String(parsed.error).trim()
        });
      }
    } catch {
      // Ignore malformed structured result markers.
    }
  }
  return events;
}

function withItem(event, item) {
  return item ? { ...event, itemId: item.id, itemTitle: item.title } : event;
}

function writeNdjson(res, event) {
  if (res.destroyed || res.writableEnded) return;
  try {
    res.write(JSON.stringify(event) + "\n");
  } catch {
    // The browser may have aborted the stream while the child process is closing.
  }
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
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0"
    });
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
