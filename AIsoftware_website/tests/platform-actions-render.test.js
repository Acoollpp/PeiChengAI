const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dataFile = path.join(__dirname, "../frontend/data/site-data.js");
const urlFile = path.join(__dirname, "../frontend/data/platform-urls.js");
const scriptFile = path.join(__dirname, "../frontend/script.js");
const urlSource = fs.readFileSync(urlFile, "utf8");
const dataSource = fs.readFileSync(dataFile, "utf8");
const scriptSource = fs.readFileSync(scriptFile, "utf8");
const styleSource = fs.readFileSync(path.join(__dirname, "../frontend/styles.css"), "utf8");

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
const codeReviewStart = directoryHtml.indexOf("<h3>代码审查平台</h3>");
const nextCardStart = directoryHtml.indexOf("<article", codeReviewStart + 1);
const codeReviewCardHtml = directoryHtml.slice(codeReviewStart, nextCardStart > -1 ? nextCardStart : undefined);

[homeHtml, directoryHtml].forEach((html) => {
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
assert.ok(directoryHtml.includes(">访问代码审查看板</a>"), "code review should render dashboard action");
assert.ok(directoryHtml.includes(">下载客户端</a>"), "code review should render client download action");
assert.ok(directoryHtml.includes('href="/docs/code-review-platform.html#dashboard"'), "code review dashboard action should point to doc placeholder");
assert.ok(directoryHtml.includes('href="assets/downloads/code-review-v1.0.0-beta2.rar"'), "code review download action should point to package");
assert.ok(directoryHtml.includes('download="code-review-v1.0.0-beta2.rar"'), "code review package action should download the rar");
assert.ok(directoryHtml.includes('href="docs/code-review-platform.html"'), "code review should render document action");
assert.ok(
  codeReviewCardHtml.includes('class="project-doc-link" target="_blank" rel="noopener noreferrer">使用文档</a>'),
  "code review document action should be rendered on the second row like split actions"
);
assert.ok(
  styleSource.includes(".project-actions.split-actions .project-doc-link") &&
    styleSource.includes("flex-basis: 100%"),
  "split action document link should occupy a full row"
);

console.log("platform actions render ok");
