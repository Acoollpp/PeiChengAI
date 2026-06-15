const state = {
  mode: "create",
  running: false,
  user: null,
  flows: {},
  stepStatus: new Map(),
  activeItems: [{ id: "item-1", title: "项目 1" }]
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

const el = {
  accountCard: document.querySelector("#accountCard"),
  accountName: document.querySelector("#accountName"),
  healthText: document.querySelector("#healthText"),
  loginBtn: document.querySelector("#loginBtn"),
  loginKey: document.querySelector("#loginKeyInput"),
  loginPanel: document.querySelector("#loginPanel"),
  loginState: document.querySelector("#loginState"),
  historyList: document.querySelector("#historyList"),
  logoutBtn: document.querySelector("#logoutBtn"),
  modeTitle: document.querySelector("#modeTitle"),
  message: document.querySelector("#messageInput"),
  pulse: document.querySelector(".pulse"),
  runBtn: document.querySelector("#runBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  runState: document.querySelector("#runState"),
  runId: document.querySelector("#runId"),
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
  resetFlowStatuses();
  renderFlowSteps();
}

function setUser(user) {
  state.user = user;
  const loggedIn = Boolean(user);
  el.loginPanel.hidden = loggedIn;
  el.workspace.hidden = !loggedIn;
  el.accountCard.hidden = !loggedIn;
  el.accountName.textContent = user ? user.fullName || `CCH 用户 ${user.cchUserId}` : "未登录";
  if (loggedIn) {
    loadFlows();
    loadHistory();
  }
  if (!loggedIn) el.loginKey.focus();
}

function setRunning(running) {
  state.running = running;
  el.runBtn.disabled = running;
  el.runBtn.querySelector("span").textContent = running ? "运行中" : "启动流程";
  el.runState.textContent = running ? "Codex 正在按 skill 流程处理" : "等待输入";
  updateRepairButtons();
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

async function loadHistory() {
  try {
    const res = await fetch("/api/history");
    if (res.status === 401) return setUser(null);
    if (!res.ok) throw new Error("历史读取失败");
    const data = await res.json();
    renderHistory(data.history || []);
  } catch (err) {
    el.historyList.textContent = err.message;
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
    el.loginKey.value = "";
    el.loginState.textContent = "登录成功";
    setUser(data.user);
  } catch (err) {
    el.loginState.textContent = err.message;
  } finally {
    el.loginBtn.disabled = false;
  }
}

async function logout() {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  setUser(null);
  state.flows = {};
  state.stepStatus.clear();
  state.activeItems = [{ id: "item-1", title: "项目 1" }];
  el.flowSteps.innerHTML = "";
  el.flowSummary.textContent = "等待登录";
  el.historyList.textContent = "等待登录";
  el.runId.textContent = "未开始";
  el.runState.textContent = "等待输入";
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
      repair.disabled = state.running || status === "done";
      repair.addEventListener("click", () => repairStep(step.id));

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
  row.querySelector(".repair-step").disabled = state.running || status === "done";
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
    btn.disabled = state.running || status === "done";
  });
}

function renderHistory(history) {
  el.historyList.innerHTML = "";
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
    meta.textContent = `${historyStatus(item.status)} · ${formatTime(item.createdAt)}`;
    const preview = document.createElement("span");
    preview.textContent = item.messagePreview || "无摘要";
    row.append(title, meta, preview);
    el.historyList.append(row);
  }
}

async function runTask() {
  if (state.running) return;
  const message = el.message.value.trim();
  if (!message) {
    el.runState.textContent = "请先填写任务内容";
    el.message.focus();
    return;
  }
  const validationError = validateMessage(message);
  if (validationError) {
    el.runState.textContent = validationError;
    el.message.focus();
    return;
  }

  resetFlowStatuses();
  renderFlowSteps();
  el.runId.textContent = "准备启动";
  setRunning(true);

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.mode, message })
    });
    await consumeNdjson(res);
  } catch (err) {
    el.runState.textContent = err.message;
  } finally {
    setRunning(false);
  }
}

async function repairStep(stepId) {
  if (state.running) return;
  const message = el.message.value.trim();
  if (!message) {
    el.runState.textContent = "请保留原任务内容后再修复";
    el.message.focus();
    return;
  }
  const validationError = validateMessage(message);
  if (validationError) {
    el.runState.textContent = validationError;
    el.message.focus();
    return;
  }

  updateStep(stepId, "running");
  setRunning(true);
  try {
    const res = await fetch("/api/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.mode, message, stepId })
    });
    await consumeNdjson(res);
  } catch (err) {
    updateStep(stepId, "failed");
    el.runState.textContent = err.message;
  } finally {
    setRunning(false);
  }
}

async function consumeNdjson(res) {
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
      handleStreamEvent(JSON.parse(line));
    }
  }
}

function handleStreamEvent(event) {
  if (event.type === "start") {
    el.runId.textContent = event.runId;
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
  } else if (event.type === "done") {
    for (const stepId of event.failedSteps || []) updateCompositeStep(stepId, "failed");
    for (const stepId of event.missingSteps || []) {
      if (state.stepStatus.get(stepId) !== "done") updateCompositeStep(stepId, "failed");
    }
    el.runState.textContent = event.code === 0 ? "流程结束" : "流程异常";
    updateFlowSummary();
    loadHistory();
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

function validateMessage(message) {
  if (state.mode === "change" && !/https?:\/\/[^\s，。；;]+/i.test(message) && !hasChangeFields(message)) {
    return "项目变更请粘贴项目地址，或提供项目名称、原项目编号和新项目编号";
  }
  return "";
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
  return { running: "运行中", success: "成功", failed: "异常" }[status] || status;
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

document.querySelectorAll(".mode").forEach(btn => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

el.loginBtn.addEventListener("click", login);
el.logoutBtn.addEventListener("click", logout);
el.loginKey.addEventListener("keydown", event => {
  if (event.key === "Enter") login();
});
el.runBtn.addEventListener("click", runTask);
el.clearBtn.addEventListener("click", () => {
  el.message.value = "";
  resetFlowStatuses();
  renderFlowSteps();
  el.runId.textContent = "未开始";
  el.runState.textContent = "等待输入";
});

el.message.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    runTask();
  }
});

setMode("create");
checkHealth();
checkSession();
