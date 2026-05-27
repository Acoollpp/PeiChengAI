const adminState = {
  users: [],
  repositories: [],
  selectedUserId: null,
  selectedRepositoryKeys: new Set(),
};

const adminElements = {
  gate: document.querySelector("#admin-gate"),
  dashboard: document.querySelector("#admin-dashboard"),
  serviceState: document.querySelector("#admin-service-state"),
  currentUser: document.querySelector("#admin-current-user"),
  logoutButton: document.querySelector("#admin-logout-button"),
  refreshButton: document.querySelector("#admin-refresh-button"),
  userForm: document.querySelector("#admin-user-form"),
  userFormMessage: document.querySelector("#admin-user-form-message"),
  createUserButton: document.querySelector("#create-user-button"),
  usersTable: document.querySelector("#admin-users-table"),
  recentTasksTable: document.querySelector("#recent-tasks-table"),
  repositoryPermissions: document.querySelector("#repository-permissions"),
  repositoryPermissionTitle: document.querySelector("#repository-permission-title"),
  repositoryPermissionMessage: document.querySelector("#repository-permission-message"),
  saveRepositoriesButton: document.querySelector("#save-repositories-button"),
  userUsageChart: document.querySelector("#user-usage-chart"),
  statusChart: document.querySelector("#status-chart"),
  repositoryUsageChart: document.querySelector("#repository-usage-chart"),
  metrics: {
    userTotal: document.querySelector("#metric-user-total"),
    activeUserTotal: document.querySelector("#metric-active-user-total"),
    adminTotal: document.querySelector("#metric-admin-total"),
    taskTotal: document.querySelector("#metric-task-total"),
    todayTaskTotal: document.querySelector("#metric-today-task-total"),
  },
};

if (adminElements.dashboard && adminElements.userForm) {
  adminElements.logoutButton.addEventListener("click", logout);
  adminElements.refreshButton.addEventListener("click", refreshAdminData);
  adminElements.userForm.addEventListener("submit", createUser);
  adminElements.saveRepositoriesButton.addEventListener("click", saveRepositoryPermissions);
  initializeAdmin();
}

async function initializeAdmin() {
  try {
    const session = await loadAdminSession();
    if (!session.authenticated || !session.user || !session.user.is_admin) {
      showNoPermission();
      return;
    }

    adminElements.currentUser.textContent = `${session.user.name} ${session.user.phone}`;
    adminElements.gate.classList.add("is-hidden");
    adminElements.dashboard.classList.remove("is-hidden");
    await refreshAdminData();
  } catch (error) {
    showNoPermission(error.message);
  }
}

async function loadAdminSession() {
  const response = await fetch("/api/session");
  return readJson(response);
}

async function loadDashboard() {
  const response = await fetch("/api/admin/dashboard");
  return parseJsonResponse(response, "dashboard failed");
}

async function loadUsers() {
  const response = await fetch("/api/admin/users");
  return parseJsonResponse(response, "users failed");
}

async function loadRepositories() {
  const response = await fetch("/api/repositories");
  return parseJsonResponse(response, "repositories failed");
}

function showNoPermission(message = "当前账号不是管理员") {
  adminElements.dashboard.classList.add("is-hidden");
  adminElements.gate.classList.remove("is-hidden");
  adminElements.currentUser.textContent = "无权限";
  setAdminState(message);
  window.setTimeout(() => {
    window.location.href = "/";
  }, 1600);
}

async function refreshAdminData() {
  setAdminState("Loading");
  try {
    const [dashboard, users, repositories] = await Promise.all([
      loadDashboard(),
      loadUsers(),
      loadRepositories(),
    ]);
    adminState.users = users;
    adminState.repositories = repositories;
    renderDashboard(dashboard);
    renderUsers(users);
    ensureSelectedUser(users);
    setAdminState("Ready");
  } catch (error) {
    setAdminState("API error");
    setUserMessage(error.message, true);
  }
}

function renderDashboard(dashboard) {
  adminElements.metrics.userTotal.textContent = dashboard.user_total ?? 0;
  adminElements.metrics.activeUserTotal.textContent = dashboard.active_user_total ?? 0;
  adminElements.metrics.adminTotal.textContent = dashboard.admin_total ?? 0;
  adminElements.metrics.taskTotal.textContent = dashboard.task_total ?? 0;
  adminElements.metrics.todayTaskTotal.textContent = dashboard.today_task_total ?? 0;

  renderUserUsageChart(dashboard.user_usage || []);
  renderStatusChart(dashboard.status_counts || {});
  renderRepositoryUsageChart(dashboard.repository_usage || []);
  renderRecentTasks(dashboard.recent_tasks || []);
}

function renderUserUsageChart(users) {
  const sortedUsers = [...users].sort((left, right) => right.task_count - left.task_count);
  renderBars(
    adminElements.userUsageChart,
    sortedUsers,
    (user) => `${user.name} ${user.phone}`,
    (user) => user.task_count,
    "暂无用户任务数据",
  );
}

function renderStatusChart(statusCounts) {
  const rows = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));
  renderBars(
    adminElements.statusChart,
    rows,
    (row) => statusLabel(row.status),
    (row) => row.count,
    "暂无状态数据",
  );
}

function renderRepositoryUsageChart(repositories) {
  renderBars(
    adminElements.repositoryUsageChart,
    repositories,
    (repository) => repository.repository_name || repository.repository_key || "未归类",
    (repository) => repository.task_count,
    "暂无仓库数据",
  );
}

function renderBars(container, rows, labelFor, valueFor, emptyText) {
  if (!rows.length) {
    container.innerHTML = `<p class="empty-state">${escapeHtml(emptyText)}</p>`;
    return;
  }

  const maxValue = Math.max(1, ...rows.map((row) => Number(valueFor(row)) || 0));
  container.innerHTML = rows.map((row) => {
    const value = Number(valueFor(row)) || 0;
    const width = Math.max(4, Math.round((value / maxValue) * 100));
    return `
      <div class="usage-row">
        <span class="usage-label">${escapeHtml(labelFor(row))}</span>
        <span class="usage-track"><span class="usage-bar" style="--bar-width: ${width}%"></span></span>
        <strong>${value}</strong>
      </div>
    `;
  }).join("");
}

function renderRecentTasks(tasks) {
  if (!tasks.length) {
    adminElements.recentTasksTable.innerHTML = '<tr><td colspan="5">暂无任务</td></tr>';
    return;
  }

  adminElements.recentTasksTable.innerHTML = tasks.map((task) => `
    <tr>
      <td>${escapeHtml(task.requester || "-")}</td>
      <td>${escapeHtml(task.repository_name || task.repository_key || "-")}</td>
      <td><span class="status-pill is-${escapeAttribute(task.status)}">${escapeHtml(statusLabel(task.status))}</span></td>
      <td>${escapeHtml(task.old_revision)} -> ${escapeHtml(task.new_revision)}</td>
      <td>${escapeHtml(formatDate(task.created_at))}</td>
    </tr>
  `).join("");
}

function renderUsers(users) {
  if (!users.length) {
    adminElements.usersTable.innerHTML = '<tr><td colspan="6">暂无用户</td></tr>';
    return;
  }

  adminElements.usersTable.innerHTML = users.map((user) => `
    <tr class="${user.user_id === adminState.selectedUserId ? "is-selected" : ""}" data-user-id="${escapeAttribute(user.user_id)}">
      <td>${escapeHtml(user.phone)}</td>
      <td><input class="compact-input" data-field="name" value="${escapeAttribute(user.name)}" aria-label="姓名"></td>
      <td><input data-field="is_admin" type="checkbox" ${user.is_admin ? "checked" : ""} aria-label="管理员"></td>
      <td><input data-field="is_active" type="checkbox" ${user.is_active ? "checked" : ""} aria-label="启用"></td>
      <td>${escapeHtml(user.task_count)}</td>
      <td>
        <div class="table-actions">
          <button class="secondary-button" type="button" data-action="save-user">保存</button>
          <button class="secondary-button" type="button" data-action="select-user">权限</button>
        </div>
      </td>
    </tr>
  `).join("");

  adminElements.usersTable.querySelectorAll("[data-action='save-user']").forEach((button) => {
    button.addEventListener("click", () => updateUser(button.closest("[data-user-id]")));
  });
  adminElements.usersTable.querySelectorAll("[data-action='select-user']").forEach((button) => {
    button.addEventListener("click", () => selectUser(button.closest("[data-user-id]").dataset.userId));
  });
}

async function createUser(event) {
  event.preventDefault();
  setUserMessage("正在创建...", false);
  adminElements.createUserButton.disabled = true;

  const formData = new FormData(adminElements.userForm);
  const payload = {
    phone: String(formData.get("phone") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    is_admin: Boolean(formData.get("is_admin")),
    is_active: Boolean(formData.get("is_active")),
  };

  try {
    await fetchJson("/api/admin/users", "创建账号失败", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    adminElements.userForm.reset();
    adminElements.userForm.querySelector("#new-user-active").checked = true;
    setUserMessage("账号已创建", false);
    await refreshAdminData();
  } catch (error) {
    setUserMessage(error.message, true);
  } finally {
    adminElements.createUserButton.disabled = false;
  }
}

async function updateUser(row) {
  const userId = row.dataset.userId;
  const payload = {
    name: row.querySelector("[data-field='name']").value.trim(),
    is_admin: row.querySelector("[data-field='is_admin']").checked,
    is_active: row.querySelector("[data-field='is_active']").checked,
  };

  try {
    await fetchJson(`/api/admin/users/${encodeURIComponent(userId)}`, "更新账号失败", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setUserMessage("账号已更新", false);
    await refreshAdminData();
  } catch (error) {
    setUserMessage(error.message, true);
  }
}

function ensureSelectedUser(users) {
  if (!users.length) {
    adminState.selectedUserId = null;
    renderRepositoryPermissions();
    return;
  }
  const stillExists = users.some((user) => user.user_id === adminState.selectedUserId);
  if (!stillExists) {
    adminState.selectedUserId = users[0].user_id;
  }
  selectUser(adminState.selectedUserId);
}

async function selectUser(userId) {
  adminState.selectedUserId = userId;
  renderUsers(adminState.users);
  const user = adminState.users.find((item) => item.user_id === userId);
  adminElements.repositoryPermissionTitle.textContent = user ? `${user.name} ${user.phone}` : "请选择用户";
  adminElements.repositoryPermissionMessage.textContent = "正在加载权限...";
  adminElements.saveRepositoriesButton.disabled = true;

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/repositories`);
    const permissions = await parseJsonResponse(response, "permissions failed");
    adminState.selectedRepositoryKeys = new Set(permissions.repository_keys || []);
    renderRepositoryPermissions();
    adminElements.repositoryPermissionMessage.textContent = "";
    adminElements.saveRepositoriesButton.disabled = false;
  } catch (error) {
    adminElements.repositoryPermissionMessage.textContent = error.message;
  }
}

function renderRepositoryPermissions() {
  if (!adminState.selectedUserId) {
    adminElements.repositoryPermissions.innerHTML = '<p class="empty-state">请选择用户</p>';
    adminElements.saveRepositoriesButton.disabled = true;
    return;
  }
  if (!adminState.repositories.length) {
    adminElements.repositoryPermissions.innerHTML = '<p class="empty-state">暂无可配置仓库</p>';
    return;
  }

  adminElements.repositoryPermissions.innerHTML = adminState.repositories.map((repository) => `
    <label class="repository-permission-item">
      <input type="checkbox" value="${escapeAttribute(repository.key)}"
        ${adminState.selectedRepositoryKeys.has(repository.key) ? "checked" : ""}>
      <span>
        <strong>${escapeHtml(repository.name)}</strong>
        <small>${escapeHtml(repository.url_prefix)}</small>
      </span>
    </label>
  `).join("");
}

async function saveRepositoryPermissions() {
  if (!adminState.selectedUserId) {
    return;
  }

  const repositoryKeys = [...adminElements.repositoryPermissions.querySelectorAll("input:checked")]
    .map((input) => input.value);
  adminElements.saveRepositoriesButton.disabled = true;
  adminElements.repositoryPermissionMessage.textContent = "正在保存...";

  try {
    await fetchJson(
      `/api/admin/users/${encodeURIComponent(adminState.selectedUserId)}/repositories`,
      "保存权限失败",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository_keys: repositoryKeys }),
      },
    );
    adminState.selectedRepositoryKeys = new Set(repositoryKeys);
    adminElements.repositoryPermissionMessage.textContent = "权限已保存";
  } catch (error) {
    adminElements.repositoryPermissionMessage.textContent = error.message;
  } finally {
    adminElements.saveRepositoriesButton.disabled = false;
  }
}

async function logout() {
  await fetch("/api/session", { method: "DELETE" });
  window.location.href = "/login";
}

async function fetchJson(url, fallback, options = {}) {
  const response = await fetch(url, options);
  return parseJsonResponse(response, fallback);
}

async function parseJsonResponse(response, fallback) {
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(apiErrorMessage(body, fallback));
  }
  return body;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function setAdminState(message) {
  adminElements.serviceState.textContent = message;
}

function setUserMessage(message, isError) {
  adminElements.userFormMessage.textContent = message;
  adminElements.userFormMessage.classList.toggle("is-error", isError);
}

function statusLabel(status) {
  const labels = {
    pending: "等待",
    running: "执行中",
    success: "成功",
    failed: "失败",
    enqueue_failed: "入队失败",
  };
  return labels[status] || status || "-";
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
