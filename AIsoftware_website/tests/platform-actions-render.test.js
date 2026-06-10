const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dataFile = path.join(__dirname, "../frontend/data/site-data.js");
const urlFile = path.join(__dirname, "../frontend/data/platform-urls.js");
const scriptFile = path.join(__dirname, "../frontend/script.js");
const styleFile = path.join(__dirname, "../frontend/styles.css");
const urlSource = fs.readFileSync(urlFile, "utf8");
const dataSource = fs.readFileSync(dataFile, "utf8");
const scriptSource = fs.readFileSync(scriptFile, "utf8");
const styleSource = fs.readFileSync(styleFile, "utf8");

function createElement() {
  return {
    innerHTML: "",
    classList: {
      toggle() {},
    },
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
  };
}

function renderWithHero(hasHero) {
  const elements = {
    "#platformGrid": createElement(),
    "#platformCount": createElement(),
  };
  const context = {
    window: {
      setInterval() {},
    },
    document: {
      querySelector(selector) {
        if (selector === ".hero") {
          return hasHero ? createElement() : null;
        }
        return elements[selector] || null;
      },
      querySelectorAll() {
        return [];
      },
    },
  };

  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(urlSource, context);
  vm.runInContext(dataSource, context);
  vm.runInContext(scriptSource, context);

  return elements["#platformGrid"].innerHTML;
}

const homeHtml = renderWithHero(true);
const directoryHtml = renderWithHero(false);

assert.ok(homeHtml.includes("代码审查平台"), "home page should render code review platform card");
assert.ok(homeHtml.includes(">看板平台</a>"), "home code review card should render dashboard action");
assert.ok(homeHtml.includes(">客户端下载</a>"), "home code review card should render client download action");
assert.ok(!homeHtml.includes("Openclaw 智能体监控平台"), "home page should replace Openclaw card with code review platform");
assert.ok(!homeHtml.includes(">开发专用平台</a>"), "home page should not render Openclaw development action");
assert.ok(!homeHtml.includes(">其他部门专用平台</a>"), "home page should not render Openclaw department action");

[directoryHtml].forEach((html) => {
  assert.ok(html.includes('class="project-actions split-actions"'), "Openclaw links should render as split actions");
  assert.ok(html.includes('class="project-action-group"'), "Openclaw links should have a grouped access area");
  assert.ok(html.includes(">开发专用平台</a>"), "Openclaw should render development platform action");
  assert.ok(html.includes(">其他部门专用平台</a>"), "Openclaw should render department platform action");
  assert.ok(html.includes('href="http://172.23.17.79:9181/"'), "Openclaw development action should use current home URL");
  assert.ok(html.includes('href="http://172.23.17.190:9181/"'), "Openclaw department action should use current home URL");
  assert.ok(!html.includes("172.23.17.108"), "Openclaw home action should not use previous development URL");
  assert.ok(!html.includes("172.23.17.169"), "Openclaw home action should not use previous department URL");
});

assert.ok(homeHtml.includes("platform-feature"), "home page should render platform feature cards");
assert.ok(homeHtml.includes("assets/ai-home-landing.png"), "home carousel should use ai home landing image");
assert.ok(homeHtml.includes("assets/ai-home-agent.png"), "home carousel should use ai home agent image");
assert.ok(homeHtml.includes("assets/ai-home-growth.png"), "home carousel should use ai home growth image");
assert.ok(homeHtml.includes("visual-carousel-controls"), "home carousel should render controls outside the image area");
assert.ok(!homeHtml.includes("assets/agent-app-overview.svg"), "home carousel should not use old layered svg");
assert.ok(!homeHtml.includes("assets/agent-api-governance.svg"), "home carousel should not use old api svg");
assert.ok(!homeHtml.includes("assets/agent-monitoring.svg"), "home carousel should not use old monitoring svg");
assert.ok(directoryHtml.includes("directory-card"), "directory page should render directory cards");
assert.ok(directoryHtml.includes(">看板平台</a>"), "Code review should render dashboard platform action");
assert.ok(directoryHtml.includes(">客户端下载</a>"), "Code review should render client download action");
assert.ok(directoryHtml.includes('href="download/AI代码审查客户端-v1.3.4.exe.zip"'), "Code review client action should use current published download path");
assert.match(
  styleSource,
  /\.project-actions\.split-actions\s+\.project-doc-link\s*{[^}]*flex-basis:\s*100%/s,
  "split action document link should be forced onto the second row",
);

console.log("platform actions render ok");
