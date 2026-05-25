const POLL_INTERVAL_MS = 2500;

const state = {
  currentTaskId: null,
  pollTimer: null,
  eventSource: null,
  currentUser: null,
};

const elements = {
  form: document.querySelector("#task-form"),
  submitButton: document.querySelector("#submit-button"),
  formMessage: document.querySelector("#form-message"),
  serviceState: document.querySelector("#service-state"),
  currentUser: document.querySelector("#current-user"),
  logoutButton: document.querySelector("#logout-button"),
  currentSubtitle: document.querySelector("#current-subtitle"),
  taskStatus: document.querySelector("#task-status"),
  taskInput: document.querySelector("#task-input"),
  taskTimes: document.querySelector("#task-times"),
  taskError: document.querySelector("#task-error"),
  downloadLink: document.querySelector("#download-link"),
  previewSubtitle: document.querySelector("#preview-subtitle"),
  markdownPreview: document.querySelector("#markdown-preview"),
  recentList: document.querySelector("#recent-list"),
};

if (elements.form && elements.logoutButton) {
  elements.form.addEventListener("submit", submitTask);
  elements.logoutButton.addEventListener("click", async () => {
    await fetch("/api/session", { method: "DELETE" });
    window.location.href = "/login";
  });
  initialize();
}

async function initialize() {
  const session = await loadSession();
  if (!session.authenticated) {
    if (window.location) {
      window.location.href = "/login";
    }
    return;
  }
  state.currentUser = session.user;
  elements.currentUser.textContent = `${session.user.name} ${session.user.phone}`;
  connectEvents();
  await loadRecentTasks();
}

async function loadSession() {
  const response = await fetch("/api/session");
  if (response.status === 401) {
    return { authenticated: false };
  }
  return readJson(response);
}

function connectEvents() {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = new EventSource("/api/events");
  state.eventSource.addEventListener("task_created", refreshFromEvent);
  state.eventSource.addEventListener("task_updated", refreshFromEvent);
  state.eventSource.addEventListener("open", () => loadRecentTasks());
}

async function refreshFromEvent(event) {
  const data = JSON.parse(event.data || "{}");
  await loadRecentTasks();
  if (data.task_id && (!state.currentTaskId || state.currentTaskId === data.task_id)) {
    await loadTask(data.task_id);
  }
}

async function submitTask(event) {
  event.preventDefault();
  setFormMessage("正在提交...", false);
  elements.submitButton.disabled = true;

  const formData = new FormData(elements.form);
  const payload = {
    svn_url: String(formData.get("svn_url") || "").trim(),
    old_revision: String(formData.get("old_revision") || "").trim(),
    new_revision: String(formData.get("new_revision") || "").trim(),
    requester: "",
  };

  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(apiErrorMessage(body, "提交失败"));
    }

    setFormMessage(`任务已提交：${body.task_id}`, false);
    elements.form.reset();
    await loadTask(body.task_id);
    await loadRecentTasks();
  } catch (error) {
    setFormMessage(error.message, true);
  } finally {
    elements.submitButton.disabled = false;
  }
}

async function loadRecentTasks() {
  try {
    const response = await fetch("/api/tasks");
    const tasks = await readJson(response);
    if (!response.ok) {
      throw new Error(apiErrorMessage(tasks, "最近任务加载失败"));
    }
    renderRecentTasks(tasks);
    setServiceState("Ready");
  } catch (error) {
    elements.recentList.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    setServiceState("API error");
  }
}

async function loadTask(taskId) {
  state.currentTaskId = taskId;
  stopPolling();

  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (state.currentTaskId !== taskId) {
      return;
    }
    const task = await readJson(response);
    if (state.currentTaskId !== taskId) {
      return;
    }
    if (!response.ok) {
      throw new Error(apiErrorMessage(task, "任务加载失败"));
    }
    if (state.currentTaskId !== taskId) {
      return;
    }

    renderTask(task);
    if (task.status === "pending" || task.status === "running") {
      state.pollTimer = window.setTimeout(() => loadTask(taskId), POLL_INTERVAL_MS);
    } else if (task.status === "success" && task.report_available) {
      await loadReport(task.task_id);
    } else if (task.status === "success") {
      elements.previewSubtitle.textContent = "任务成功，但报告文件尚不可用。";
    }
  } catch (error) {
    if (state.currentTaskId !== taskId) {
      return;
    }
    elements.currentSubtitle.textContent = error.message;
    setServiceState("API error");
  }
}

async function loadReport(taskId) {
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/report`);
    if (state.currentTaskId !== taskId) {
      return;
    }
    const text = await response.text();
    if (state.currentTaskId !== taskId) {
      return;
    }
    if (!response.ok) {
      throw new Error(text || "报告加载失败");
    }
    if (state.currentTaskId !== taskId) {
      return;
    }

    elements.previewSubtitle.textContent = `报告已加载：${taskId}`;
    elements.markdownPreview.innerHTML = renderMarkdown(text);
    enableDownloadLink(taskId);
  } catch (error) {
    if (state.currentTaskId !== taskId) {
      return;
    }
    elements.previewSubtitle.textContent = error.message;
  }
}

function renderTask(task) {
  setServiceState(task.status);
  elements.currentSubtitle.textContent = task.task_id;
  elements.taskStatus.textContent = task.status;
  elements.taskStatus.className = `status-pill is-${task.status}`;
  elements.taskInput.textContent = [
    task.svn_url,
    `${task.old_revision} -> ${task.new_revision}`,
    `requester: ${task.requester}`,
  ].join(" | ");
  elements.taskTimes.textContent = formatTimes(task);
  elements.taskError.textContent = task.error_message || "-";

  disableDownloadLink();

  if (task.status !== "success") {
    elements.previewSubtitle.textContent = "任务完成并生成报告后，将在这里展示 Markdown 内容。";
    elements.markdownPreview.innerHTML = '<p class="empty-state">当前任务暂无可预览报告。</p>';
  }
}

function renderRecentTasks(tasks) {
  if (!tasks.length) {
    elements.recentList.innerHTML = '<p class="empty-state">暂无任务记录。</p>';
    return;
  }

  elements.recentList.innerHTML = tasks.map((task) => `
    <button class="task-item" type="button" data-task-id="${escapeAttribute(task.task_id)}">
      <span class="task-item-topline">
        <strong>${escapeHtml(task.requester || "anonymous")}</strong>
        <span class="status-pill is-${escapeAttribute(task.status)}">${escapeHtml(task.status)}</span>
      </span>
      <span class="task-item-url">${escapeHtml(task.svn_url)}</span>
      <span class="task-item-revisions">${escapeHtml(task.old_revision)} -> ${escapeHtml(task.new_revision)}</span>
      <small>${escapeHtml(formatDate(task.created_at))}</small>
    </button>
  `).join("");

  elements.recentList.querySelectorAll("[data-task-id]").forEach((button) => {
    button.addEventListener("click", () => loadTask(button.dataset.taskId));
  });
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const languageClass = language ? ` class="language-${escapeAttribute(language)}"` : "";
      html.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      html.push(renderTable(tableLines));
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineMarkdown(escapeHtml(headingMatch[2].trim()))}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(escapeHtml(item))}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(escapeHtml(item))}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length
      && lines[index].trim()
      && !lines[index].trim().startsWith("```")
      && !isTableStart(lines, index)
      && !/^(#{1,6})\s+/.test(lines[index])
      && !/^\s*[-*_]{3,}\s*$/.test(lines[index])
      && !/^\s*[-*+]\s+/.test(lines[index])
      && !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${inlineMarkdown(escapeHtml(paragraph.join("\n"))).replace(/\n/g, "<br>")}</p>`);
  }

  return html.join("");
}

function inlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function isTableStart(lines, index) {
  return isTableRow(lines[index]) && index + 1 < lines.length && isTableDivider(lines[index + 1]);
}

function isTableRow(line) {
  return /^\s*\|.+\|\s*$/.test(line || "");
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || "");
}

function splitTableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderTable(lines) {
  const headers = splitTableCells(lines[0]);
  const rows = lines.slice(2).map(splitTableCells);
  return [
    "<table>",
    `<thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(escapeHtml(cell))}</th>`).join("")}</tr></thead>`,
    `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(escapeHtml(cell))}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "</table>",
  ].join("");
}

function formatTimes(task) {
  return [
    `created: ${formatDate(task.created_at)}`,
    `started: ${formatDate(task.started_at)}`,
    `finished: ${formatDate(task.finished_at)}`,
  ].join(" | ");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function setFormMessage(message, isError) {
  elements.formMessage.textContent = message;
  elements.formMessage.classList.toggle("is-error", isError);
}

function setServiceState(message) {
  elements.serviceState.textContent = message;
}

function enableDownloadLink(taskId) {
  elements.downloadLink.href = `/api/tasks/${encodeURIComponent(taskId)}/download`;
  elements.downloadLink.classList.remove("is-disabled");
  elements.downloadLink.removeAttribute("tabindex");
  elements.downloadLink.setAttribute("aria-disabled", "false");
}

function disableDownloadLink() {
  elements.downloadLink.removeAttribute("href");
  elements.downloadLink.classList.add("is-disabled");
  elements.downloadLink.setAttribute("tabindex", "-1");
  elements.downloadLink.setAttribute("aria-disabled", "true");
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function apiErrorMessage(body, fallback) {
  if (body && typeof body.detail === "string") {
    return body.detail;
  }
  return fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
