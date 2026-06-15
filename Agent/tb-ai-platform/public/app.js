const state = {
  mode: "create",
  running: false,
  user: null
};

const modeTitles = {
  create: "创建钉钉 TB 项目",
  change: "创建项目变更迭代"
};

const modePlaceholders = {
  create: "例如：在刘虹谊的审批里查项目启动申请，项目号 60411，确认后创建到本月低压户储项目集。",
  change: "例如：根据项目变更申请，原项目编号 P15S100A，新的 PLM 编号为 XXX，在原项目内创建变更迭代。"
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
  output: document.querySelector("#output"),
  runState: document.querySelector("#runState"),
  runId: document.querySelector("#runId"),
  workspace: document.querySelector("#workspace")
};

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  el.modeTitle.textContent = modeTitles[mode];
  el.message.placeholder = modePlaceholders[mode];
}

function setUser(user) {
  state.user = user;
  const loggedIn = Boolean(user);
  el.loginPanel.hidden = loggedIn;
  el.workspace.hidden = !loggedIn;
  el.accountCard.hidden = !loggedIn;
  el.accountName.textContent = user ? user.fullName || `CCH 用户 ${user.cchUserId}` : "未登录";
  if (!loggedIn) el.loginKey.focus();
}

function appendOutput(text, kind = "stdout") {
  const prefix = kind === "stderr" ? "\n[系统]\n" : "";
  el.output.textContent += prefix + text;
  el.output.scrollTop = el.output.scrollHeight;
}

function setRunning(running) {
  state.running = running;
  el.runBtn.disabled = running;
  el.runBtn.querySelector("span").textContent = running ? "运行中" : "启动 Codex";
  el.runState.textContent = running ? "Codex 正在处理" : "等待输入";
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
  el.output.textContent = "";
  el.runId.textContent = "未开始";
  el.runState.textContent = "等待输入";
}

async function runTask() {
  if (state.running) return;
  const message = el.message.value.trim();
  if (!message) {
    el.runState.textContent = "请先填写任务内容";
    el.message.focus();
    return;
  }

  el.output.textContent = "";
  el.runId.textContent = "准备启动";
  setRunning(true);

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode: state.mode, message })
    });

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
        const event = JSON.parse(line);
        if (event.type === "start") {
          el.runId.textContent = event.runId;
          appendOutput(`任务已启动：${event.title}\n\n`);
        } else if (event.type === "stdout" || event.type === "stderr") {
          appendOutput(event.data, event.type);
        } else if (event.type === "error") {
          appendOutput(`\n错误：${event.error}\n`, "stderr");
        } else if (event.type === "done") {
          appendOutput(`\n\n任务结束，退出码：${event.code}\n`);
          el.runState.textContent = event.code === 0 ? "处理完成" : "处理异常";
        }
      }
    }
  } catch (err) {
    appendOutput(`错误：${err.message}\n`, "stderr");
    el.runState.textContent = "请求失败";
  } finally {
    setRunning(false);
  }
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
  el.output.textContent = "";
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
