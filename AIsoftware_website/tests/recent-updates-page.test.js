const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const frontendDir = path.join(__dirname, "../frontend");
const homeHtml = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
const updatesHtml = fs.readFileSync(path.join(frontendDir, "updates.html"), "utf8");
const dataSource = fs.readFileSync(path.join(frontendDir, "data/site-data.js"), "utf8");
const scriptSource = fs.readFileSync(path.join(frontendDir, "script.js"), "utf8");

const heroActionsMatch = homeHtml.match(/<div class="hero-actions">[\s\S]*?<\/div>/);
assert.ok(heroActionsMatch, "home page should include hero actions");
const heroActions = heroActionsMatch[0];

assert.ok(heroActions.includes('href="updates.html"'), "hero actions should link to recent updates page");
assert.ok(heroActions.includes(">近期更新</a>"), "hero actions should expose recent updates button");
assert.ok(!heroActions.includes(">查看智能体应用</a>"), "hero actions should replace old agent app button");

assert.ok(updatesHtml.includes("<title>近期更新 - 软件部 AI 应用中心</title>"), "updates page should set title");
assert.ok(updatesHtml.includes('id="recentUpdatesList"'), "updates page should include recent updates list mount");
assert.ok(updatesHtml.includes("只记录工具包、客户端、Skill 包和下载文件"), "updates page should describe file update scope");
assert.ok(!updatesHtml.includes("展示规则"), "updates page should not render the display-rule card");
assert.ok(!updatesHtml.includes("最近 5 条"), "updates page should not mention the old five-item window");
assert.ok(!updatesHtml.includes("超过 5 条"), "updates page should not mention the old five-item overflow rule");
assert.ok(!updatesHtml.includes("配色"), "updates page should not be about visual color changes");
assert.ok(!updatesHtml.includes("页面样式"), "updates page should not be about page style changes");

function createElement() {
  return {
    innerHTML: "",
    textContent: "",
    attributes: {},
    getAttribute(name) {
      return this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    classList: {
      toggle() {},
      add() {},
      remove() {},
      contains() {
        return false;
      },
    },
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    scrollIntoView() {},
  };
}

const recentUpdatesList = createElement();
const recentUpdatesCount = createElement();
const context = {
  window: {
    innerWidth: 1180,
    setInterval() {},
    addEventListener() {},
  },
  document: {
    body: {
      appendChild() {},
    },
    createElement,
    addEventListener() {},
    querySelector(selector) {
      return {
        "#recentUpdatesList": recentUpdatesList,
        "#recentUpdatesCount": recentUpdatesCount,
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

const updates = context.window.siteData.recentUpdates;
assert.ok(Array.isArray(updates), "site data should expose recentUpdates");
assert.ok(updates.length >= 6, "site data should keep source history beyond display window");
assert.equal(recentUpdatesCount.textContent, "6 条更新", "updates page should show current count inside the ten-item window");

[
  "AI代码审查客户端",
  "文件编码格式转UTF-8工具",
  "通用-钉钉文档编写",
  "Codex一键配置API工具",
  "Codex Skill 调用示例",
].forEach((title) => {
  assert.ok(recentUpdatesList.innerHTML.includes(title), `recent updates should render ${title}`);
});

assert.ok(recentUpdatesList.innerHTML.includes("通用-代码变更审查"), "sixth file update should render in ten-item window");
assert.ok(recentUpdatesList.innerHTML.includes('href="download/AI代码审查客户端-v1.3.4.exe.zip"'), "updates should link client package");
assert.ok(recentUpdatesList.innerHTML.includes('href="docs/code-review-platform.html"'), "updates should link code review doc");
assert.ok(recentUpdatesList.innerHTML.includes('download'), "downloadable update links should use download behavior");
assert.ok(scriptSource.includes("renderRecentUpdates"), "script should render recent updates");
assert.ok(scriptSource.includes("slice(0, 10)"), "script should render latest ten updates only");

console.log("recent updates page ok");
