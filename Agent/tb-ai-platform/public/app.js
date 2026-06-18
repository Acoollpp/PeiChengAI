const state = {
  mode: "create",
  running: false,
  user: null,
  flows: {},
  stepStatus: new Map(),
  activeItems: [{ id: "item-1", title: "项目 1" }],
  resultsByMode: {
    create: new Map(),
    change: new Map()
  },
  historyByMode: {
    create: [],
    change: []
  },
  historyStatsByMode: {
    create: null,
    change: null
  },
  runMode: "create",
  runStartedAt: null,
  timerId: null,
  currentRunId: "",
  abortController: null,
  abortRequested: false,
  lastRunId: "",
  failedStepIds: new Set(),
  preview: null,
  previewConfirmed: false,
  projectView: ""
};

const modeTitles = {
  create: "创建钉钉 TB 项目",
  change: "创建项目变更迭代"
};

const modePlaceholders = {
  create: "粘贴项目创建信息单，例如项目名称、项目编号、客户、项目工程师、售前/发起人、客户要求日期等。",
  change: "粘贴项目变更信息单；有项目地址时一并粘贴，没有地址时需包含项目名称、原项目编号和新项目编号。"
};

const statusText = {
  pending: "未执行",
  running: "执行中",
  done: "已完成",
  failed: "需修复"
};

const rememberKeyStorageKey = "rememberedCchKey";

const el = {
  accountCard: document.querySelector("#accountCard"),
  accountName: document.querySelector("#accountName"),
  healthText: document.querySelector("#healthText"),
  loginBtn: document.querySelector("#loginBtn"),
  loginKey: document.querySelector("#loginKeyInput"),
  rememberKey: document.querySelector("#rememberKeyInput"),
  loginPanel: document.querySelector("#loginPanel"),
  loginState: document.querySelector("#loginState"),
  projectLauncher: document.querySelector("#projectLauncher"),
  extensionProjectBtn: document.querySelector("#extensionProjectBtn"),
  rdProjectBtn: document.querySelector("#rdProjectBtn"),
  historyList: document.querySelector("#historyList"),
  historyStats: document.querySelector("#historyStats"),
  logoutBtn: document.querySelector("#logoutBtn"),
  modeTitle: document.querySelector("#modeTitle"),
  message: document.querySelector("#messageInput"),
  projectUrlField: document.querySelector("#projectUrlField"),
  projectUrl: document.querySelector("#projectUrlInput"),
  pulse: document.querySelector(".pulse"),
  credentialHealth: document.querySelector("#credentialHealth"),
  auditList: document.querySelector("#auditList"),
  previewBtn: document.querySelector("#previewBtn"),
  previewPanel: document.querySelector("#previewPanel"),
  previewSummary: document.querySelector("#previewSummary"),
  previewList: document.querySelector("#previewList"),
  runBtn: document.querySelector("#runBtn"),
  aiTestBtn: document.querySelector("#aiTestBtn"),
  abortBtn: document.querySelector("#abortBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  runState: document.querySelector("#runState"),
  runTimer: document.querySelector("#runTimer"),
  runId: document.querySelector("#runId"),
  resultPanel: document.querySelector("#resultPanel"),
  resultList: document.querySelector("#resultList"),
  detailPanel: document.querySelector("#detailPanel"),
  detailBody: document.querySelector("#detailBody"),
  workspace: document.querySelector("#workspace"),
  flowSteps: document.querySelector("#flowSteps"),
  flowSummary: document.querySelector("#flowSummary")
};

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  el.modeTitle.textContent = modeTitles[mode];
  el.message.placeholder = modePlaceholders[mode];
  el.aiTestBtn.hidden = mode !== "create";
  el.projectUrlField.hidden = mode === "create";
  state.preview = null;
  state.previewConfirmed = false;
  el.previewPanel.hidden = true;
  resetFlowStatuses();
  renderFlowSteps();
  renderResults();
  renderHistory(state.historyByMode[mode] || [], state.historyStatsByMode[mode]);
  loadHistory(mode);
}

function setUser(user) {
  state.user = user;
  const loggedIn = Boolean(user);
  el.loginPanel.hidden = loggedIn;
  el.projectLauncher.hidden = !loggedIn;
  el.workspace.hidden = true;
  el.accountCard.hidden = !loggedIn;
  el.accountName.textContent = user ? user.fullName || `CCH 用户 ${user.cchUserId}` : "未登录";
  if (loggedIn) {
    openProjectView("");
    loadFlows();
    loadHistory(state.mode);
    loadCredentialHealth();
    loadAuditLogs();
  }
  if (!loggedIn) el.loginKey.focus();
}

function openProjectView(view) {
  state.projectView = view;
  el.extensionProjectBtn.classList.toggle("active", view === "extension");
  el.rdProjectBtn.classList.toggle("active", view === "rd");
  el.workspace.hidden = view !== "extension";
  if (view === "extension") {
    renderFlowSteps();
    renderResults();
    loadHistory(state.mode);
  }
}

function setRunning(running) {
  state.running = running;
  el.runBtn.disabled = running;
  el.aiTestBtn.disabled = running;
  el.abortBtn.hidden = !running;
  el.abortBtn.disabled = !running;
  el.runBtn.querySelector("span").textContent = running ? "运行中" : "启动流程";
  if (running) {
    startTimer();
    el.runState.textContent = "Codex 正在按 skill 流程处理";
  } else {
    stopTimer();
    state.abortController = null;
    state.abortRequested = false;
    state.currentRunId = "";
  }
  updateRepairButtons();
}

function flashButton(button) {
  if (!button) return;
  button.classList.remove("clicked");
  void button.offsetWidth;
  button.classList.add("clicked");
  window.setTimeout(() => button.classList.remove("clicked"), 640);
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    el.healthText.textContent = data.ok ? "服务在线" : "服务异常";
    el.pulse.classList.toggle("ok", Boolean(data.ok));
  } catch {
    el.healthText.textContent = "服务不可用";
    el.pulse.classList.remove("ok");
  }
}

async function checkSession() {
  try {
    const res = await fetch("/api/me");
    if (res.status === 401) return setUser(null);
    const data = await res.json();
    setUser(data.user);
  } catch {
    setUser(null);
  }
}

async function loadFlows() {
  try {
    const res = await fetch("/api/flows");
    if (res.status === 401) return setUser(null);
    if (!res.ok) throw new Error("流程配置读取失败");
    state.flows = await res.json();
    resetFlowStatuses();
    renderFlowSteps();
  } catch (err) {
    el.flowSummary.textContent = err.message;
  }
}

async function loadHistory(mode = state.mode) {
  try {
    const res = await fetch(`/api/history?mode=${encodeURIComponent(mode)}`);
    if (res.status === 401) return setUser(null);
    if (!res.ok) throw new Error("历史读取失败");
    const data = await res.json();
    state.historyByMode[mode] = data.history || [];
    state.historyStatsByMode[mode] = data.stats || null;
    if (mode === state.mode) renderHistory(state.historyByMode[mode], state.historyStatsByMode[mode]);
  } catch (err) {
    el.historyList.textContent = err.message;
  }
}

async function loadCredentialHealth() {
  try {
    const res = await fetch("/api/credential-health");
    if (res.status === 401) return setUser(null);
    if (!res.ok) throw new Error("凭证状态读取失败");
    const data = await res.json();
    el.credentialHealth.textContent = `Codex ${data.codexBin ? "正常" : "异常"} · CCH ${data.cchSync ? "正常" : "异常"} · TB凭证 ${data.teambitionCredential ? "已配置" : "未检测到"}`;
  } catch (err) {
    el.credentialHealth.textContent = err.message;
  }
}

async function loadAuditLogs() {
  try {
    const res = await fetch("/api/audit");
    if (res.status === 401) return setUser(null);
    if (!res.ok) throw new Error("审计日志读取失败");
    const data = await res.json();
    el.auditList.innerHTML = "";
    const logs = data.logs || [];
    if (!logs.length) {
      el.auditList.textContent = "暂无审计记录";
      return;
    }
    for (const log of logs.slice(0, 5)) {
      const row = document.createElement("div");
      row.className = "history-item";
      const title = document.createElement("strong");
      title.textContent = auditAction(log.action);
      const meta = document.createElement("small");
      meta.textContent = `${modeTitles[log.mode] || log.mode || "系统"} · ${formatTime(log.createdAt)}`;
      row.append(title, meta);
      el.auditList.append(row);
    }
  } catch (err) {
    el.auditList.textContent = err.message;
  }
}

async function login() {
  const key = el.loginKey.value.trim();
  if (!key) {
    el.loginState.textContent = "请输入 CCH key";
    el.loginKey.focus();
    return;
  }

  el.loginBtn.disabled = true;
  el.loginState.textContent = "正在登录";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key })
    });
    const data = await res.json().catch(() => ({ error: "登录失败" }));
    if (!res.ok) throw new Error(data.error || "登录失败");
    saveRememberedKey(key);
    if (!el.rememberKey.checked) el.loginKey.value = "";
    el.loginState.textContent = "登录成功";
    setUser(data.user);
  } catch (err) {
    el.loginState.textContent = err.message;
  } finally {
    el.loginBtn.disabled = false;
  }
}

function loadRememberedKey() {
  const rememberedCchKey = localStorage.getItem(rememberKeyStorageKey) || "";
  if (!rememberedCchKey) return;
  el.loginKey.value = rememberedCchKey;
  el.rememberKey.checked = true;
  el.loginState.textContent = "已填入本机保存的 CCH key";
}

function saveRememberedKey(key) {
  if (el.rememberKey.checked) {
    localStorage.setItem(rememberKeyStorageKey, key);
  } else {
    localStorage.removeItem(rememberKeyStorageKey);
  }
}

async function logout() {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  setUser(null);
  openProjectView("");
  state.flows = {};
  state.stepStatus.clear();
  Object.values(state.resultsByMode).forEach(results => results.clear());
  state.activeItems = [{ id: "item-1", title: "项目 1" }];
  el.flowSteps.innerHTML = "";
  el.flowSummary.textContent = "等待登录";
  el.historyList.textContent = "等待登录";
  el.credentialHealth.textContent = "等待登录";
  el.auditList.textContent = "等待登录";
  el.runId.textContent = "未开始";
  el.runState.textContent = "等待输入";
  el.runTimer.textContent = "00:00";
  el.abortBtn.hidden = true;
  el.abortBtn.disabled = true;
  el.previewPanel.hidden = true;
  el.detailPanel.hidden = true;
  clearResults();
}

function resetFlowStatuses() {
  state.stepStatus.clear();
  for (const item of state.activeItems) {
    getCurrentSteps().forEach(step => state.stepStatus.set(stepKey(item.id, step.id), "pending"));
  }
}

function getCurrentSteps() {
  return state.flows[state.mode]?.steps || [];
}

function renderFlowSteps() {
  const steps = getCurrentSteps();
  el.flowSteps.innerHTML = "";
  if (!steps.length) {
    el.flowSummary.textContent = "等待加载 skill 流程";
    return;
  }

  for (const item of state.activeItems) {
    const group = document.createElement("section");
    group.className = "flow-item";
    const heading = document.createElement("div");
    heading.className = "flow-item-title";
    heading.textContent = item.title;
    group.append(heading);

    for (const step of steps) {
      const key = stepKey(item.id, step.id);
      const status = state.stepStatus.get(key) || "pending";
      const row = document.createElement("article");
      row.className = `flow-step ${status}`;
      row.dataset.stepId = step.id;
      row.dataset.itemId = item.id;

    const light = document.createElement("span");
    light.className = `step-light step-signal ${status}`;
    light.setAttribute("aria-hidden", "true");

      const index = document.createElement("span");
      index.className = "step-index";
      index.textContent = String(step.order || group.querySelectorAll(".flow-step").length + 1).padStart(2, "0");

    const content = document.createElement("div");
    content.className = "step-copy";
    const title = document.createElement("strong");
    title.textContent = step.label;
    const meta = document.createElement("small");
    meta.textContent = `${step.skill} · ${statusText[status] || statusText.pending}`;
    content.append(title, meta);

    const badge = document.createElement("span");
    badge.className = "step-badge";
    badge.textContent = statusText[status] || statusText.pending;

      const repair = document.createElement("button");
      repair.className = "repair-step repair-btn";
      repair.type = "button";
      repair.textContent = "修复";
      repair.dataset.stepId = step.id;
      repair.hidden = !step.repairable || state.activeItems.length > 1;
      repair.disabled = !canRepairStep(step, status);
      repair.addEventListener("click", event => {
        flashButton(event.currentTarget);
        repairStep(step.id);
      });

      row.append(light, index, content, badge, repair);
      group.append(row);
    }

    el.flowSteps.append(group);
  }

  updateFlowSummary();
}

function updateStep(stepId, status, itemId = "item-1") {
  const key = stepKey(itemId, stepId);
  if (!state.stepStatus.has(key)) return;
  state.stepStatus.set(key, status);
  const row = el.flowSteps.querySelector(`[data-item-id="${cssEscape(itemId)}"][data-step-id="${cssEscape(stepId)}"]`);
  if (!row) return renderFlowSteps();
  row.className = `flow-step ${status}`;
  const light = row.querySelector(".step-light");
  light.className = `step-light step-signal ${status}`;
  const step = getCurrentSteps().find(item => item.id === stepId);
  row.querySelector("small").textContent = `${step.skill} · ${statusText[status] || statusText.pending}`;
  row.querySelector(".step-badge").textContent = statusText[status] || statusText.pending;
  row.querySelector(".repair-step").disabled = !canRepairStep(step, status);
  updateFlowSummary();
}

function updateFlowSummary() {
  const steps = getCurrentSteps();
  const keys = state.activeItems.flatMap(item => steps.map(step => stepKey(item.id, step.id)));
  const done = keys.filter(key => state.stepStatus.get(key) === "done").length;
  const failed = keys.filter(key => state.stepStatus.get(key) === "failed").length;
  const running = keys.some(key => state.stepStatus.get(key) === "running");
  if (!steps.length) return;
  if (running) {
    el.flowSummary.textContent = `正在执行 ${done}/${keys.length}`;
  } else if (failed) {
    el.flowSummary.textContent = `${failed} 个步骤需要修复`;
  } else {
    el.flowSummary.textContent = `已完成 ${done}/${keys.length}`;
  }
}

function updateRepairButtons() {
  el.flowSteps.querySelectorAll(".repair-step").forEach(btn => {
    const itemId = btn.closest(".flow-step")?.dataset.itemId || "item-1";
    const status = state.stepStatus.get(stepKey(itemId, btn.dataset.stepId));
    const step = getCurrentSteps().find(item => item.id === btn.dataset.stepId);
    btn.disabled = !canRepairStep(step, status);
  });
}

function canRepairStep(step, status) {
  return Boolean(step?.repairable) && !state.running && status === "failed" && state.activeItems.length === 1;
}

function renderHistory(history, stats) {
  el.historyList.innerHTML = "";
  renderHistoryStats(stats);
  if (!history.length) {
    el.historyList.textContent = "暂无使用记录";
    return;
  }
  for (const item of history.slice(0, 10)) {
    const row = document.createElement("div");
    row.className = `history-item ${item.status}`;
    const title = document.createElement("strong");
    title.textContent = `${modeTitles[item.mode] || item.title} · ${item.itemCount || 1} 项`;
    const meta = document.createElement("small");
    meta.textContent = `${historyStatus(item.status)} · ${formatTime(item.createdAt)} · ${formatDuration(item.durationMs)}`;
    const preview = document.createElement("span");
    preview.textContent = item.messagePreview || "无摘要";
    row.append(title, meta, preview);
    const urls = item.resultUrls || [];
    if (urls.length) {
      const links = document.createElement("div");
      links.className = "history-links";
      for (const result of urls.slice(0, 4)) {
        const link = document.createElement("a");
        link.href = result.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = result.itemTitle || "查看项目";
        links.append(link);
      }
      row.append(links);
    }
    const actions = document.createElement("div");
    actions.className = "history-actions";
    const detail = document.createElement("button");
    detail.className = "mini-btn";
    detail.type = "button";
    detail.textContent = "详情";
    detail.addEventListener("click", () => showHistoryDetail(item.runId));
    const retry = document.createElement("button");
    retry.className = "mini-btn";
    retry.type = "button";
    retry.textContent = "重跑";
    retry.addEventListener("click", () => retryHistory(item));
    actions.append(detail, retry);
    row.append(actions);
    el.historyList.append(row);
  }
}

function renderHistoryStats(stats) {
  if (!stats) {
    el.historyStats.textContent = "暂无统计";
    return;
  }
  el.historyStats.textContent = `今日 ${stats.todayRuns || 0} · 共 ${stats.total} 次 · 成功 ${stats.success} · 异常 ${stats.failed} · 中止 ${stats.aborted || 0} · 成功率 ${stats.successRate ?? "--"}% · 平均 ${formatDuration(stats.averageDurationMs)}`;
}

async function showHistoryDetail(runId) {
  try {
    const res = await fetch(`/api/history/detail?runId=${encodeURIComponent(runId)}`);
    if (res.status === 401) return setUser(null);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "详情读取失败");
    const item = data.item;
    el.detailPanel.hidden = false;
    const errors = (item.errorMessages || []).map(error => error.message).join("；") || "无";
    const urls = (item.resultUrls || []).map(result => result.url).join("\n") || "无";
    el.detailBody.textContent = [
      `${historyStatus(item.status)} · ${formatDuration(item.durationMs)} · ${item.itemCount || 1} 项`,
      `错误：${errors}`,
      `链接：${urls}`,
      `输入：${item.messageText || item.messagePreview || ""}`
    ].join("\n");
  } catch (err) {
    el.runState.textContent = err.message;
  }
}

function retryHistory(item) {
  setMode(item.mode || state.mode);
  el.message.value = item.messageText || "";
  el.projectUrl.value = item.projectUrl || "";
  state.preview = null;
  state.previewConfirmed = false;
  el.previewPanel.hidden = true;
  el.runState.textContent = "已载入历史任务，可重新解析或启动";
  el.message.focus();
}

function clearResults() {
  currentResults().clear();
  renderResults();
}

function updateResult(event) {
  const itemId = event.itemId || "item-1";
  const results = state.resultsByMode[state.runMode] || currentResults();
  const existing = results.get(itemId) || { itemTitle: event.itemTitle || itemId };
  if (event.type === "result") {
    existing.url = event.url;
  } else if (event.type === "run_error") {
    existing.error = event.message;
  }
  existing.itemTitle = event.itemTitle || existing.itemTitle;
  results.set(itemId, existing);
  if (state.runMode === state.mode) renderResults();
}

function renderResults() {
  const results = currentResults();
  el.resultPanel.hidden = results.size === 0;
  el.resultList.innerHTML = "";
  for (const result of results.values()) {
    const row = document.createElement("div");
    row.className = `result-item ${result.error ? "failed" : "success"}`;
    const title = document.createElement("strong");
    title.textContent = result.itemTitle;
    row.append(title);
    if (result.url) {
      const link = document.createElement("a");
      link.href = result.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "查看项目";
      row.append(link);
    }
    if (result.error) {
      const error = document.createElement("span");
      error.textContent = result.error;
      row.append(error);
    }
    el.resultList.append(row);
  }
}

function currentResults() {
  return state.resultsByMode[state.mode] || state.resultsByMode.create;
}

async function previewTask() {
  const message = el.message.value.trim();
  const projectUrl = el.projectUrl.value.trim();
  if (!message) {
    el.runState.textContent = "请输入任务内容";
    el.message.focus();
    return null;
  }
  try {
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.mode, message, projectUrl })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "解析预览失败");
    state.preview = data.preview;
    state.previewConfirmed = false;
    renderPreview(data.preview, data.validationError);
    if (data.preview.suggestedMode !== state.mode) {
      el.runState.textContent = `内容更像${data.preview.suggestedMode === "change" ? "变更" : "创建"}任务，请确认任务类型`;
    } else {
      el.runState.textContent = data.validationError || `已识别 ${data.preview.itemCount} 个项目`;
    }
    return data;
  } catch (err) {
    el.runState.textContent = err.message;
    return null;
  }
}

function renderPreview(preview, validationError = "") {
  el.previewPanel.hidden = false;
  const warnings = [...(preview.warnings || [])];
  if (validationError) warnings.unshift(validationError);
  el.previewSummary.textContent = `${modeTitles[preview.mode]} · 识别 ${preview.itemCount} 项${preview.requiresConfirmation ? " · 需要确认" : ""}${warnings.length ? ` · ${warnings.join("；")}` : ""}`;
  el.previewList.innerHTML = "";
  for (const item of preview.items.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "preview-item";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const fields = document.createElement("small");
    fields.textContent = Object.entries(item.fields || {})
      .filter(([, value]) => value)
      .map(([key, value]) => `${fieldLabel(key)}：${value}`)
      .join(" · ") || "未提取到关键字段";
    row.append(title, fields);
    el.previewList.append(row);
  }
}

async function runTask(options = {}) {
  if (state.running) return;
  const aiTest = Boolean(options.aiTest);
  const message = el.message.value.trim();
  const projectUrl = el.projectUrl.value.trim();
  if (!message) {
    el.runState.textContent = "请输入任务内容";
    el.message.focus();
    return;
  }
  const validationError = validateMessage(message, projectUrl);
  if (validationError) {
    el.runState.textContent = validationError;
    el.message.focus();
    return;
  }
  const previewData = state.preview && state.preview.mode === state.mode ? { preview: state.preview } : await previewTask();
  if (!previewData) return;
  const needsConfirm =
    previewData.preview.requiresConfirmation ||
    previewData.preview.suggestedMode !== state.mode ||
    (previewData.preview.warnings || []).length > 0;
  if (needsConfirm && !state.previewConfirmed) {
    state.previewConfirmed = true;
    el.runState.textContent = "请确认解析预览无误后再次点击启动";
    return;
  }

  resetFlowStatuses();
  renderFlowSteps();
  clearResults();
  state.runMode = state.mode;
  state.abortController = new AbortController();
  state.abortRequested = false;
  el.runId.textContent = aiTest ? "准备 AI 测试" : "准备启动";
  setRunning(true);
  if (aiTest) el.runState.textContent = "AI测试创建会给项目名追加（AI测试）";

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.mode, message, projectUrl, aiTest, confirmed: state.previewConfirmed }),
      signal: state.abortController.signal
    });
    await consumeNdjson(res, { source: "run" });
  } catch (err) {
    el.runState.textContent = state.abortRequested ? "已中止生成" : err.message;
  } finally {
    setRunning(false);
    state.previewConfirmed = false;
    loadHistory(state.runMode);
    loadAuditLogs();
  }
}

async function repairStep(stepId) {
  if (state.running) return;
  const currentStatus = state.stepStatus.get(stepKey("item-1", stepId));
  const step = getCurrentSteps().find(item => item.id === stepId);
  if (!canRepairStep(step, currentStatus)) {
    el.runState.textContent = "只有执行失败的步骤才需要修复";
    return;
  }
  const message = el.message.value.trim();
  const projectUrl = el.projectUrl.value.trim();
  if (!message) {
    el.runState.textContent = "请保留原任务内容后再修复";
    el.message.focus();
    return;
  }
  const validationError = validateMessage(message, projectUrl);
  if (validationError) {
    el.runState.textContent = validationError;
    el.message.focus();
    return;
  }

  updateStep(stepId, "running");
  state.runMode = state.mode;
  state.abortController = new AbortController();
  state.abortRequested = false;
  setRunning(true);
  try {
    const res = await fetch("/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.mode, message, projectUrl, stepId, continueAfterRepair: true, sourceRunId: state.lastRunId }),
      signal: state.abortController.signal
    });
    await consumeNdjson(res, { source: "repair" });
  } catch (err) {
    updateStep(stepId, "failed");
    el.runState.textContent = state.abortRequested ? "已中止生成" : err.message;
  } finally {
    setRunning(false);
    loadHistory(state.runMode);
  }
}

async function abortCurrentRun() {
  if (!state.running) return;
  state.abortRequested = true;
  el.abortBtn.disabled = true;
  el.runState.textContent = "正在中止生成";
  const runId = state.currentRunId || el.runId.textContent;
  if (runId && runId !== "准备启动" && runId !== "准备 AI 测试" && runId !== "未开始") {
    fetch("/api/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId })
    }).catch(() => {});
  }
  state.abortController?.abort();
}

async function consumeNdjson(res, context = {}) {
  if (res.status === 401) {
    setUser(null);
    throw new Error("登录已失效，请重新登录");
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({ error: "请求失败" }));
    throw new Error(data.error || `请求失败：${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      handleStreamEvent(JSON.parse(line), context);
    }
  }
}

function handleStreamEvent(event, context = {}) {
  if (event.type === "start") {
    el.runId.textContent = event.runId;
    state.currentRunId = event.runId;
    if (event.startedAt) {
      state.runStartedAt = Date.parse(event.startedAt);
      updateTimer();
    }
    if (event.items?.length) {
      state.activeItems = event.items;
      resetFlowStatuses();
      renderFlowSteps();
    }
    if (event.steps?.length === 1 && event.repairStepId) updateStep(event.repairStepId, "running");
  } else if (event.type === "step") {
    updateStep(event.stepId, event.status, event.itemId || "item-1");
  } else if (event.type === "log") {
    el.runState.textContent = event.message;
  } else if (event.type === "error") {
    el.runState.textContent = event.error;
  } else if (event.type === "result" || event.type === "run_error") {
    updateResult(event);
  } else if (event.type === "done") {
    state.lastRunId = state.currentRunId || state.lastRunId;
    state.failedStepIds = new Set();
    for (const stepId of event.failedSteps || []) updateCompositeStep(stepId, "failed");
    for (const stepId of event.missingSteps || []) {
      if (state.stepStatus.get(stepId) !== "done") updateCompositeStep(stepId, "failed");
    }
    [...(event.failedSteps || []), ...(event.missingSteps || [])].forEach(value => {
      state.failedStepIds.add(String(value).split(":").pop());
    });
    el.runState.textContent = event.code === 0
      ? context.source === "repair" ? "修复完成，后续步骤已继续执行" : "流程结束"
      : event.code === 130 ? "流程已中止" : "流程异常";
    updateFlowSummary();
    loadHistory(state.runMode);
  }
}

function updateCompositeStep(value, status) {
  const [itemId, stepId] = String(value).includes(":") ? String(value).split(":") : ["item-1", value];
  if (state.stepStatus.get(stepKey(itemId, stepId)) !== "done") updateStep(stepId, status, itemId);
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function validateMessage(message, projectUrl = "") {
  const urlText = `${message}\n${projectUrl}`;
  if (state.mode === "change" && !/https?:\/\/[^\s，。；;]+/i.test(urlText) && !hasChangeFields(message)) {
    return "项目变更请粘贴项目地址，或提供项目名称、原项目编号和新项目编号";
  }
  return "";
}

function resetPreviewState() {
  state.preview = null;
  state.previewConfirmed = false;
  el.previewPanel.hidden = true;
}

function maybeSuggestMode() {
  const text = el.message.value;
  if (!text.trim()) return;
  if (state.mode === "create" && /项目变更申请|原项目编号|新项目编号|变更类别/.test(text)) {
    el.runState.textContent = "检测到变更单内容，建议切换到变更视图";
  } else if (state.mode === "change" && /项目启动申请|启动类别|项目编号/.test(text) && !/原项目编号|新项目编号/.test(text)) {
    el.runState.textContent = "检测到创建单内容，建议切换到创建视图";
  }
}

function hasChangeFields(message) {
  if (/项目名称/.test(message) && /原项目编号/.test(message) && /新项目编号/.test(message)) return true;
  const names = sectionItems(message, "项目名称", ["原项目编号", "新项目编号"]);
  const originalCodes = sectionItems(message, "原项目编号", ["新项目编号"]);
  const newCodes = sectionItems(message, "新项目编号", ["阶段属性", "优先级", "客户要求日期"]);
  return Math.min(names.length, originalCodes.length, newCodes.length) > 1;
}

function sectionItems(text, startLabel, endLabels) {
  const start = text.indexOf(startLabel);
  if (start < 0) return [];
  const afterStart = text.slice(start + startLabel.length);
  const endPositions = endLabels.map(label => afterStart.indexOf(label)).filter(position => position >= 0);
  const section = afterStart.slice(0, endPositions.length ? Math.min(...endPositions) : afterStart.length);
  return section.split(/[、。，\n]+/).map(item => item.trim()).filter(Boolean);
}

function stepKey(itemId, stepId) {
  return `${itemId || "item-1"}::${stepId}`;
}

function historyStatus(status) {
  return { running: "运行中", success: "成功", failed: "异常", aborted: "已中止" }[status] || status;
}

function auditAction(action) {
  return {
    run_codex: "启动任务",
    repair_codex_step: "修复步骤",
    abort_codex_run: "中止任务"
  }[action] || action;
}

function fieldLabel(key) {
  return {
    projectName: "项目",
    projectCode: "编号",
    oldCode: "原编号",
    newCode: "新编号",
    customer: "客户",
    engineer: "工程师",
    date: "日期"
  }[key] || key;
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function startTimer() {
  state.runStartedAt = Date.now();
  updateTimer();
  window.clearInterval(state.timerId);
  state.timerId = window.setInterval(updateTimer, 1000);
}

function stopTimer() {
  window.clearInterval(state.timerId);
  state.timerId = null;
  updateTimer();
}

function updateTimer() {
  if (!state.runStartedAt) {
    el.runTimer.textContent = "00:00";
    return;
  }
  el.runTimer.textContent = formatDuration(Date.now() - state.runStartedAt);
}

function formatDuration(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--:--";
  const totalSeconds = Math.max(0, Math.round(Number(value) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}:${String(restMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

document.querySelectorAll(".mode").forEach(btn => {
  btn.addEventListener("click", () => {
    flashButton(btn);
    setMode(btn.dataset.mode);
  });
});

el.loginBtn.addEventListener("click", event => {
  flashButton(event.currentTarget);
  login();
});
el.logoutBtn.addEventListener("click", event => {
  flashButton(event.currentTarget);
  logout();
});
el.loginKey.addEventListener("keydown", event => {
  if (event.key === "Enter") login();
});
el.rememberKey.addEventListener("change", () => {
  if (!el.rememberKey.checked) localStorage.removeItem(rememberKeyStorageKey);
});
el.extensionProjectBtn.addEventListener("click", event => {
  flashButton(event.currentTarget);
  openProjectView("extension");
});
el.rdProjectBtn.addEventListener("click", event => {
  flashButton(event.currentTarget);
  openProjectView("rd");
});
el.runBtn.addEventListener("click", event => {
  flashButton(event.currentTarget);
  runTask();
});
el.aiTestBtn.addEventListener("click", event => {
  flashButton(event.currentTarget);
  runTask({ aiTest: true });
});
el.abortBtn.addEventListener("click", event => {
  flashButton(event.currentTarget);
  abortCurrentRun();
});
el.clearBtn.addEventListener("click", event => {
  flashButton(event.currentTarget);
  el.message.value = "";
  el.projectUrl.value = "";
  clearResults();
  resetFlowStatuses();
  renderFlowSteps();
  el.runId.textContent = "未开始";
  el.runState.textContent = "等待输入";
  resetPreviewState();
});

el.previewBtn.addEventListener("click", event => {
  flashButton(event.currentTarget);
  previewTask();
});

el.message.addEventListener("input", () => {
  resetPreviewState();
  maybeSuggestMode();
});

el.projectUrl.addEventListener("input", resetPreviewState);

el.message.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    runTask();
  }
});

setMode("create");
loadRememberedKey();
checkHealth();
checkSession();
