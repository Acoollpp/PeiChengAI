import json
import subprocess
import textwrap
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def run_render_markdown(markdown: str) -> str:
    script = textwrap.dedent(
        """
        const fs = require("fs");
        const vm = require("vm");

        const source = fs.readFileSync("static/app.js", "utf8");
        const context = {
          document: {
            querySelector() {
              return { addEventListener() {}, classList: { toggle() {} } };
            },
          },
          window: { setTimeout() {}, clearTimeout() {} },
          fetch() {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
          },
          FormData: class {},
          console,
        };
        vm.createContext(context);
        vm.runInContext(source, context);
        const rendered = context.renderMarkdown(JSON.parse(process.argv[1]));
        process.stdout.write(Buffer.from(rendered, "utf8").toString("base64"));
        """
    )
    result = subprocess.run(
        ["node", "-e", script, json.dumps(markdown)],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        encoding="utf-8",
        text=True,
    )
    return __import__("base64").b64decode(result.stdout).decode("utf-8")


def run_frontend_scenario(scenario: str) -> dict:
    script = textwrap.dedent(
        r"""
        const fs = require("fs");
        const vm = require("vm");

        class FakeClassList {
          constructor(classes = "") {
            this.classes = new Set(classes.split(/\s+/).filter(Boolean));
          }

          toggle(name, force) {
            const shouldAdd = force === undefined ? !this.classes.has(name) : Boolean(force);
            if (shouldAdd) {
              this.classes.add(name);
            } else {
              this.classes.delete(name);
            }
            return shouldAdd;
          }

          contains(name) {
            return this.classes.has(name);
          }
        }

        class FakeElement {
          constructor(id, { className = "", dataset = {} } = {}) {
            this.id = id;
            this.classList = new FakeClassList(className);
            this.dataset = dataset;
            this.listeners = {};
            this.children = [];
            this.attributes = {};
            this.textContent = "";
            this.value = "";
            this.disabled = false;
            this.focused = false;
            this._innerHTML = "";
          }

          addEventListener(type, handler) {
            this.listeners[type] = handler;
          }

          focus() {
            this.focused = true;
          }

          removeAttribute(name) {
            delete this.attributes[name];
          }

          setAttribute(name, value) {
            this.attributes[name] = String(value);
          }

          querySelectorAll(selector) {
            if (selector === "[data-url-prefix]") {
              return this.children.filter((child) => child.dataset.urlPrefix !== undefined);
            }
            return [];
          }

          get innerHTML() {
            return this._innerHTML;
          }

          set innerHTML(value) {
            this._innerHTML = String(value);
            this.children = [];
            const pattern = /data-url-prefix="([^"]*)"/g;
            let match;
            while ((match = pattern.exec(this._innerHTML)) !== null) {
              this.children.push(new FakeElement("repository-chip", {
                dataset: { urlPrefix: decodeEntities(match[1]) },
              }));
            }
          }
        }

        function decodeEntities(value) {
          return String(value)
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&");
        }

        function response(status, body) {
          return {
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
            text: () => Promise.resolve(String(body || "")),
          };
        }

        async function runScenario(name) {
          const posts = [];
          const nodes = new Map();
          const add = (selector, node) => {
            nodes.set(selector, node);
            return node;
          };

          const form = add("#task-form", new FakeElement("task-form"));
          const svnUrl = add("#svn-url", new FakeElement("svn-url"));
          const oldRevision = add("#old-revision", new FakeElement("old-revision"));
          const newRevision = add("#new-revision", new FakeElement("new-revision"));
          form.fields = { svn_url: svnUrl, old_revision: oldRevision, new_revision: newRevision };
          add("#submit-button", new FakeElement("submit-button"));
          add("#form-message", new FakeElement("form-message"));
          add("#service-state", new FakeElement("service-state"));
          add("#current-user", new FakeElement("current-user"));
          if (name !== "missing-admin-link") {
            add("#admin-link", new FakeElement("admin-link", { className: "admin-link is-hidden" }));
          }
          add("#logout-button", new FakeElement("logout-button"));
          add("#repository-options", new FakeElement("repository-options"));
          add("#repository-message", new FakeElement("repository-message"));
          add("#current-subtitle", new FakeElement("current-subtitle"));
          add("#task-status", new FakeElement("task-status"));
          add("#task-input", new FakeElement("task-input"));
          add("#task-times", new FakeElement("task-times"));
          add("#task-error", new FakeElement("task-error"));
          add("#download-link", new FakeElement("download-link"));
          add("#preview-subtitle", new FakeElement("preview-subtitle"));
          add("#markdown-preview", new FakeElement("markdown-preview"));
          add("#recent-list", new FakeElement("recent-list"));

          const context = {
            document: {
              querySelector(selector) {
                return nodes.get(selector) || null;
              },
            },
            window: {
              location: { href: "" },
              setTimeout() {},
              clearTimeout() {},
            },
            EventSource: class {
              constructor(url) {
                this.url = url;
                this.listeners = {};
              }
              addEventListener(type, handler) {
                this.listeners[type] = handler;
              }
              close() {}
            },
            FormData: class {
              constructor(formElement) {
                this.formElement = formElement;
              }
              get(name) {
                return this.formElement.fields[name]?.value || "";
              }
            },
            fetch(url, options = {}) {
              if (url === "/api/session") {
                return Promise.resolve(response(200, {
                  authenticated: true,
                  user: { name: "Alice", phone: "13800138000", is_admin: name === "admin-visible" },
                }));
              }
              if (url === "/api/repositories") {
                if (name === "repository-failure-submit") {
                  return Promise.resolve(response(500, { detail: "repository service failed" }));
                }
                return Promise.resolve(response(200, [
                  { name: "Home", url_prefix: "https://svn.example.com/home" },
                ]));
              }
              if (url === "/api/tasks" && options.method === "POST") {
                posts.push(JSON.parse(options.body));
                return Promise.resolve(response(200, { task_id: "task-1" }));
              }
              if (url === "/api/tasks") {
                return Promise.resolve(response(200, []));
              }
              if (url === "/api/tasks/task-1") {
                return Promise.resolve(response(200, {
                  task_id: "task-1",
                  status: "pending",
                  svn_url: posts[0]?.svn_url || "",
                  old_revision: posts[0]?.old_revision || "",
                  new_revision: posts[0]?.new_revision || "",
                  requester: "Alice",
                  created_at: null,
                  started_at: null,
                  finished_at: null,
                  error_message: "",
                }));
              }
              return Promise.resolve(response(404, { detail: `unexpected ${url}` }));
            },
            console,
          };
          context.window.window = context.window;
          vm.createContext(context);
          vm.runInContext(fs.readFileSync("static/app.js", "utf8"), context);
          await new Promise((resolve) => setImmediate(resolve));
          await new Promise((resolve) => setImmediate(resolve));

          if (name === "repository-chip") {
            const chip = nodes.get("#repository-options").querySelectorAll("[data-url-prefix]")[0];
            chip.listeners.click();
          }
          if (name === "repository-failure-submit") {
            svnUrl.value = "https://svn.example.com/manual/project/trunk";
            oldRevision.value = "r100";
            newRevision.value = "r101";
            await form.listeners.submit({ preventDefault() {} });
          }

          return {
            adminHidden: nodes.get("#admin-link")?.classList.contains("is-hidden") ?? null,
            message: nodes.get("#repository-message").textContent,
            optionsHtml: nodes.get("#repository-options").innerHTML,
            svnUrl: svnUrl.value,
            svnFocused: svnUrl.focused,
            posts,
            serviceState: nodes.get("#service-state").textContent,
          };
        }

        runScenario(process.argv[1])
          .then((result) => process.stdout.write(JSON.stringify(result)))
          .catch((error) => {
            console.error(error && error.stack ? error.stack : error);
            process.exit(1);
          });
        """
    )
    result = subprocess.run(
        ["node", "-e", script, scenario],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        encoding="utf-8",
        text=True,
    )
    return json.loads(result.stdout)


def test_markdown_preview_renders_common_report_markdown():
    html = run_render_markdown(
        "# 标题\n\n"
        "| 字段 | 值 |\n"
        "|---|---|\n"
        "| 结果 | **通过** |\n\n"
        "- 第一项\n"
        "- 第二项\n\n"
        "1. 步骤一\n"
        "2. 步骤二\n\n"
        "```python\n"
        "print('ok')\n"
        "```\n\n"
        "`inline`"
    )

    assert "<table>" in html
    assert "<th>字段</th>" in html
    assert "<strong>通过</strong>" in html
    assert "<ul>" in html
    assert "<ol>" in html
    assert "<pre><code" in html
    assert "<code>inline</code>" in html
    assert "| 字段 | 值 |" not in html
    assert "```python" not in html


def test_markdown_preview_uses_fixed_scroll_region():
    css = (PROJECT_ROOT / "static" / "styles.css").read_text(encoding="utf-8")
    preview_block = css[css.index(".markdown-preview {") : css.index(".markdown-preview h1")]

    assert "height: 100%" in preview_block
    assert "min-height: 0" in preview_block
    assert "overflow: auto" in preview_block
    assert "min-height: 420px" not in preview_block


def test_report_panel_actions_align_to_preview_bottom():
    css = (PROJECT_ROOT / "static" / "styles.css").read_text(encoding="utf-8")
    workbench_block = css[css.index(".review-workbench {") : css.index(".left-rail {")]
    right_stage_block = css[css.index(".right-stage {") : css.index(".panel {")]
    panel_block = css[css.index(".preview-panel {") : css.index(".panel-heading p")]
    preview_block = css[css.index(".markdown-preview {") : css.index(".markdown-preview h1")]
    actions_block = css[css.index(".report-actions {") : css.index("@keyframes panel-enter")]

    assert "align-items: stretch" in workbench_block
    assert "display: grid" in right_stage_block
    assert "  height: calc(100dvh - 190px);" in panel_block
    assert "min-height: calc(100dvh - 190px)" not in panel_block
    assert "grid-template-rows: auto auto minmax(0, 1fr) auto" in panel_block
    assert "align-self: stretch" in preview_block
    assert "align-self: end" in actions_block


def test_login_page_contains_name_phone_and_submit_controls():
    html = Path("static/login.html").read_text(encoding="utf-8")

    assert 'name="name"' in html
    assert 'name="phone"' in html
    assert 'id="login-form"' in html
    assert "/api/session" in html


def test_login_page_uses_workbench_entry_layout():
    html = Path("static/login.html").read_text(encoding="utf-8")
    css = (PROJECT_ROOT / "static" / "styles.css").read_text(encoding="utf-8")

    assert 'class="login-brand"' in html
    assert 'class="login-status-card"' in html
    assert 'placeholder="请输入姓名"' in html
    assert 'placeholder="请输入手机号"' in html
    assert 'class="login-button"' in html
    assert ".login-brand {" in css
    assert ".login-status-card {" in css
    assert ".login-panel::before {" in css


def test_frontend_uses_platform_product_name():
    login_html = Path("static/login.html").read_text(encoding="utf-8")
    index_html = Path("static/index.html").read_text(encoding="utf-8")

    assert "代码审查平台" in login_html
    assert "代码审查平台" in index_html
    assert "代码审查任务台" not in login_html
    assert "代码审查任务台" not in index_html


def test_task_console_uses_eventsource_and_keeps_layout_markers():
    html = Path("static/index.html").read_text(encoding="utf-8")
    js = Path("static/app.js").read_text(encoding="utf-8")

    assert 'class="workspace-grid review-workbench"' in html
    assert 'class="left-rail"' in html
    assert 'class="right-stage"' in html
    assert 'id="current-user"' in html
    assert 'new EventSource("/api/events")' in js
    assert "loadRecentTasks" in js


def test_repository_load_failure_still_allows_manual_svn_url_submit():
    html = Path("static/index.html").read_text(encoding="utf-8")
    css = (PROJECT_ROOT / "static" / "styles.css").read_text(encoding="utf-8")
    result = run_frontend_scenario("repository-failure-submit")

    assert 'id="svn-url"' in html
    assert 'name="svn_url"' in html
    assert 'id="repository-options"' in html
    assert 'id="repository-message"' in html
    assert ".repository-options" in css
    assert ".repository-chip" in css
    assert result["optionsHtml"] == ""
    assert "SVN URL" in result["message"]
    assert result["posts"] == [
        {
            "svn_url": "https://svn.example.com/manual/project/trunk",
            "old_revision": "r100",
            "new_revision": "r101",
            "requester": "",
        }
    ]


def test_repository_chip_click_writes_original_svn_url_input():
    result = run_frontend_scenario("repository-chip")

    assert result["svnUrl"] == "https://svn.example.com/home"
    assert result["svnFocused"] is True
    assert "前缀" in result["message"]


def test_admin_entry_visibility_handles_admin_and_non_admin_sessions():
    html = Path("static/index.html").read_text(encoding="utf-8")
    css = (PROJECT_ROOT / "static" / "styles.css").read_text(encoding="utf-8")
    non_admin = run_frontend_scenario("non-admin-hidden")
    admin = run_frontend_scenario("admin-visible")

    assert 'id="admin-link"' in html
    assert 'href="/admin"' in html
    assert 'class="admin-link is-hidden"' in html
    assert ".admin-link.is-hidden" in css
    assert non_admin["adminHidden"] is True
    assert admin["adminHidden"] is False


def test_admin_entry_visibility_does_not_interrupt_initialization_when_link_missing():
    result = run_frontend_scenario("missing-admin-link")

    assert result["adminHidden"] is None
    assert "前缀" in result["message"]


def test_admin_page_static_shell_and_script_are_present():
    html = Path("static/admin.html").read_text(encoding="utf-8")
    css = (PROJECT_ROOT / "static" / "styles.css").read_text(encoding="utf-8")

    assert 'class="workspace-grid admin-workbench"' in html
    assert 'id="admin-gate"' in html
    assert 'id="admin-dashboard"' in html
    assert 'id="user-usage-chart"' in html
    assert 'id="admin-user-form"' in html
    assert 'id="admin-users-table"' in html
    assert 'id="repository-permissions"' in html
    assert '<script src="/static/admin.js" defer></script>' in html
    assert ".admin-workbench" in css
    assert ".usage-chart" in css
    assert ".repository-permissions" in css


def test_admin_route_serves_static_page(api_client):
    response = api_client.get("/admin")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "admin-dashboard" in response.text
    assert "/static/admin.js" in response.text


def test_admin_script_calls_required_admin_apis_and_protects_non_admin():
    js = Path("static/admin.js").read_text(encoding="utf-8")

    assert 'fetch("/api/session")' in js
    assert "session.user.is_admin" in js
    assert 'window.location.href = "/"' in js
    assert 'fetch("/api/admin/dashboard")' in js
    assert 'fetch("/api/admin/users")' in js
    assert 'method: "POST"' in js
    assert 'method: "PATCH"' in js
    assert 'method: "PUT"' in js
    assert 'fetch(`/api/admin/users/${encodeURIComponent(userId)}/repositories`)' in js
    assert 'fetch("/api/admin/repositories")' in js
    assert 'fetch("/api/repositories")' not in js


def test_admin_script_contains_user_task_chart_rendering_logic():
    js = Path("static/admin.js").read_text(encoding="utf-8")

    assert "function renderUserUsageChart" in js
    assert "user.task_count" in js
    assert "--bar-width" in js
    assert "user-usage-chart" in js
    assert "usage-bar" in js
