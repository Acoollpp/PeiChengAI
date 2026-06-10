const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const homeHtml = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
const docHtml = fs.readFileSync(path.join(frontendDir, "docs/quick-start.html"), "utf8");
const styles = fs.readFileSync(path.join(frontendDir, "styles.css"), "utf8");

const heroActionsMatch = homeHtml.match(/<div class="hero-actions">[\s\S]*?<\/div>/);
assert.ok(heroActionsMatch, "home page should include hero actions");
const heroActions = heroActionsMatch[0];
const quickStartIndex = heroActions.indexOf('href="docs/quick-start.html"');
const updatesIndex = heroActions.indexOf('href="updates.html"');
const requestIndex = heroActions.indexOf('href="#request"');

assert.ok(quickStartIndex > -1, "home hero should include quick start link");
assert.ok(heroActions.includes(">快速入门</a>"), "home hero quick start link should use requested label");
assert.ok(updatesIndex > -1, "home hero should include recent updates link");
assert.ok(heroActions.includes(">近期更新</a>"), "home hero recent updates link should use requested label");
assert.ok(!heroActions.includes(">查看智能体应用</a>"), "home hero should replace old agent platform link");
assert.ok(quickStartIndex < updatesIndex, "quick start link should appear before recent updates link");
assert.ok(updatesIndex < requestIndex, "recent updates link should appear before request link");

[
  "Codex 快速入门",
  "自动化配置工具",
  "下载后双击运行",
  "双击运行.bat",
  "输入 API Key",
  "配置 Codex Key",
  "Codex 使用教程",
  "一键配置api_v2.rar",
  "钉钉",
  "软件部程昊工程师",
  "https://www.runoob.com/codex/codex-tutorial.html",
  "Codex的下载和基础使用可参考菜鸟教程",
  "Codex教程简介，核心概念，安装与使用等",
  "Skills 库",
  "Skill 是什么",
  "怎么用 Skill",
  "https://www.runoob.com/ai-agent/skills-agent.html",
  "Skill教程",
  "使用方法为 / 找到指定的 Skill",
].forEach((text) => {
  assert.ok(docHtml.includes(text), `quick start page should include: ${text}`);
});

assert.ok(!docHtml.includes("OPENAI_API_KEY"), "quick start page should avoid excessive key implementation details");
assert.ok(!docHtml.includes("不在本文档中展开"), "quick start page should not say the tutorial is out of scope");
assert.ok(!docHtml.includes("<strong>工具用途</strong>"), "quick start page should remove the tool purpose callout");
assert.ok(
  docHtml.includes('<span class="nowrap">从页面顶部下载 <strong>一键配置api_v2.rar</strong>，</span>'),
  "quick start page should keep the download phrase and archive name on one line"
);
const skillTutorialIndex = docHtml.indexOf("<strong>Skill教程</strong>");
const skillIntroIndex = docHtml.indexOf("<strong>Skill 是什么</strong>");
const taskInvokeIndex = docHtml.indexOf("在任务中调用");
const screenshotIndex = docHtml.indexOf("../assets/skill-invocation.png");
assert.ok(skillTutorialIndex > -1, "quick start page should render skill tutorial as a separate module");
assert.ok(skillTutorialIndex < skillIntroIndex, "skill tutorial module should appear before skill intro");
assert.ok(taskInvokeIndex > -1 && screenshotIndex > -1, "quick start page should include task invocation with screenshot");
assert.ok(taskInvokeIndex < screenshotIndex, "task invocation should lead into the screenshot example");
assert.equal((docHtml.match(/doc-screenshot-section/g) || []).length, 0, "quick start page should put the skill screenshot directly under task invocation");
assert.ok(docHtml.includes("../assets/skill-invocation.png"), "quick start page should reference skill invocation screenshot");
assert.ok(styles.includes(".doc-flow article > span"), "doc flow badge styling should target only direct badge spans");
assert.ok(!styles.includes(".doc-flow span {"), "doc flow styling should not color ordinary inline spans");
assert.ok(styles.includes(".doc-flow article > strong"), "doc flow title styling should target only direct title strong elements");
assert.ok(!styles.includes(".doc-flow strong,"), "doc flow styling should not force inline strong text onto a new line");
assert.ok(docHtml.includes('href="../download/一键配置api_v2.rar"'), "quick start page should link existing one-click API tool");
assert.ok(fs.existsSync(path.join(frontendDir, "assets/skill-invocation.png")), "skill invocation screenshot asset should exist");
assert.ok(docHtml.includes('class="docs-shell"'), "quick start page should use docs shell layout");
assert.ok(docHtml.includes('href="../index.html#home"'), "quick start page should link back home");
assert.ok(docHtml.includes("docs/quick-start.html") || homeHtml.includes("docs/quick-start.html"));

console.log("quick start doc ok");
