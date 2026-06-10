const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const frontendDir = path.join(__dirname, "../frontend");
const homeHtml = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
const toolsHtml = fs.readFileSync(path.join(frontendDir, "tools.html"), "utf8");
const platformHtml = fs.readFileSync(path.join(frontendDir, "platform.html"), "utf8");
const skillsHtml = fs.readFileSync(path.join(frontendDir, "skills.html"), "utf8");
const contactHtml = fs.readFileSync(path.join(frontendDir, "contact.html"), "utf8");
const dataSource = fs.readFileSync(path.join(frontendDir, "data/site-data.js"), "utf8");
const scriptSource = fs.readFileSync(path.join(frontendDir, "script.js"), "utf8");

function createElement(attributes = {}) {
  const listeners = {};

  return {
    innerHTML: "",
    textContent: "",
    value: "",
    attributes,
    disabled: false,
    getAttribute(name) {
      return this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    classList: {
      values: {},
      toggle(name, active) {
        if (active) {
          this.values[name] = true;
        } else {
          delete this.values[name];
        }
      },
    },
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    querySelectorAll(selector) {
      if (selector === ".project-card") {
        return [];
      }
      if (selector === "button") {
        return [];
      }
      return [];
    },
    scrollIntoView() {},
  };
}

function assertNavOrder(html, label) {
  const navMatch = html.match(/<nav class="main-nav"[\s\S]*?<\/nav>/);
  assert.ok(navMatch, `${label} should include main nav`);

  const nav = navMatch[0];
  const homeIndex = nav.indexOf(">首页</a>");
  const platformIndex = nav.indexOf(">智能体应用</a>");
  const toolsIndex = nav.indexOf(">提效工具库</a>");
  const skillsIndex = nav.indexOf(">Skills 库</a>");
  const requestIndex = nav.indexOf(">需求对接</a>");

  assert.ok(homeIndex > -1, `${label} nav should include home`);
  assert.ok(platformIndex > homeIndex, `${label} nav should place agent platform after home`);
  assert.ok(toolsIndex > platformIndex, `${label} nav should place efficiency tools after agent platform`);
  assert.ok(skillsIndex > toolsIndex, `${label} nav should place Skills after efficiency tools`);
  assert.ok(requestIndex > skillsIndex, `${label} nav should place request after Skills`);
}

[
  [homeHtml, "home page"],
  [toolsHtml, "tools page"],
  [platformHtml, "platform page"],
  [skillsHtml, "skills page"],
  [contactHtml, "contact page"],
].forEach(([html, label]) => {
  assertNavOrder(html, label);
});

assert.ok(homeHtml.includes('id="efficiency-tools"'), "home page should include efficiency tools section");
assert.ok(homeHtml.includes("提效工具库"), "home page should mention efficiency tools library");
assert.ok(homeHtml.includes('href="tools.html"'), "home page should link to efficiency tools page");
assert.ok(toolsHtml.includes("<title>提效工具库 - 软件部 AI 应用中心</title>"), "tools page should set page title");
assert.ok(toolsHtml.includes("toolhub-page"), "tools page should use toolhub layout");
assert.ok(toolsHtml.includes('id="toolsGrid"'), "tools page should include tools grid");
assert.ok(toolsHtml.includes('id="toolsFilters"'), "tools page should include tools filters");
assert.ok(toolsHtml.includes('id="toolsSearch"'), "tools page should include tools search");
assert.ok(!toolsHtml.includes("没有找到匹配的提效工具"), "tools page should not render an empty-state hint");

const toolsGrid = createElement();
const toolsHomeGrid = createElement();
const toolsFilters = createElement();
const toolsCount = createElement();

const context = {
  window: {
    innerWidth: 1180,
    setInterval() {},
    addEventListener() {},
  },
  document: {
    querySelector(selector) {
      return {
        "#toolsGrid": toolsGrid,
        "#toolsHomeGrid": toolsHomeGrid,
        "#toolsFilters": toolsFilters,
        "#toolsCount": toolsCount,
        "#toolsSearch": createElement(),
        "#toolsEmpty": createElement(),
      }[selector] || null;
    },
    querySelectorAll() {
      return [];
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(dataSource, context);
vm.runInContext(scriptSource, context);

const tools = context.window.siteData.efficiencyTools;
assert.ok(Array.isArray(tools), "site data should expose efficiencyTools");
assert.equal(tools.length, 4, "efficiency tools should include the first 4 tools");

[
  ["Codex一键配置API工具", "download/一键配置api_v2.rar", "docs/codex-api-tool.html", "环境配置"],
  [
    "钉钉文档写入工具",
    "assets/skill-packages/通用-钉钉文档编写.zip",
    "docs/dingtalk-doc-tool.html",
    "文档写入",
  ],
  ["可编辑流程图生成工具", "", "", "流程图"],
  ["文件编码格式转UTF-8工具", "download/文件编码格式转UTF-8工具.rar", "docs/utf8-encoding-tool.html", "编码转换"],
].forEach(([title, toolUrl, docUrl, category]) => {
  const item = tools.find((tool) => tool.title === title);
  assert.ok(item, `efficiency tools should include ${title}`);
  assert.equal(item.category, category, `${title} should use expected category`);
  if (toolUrl) {
    assert.equal(item.toolUrl, toolUrl, `${title} should link expected tool`);
  }
  if (docUrl) {
    assert.equal(item.docUrl, docUrl, `${title} should link expected document`);
  }
});

assert.ok(scriptSource.includes("renderEfficiencyTools"), "script should render efficiency tools");
assert.ok(scriptSource.includes("buildToolCard"), "script should build tool cards");
assert.ok(toolsGrid.innerHTML.includes("Codex一键配置API工具"), "tools page should render Codex API tool card");
assert.ok(toolsGrid.innerHTML.includes("钉钉文档写入工具"), "tools page should render dingtalk document tool card");
assert.ok(toolsGrid.innerHTML.includes("可编辑流程图生成工具"), "tools page should render editable flowchart tool card");
assert.ok(toolsGrid.innerHTML.includes("开发中"), "tools page should render flowchart tool as in development");
assert.ok(toolsGrid.innerHTML.includes("文件编码格式转UTF-8工具"), "tools page should render UTF-8 encoding tool card");
assert.ok(toolsGrid.innerHTML.includes("再选择目标目录执行转换"), "UTF-8 tool usage should use target directory wording");
assert.ok(!toolsGrid.innerHTML.includes("目标项目目录"), "UTF-8 tool usage should not mention target project directory");
assert.ok(toolsGrid.innerHTML.includes("tool-card-rail"), "tools page should render a visually distinct tool rail");
assert.ok(!toolsGrid.innerHTML.includes("tool-card-rail\"><span"), "tool rail should not render text in the lower-left corner");
assert.ok(toolsGrid.innerHTML.includes("tool-action-group"), "tools page should group tool actions");
assert.ok(toolsGrid.innerHTML.includes(">工具链接</a>"), "tools page should render tool link action");
assert.ok(toolsGrid.innerHTML.includes(">使用文档</a>"), "tools page should render usage document action");
assert.ok(toolsGrid.innerHTML.includes('href="download/一键配置api_v2.rar"'), "tools page should render API tool download link");
assert.ok(
  toolsGrid.innerHTML.includes('href="assets/skill-packages/通用-钉钉文档编写.zip"'),
  "tools page should render dingtalk tool package link",
);
assert.ok(toolsGrid.innerHTML.includes('href="docs/codex-api-tool.html"'), "tools page should render API tool document link");
assert.ok(
  toolsGrid.innerHTML.includes('href="docs/dingtalk-doc-tool.html"'),
  "tools page should render dingtalk tool document link",
);
assert.ok(toolsGrid.innerHTML.includes('href="download/文件编码格式转UTF-8工具.rar"'), "tools page should render UTF-8 tool download link");
assert.ok(toolsGrid.innerHTML.includes('href="docs/utf8-encoding-tool.html"'), "tools page should render UTF-8 tool document link");
assert.ok(toolsHomeGrid.innerHTML.includes("Codex一键配置API工具"), "home page should render efficiency tool cards");
assert.ok(toolsFilters.innerHTML.includes('data-filter="环境配置"'), "tools filters should include environment category");
assert.equal(toolsCount.innerHTML, "4 个工具", "tools page should render tool count");

console.log("efficiency tools page ok");
