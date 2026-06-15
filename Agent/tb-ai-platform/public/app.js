const state = {
  mode: "create",
  running: false,
  user: null,
  flows: {},
  stepStatus: new Map()
};

const modeTitles = {
  create: "创建钉钉 TB 项目",
  change: "创建项目变更迭代"
};

const modePlaceholders = {
  create: "粘贴项目创建信息单，例如项目名称、项目编号、客户、项目工程师、售前/发起人、客户要求日期等。",
  change: "粘贴项目变更信息单，并附上对应项目地址，例如 https://www.teambition.com/project/xxx/tasks/view/xxx"
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
  if (loggedIn) loadFlows();
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
  el.flowSteps.innerHTML = "";
  el.flowSummary.textContent = "等待登录";
  el.runId.textContent = "未开始";
  el.runState.textContent = "等待输入";
}

function resetFlowStatuses() {
  state.stepStatus.clear();
  getCurrentSteps().forEach(step => state.stepStatus.set(step.id, "pending"));
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

  for (const step of steps) {
    const status = state.stepStatus.get(step.id) || "pending";
    const row = document.createElement("article");
    row.className = `flow-step ${status}`;
    row.dataset.stepId = step.id;

    const light = document.createElement("span");
    light.className = `step-light step-signal ${status}`;
    light.setAttribute("aria-hidden", "true");

    const index = document.createElement("span");
    index.className = "step-index";
    index.textContent = String(step.order || el.flowSteps.children.length + 1).padStart(2, "0");

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
    repair.hidden = !step.repairable;
    repair.disabled = state.running || status === "done";
    repair.addEventListener("click", () => repairStep(step.id));

    row.append(light, index, content, badge, repair);
    el.flowSteps.append(row);
  }

  updateFlowSummary();
}

function updateStep(stepId, status) {
  if (!state.stepStatus.has(stepId)) return;
  state.stepStatus.set(stepId, status);
  const row = el.flowSteps.querySelector(`[data-step-id="${cssEscape(stepId)}"]`);
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
  const done = steps.filter(step => state.stepStatus.get(step.id) === "done").length;
  const failed = steps.filter(step => state.stepStatus.get(step.id) === "failed").length;
  const running = steps.some(step => state.stepStatus.get(step.id) === "running");
  if (!steps.length) return;
  if (running) {
    el.flowSummary.textContent = `正在执行 ${done}/${steps.length}`;
  } else if (failed) {
    el.flowSummary.textContent = `${failed} 个步骤需要修复`;
  } else {
    el.flowSummary.textContent = `已完成 ${done}/${steps.length}`;
  }
}

function updateRepairButtons() {
  el.flowSteps.querySelectorAll(".repair-step").forEach(btn => {
    const status = state.stepStatus.get(btn.dataset.stepId);
    btn.disabled = state.running || status === "done";
  });
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
    if (event.steps?.length === 1 && event.repairStepId) updateStep(event.repairStepId, "running");
  } else if (event.type === "step") {
    updateStep(event.stepId, event.status);
  } else if (event.type === "log") {
    el.runState.textContent = event.message;
  } else if (event.type === "error") {
    el.runState.textContent = event.error;
  } else if (event.type === "done") {
    for (const stepId of event.failedSteps || []) updateStep(stepId, "failed");
    for (const stepId of event.missingSteps || []) {
      if (state.stepStatus.get(stepId) !== "done") updateStep(stepId, "failed");
    }
    el.runState.textContent = event.code === 0 ? "流程结束" : "流程异常";
    updateFlowSummary();
  }
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function validateMessage(message) {
  if (state.mode === "change" && !/https?:\/\/[^\s，。；;]+/i.test(message)) {
    return "项目变更必须粘贴对应的项目地址";
  }
  return "";
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
