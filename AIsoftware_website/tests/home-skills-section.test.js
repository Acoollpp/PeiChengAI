const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const frontendDir = path.join(__dirname, "../frontend");
const html = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
const dataSource = fs.readFileSync(path.join(frontendDir, "data/site-data.js"), "utf8");
const scriptSource = fs.readFileSync(path.join(frontendDir, "script.js"), "utf8");

assert.ok(!html.includes('id="platformCount"'), "home page should not show platform count badge");
assert.ok(!html.includes('id="skillsCount"'), "home page should not show skills count badge");
assert.ok(!html.includes("skills-preview-table"), "home skills section should not render a detailed table");
assert.ok(html.includes("skills-home-cards"), "home skills section should render overview cards");
assert.ok(html.includes("查看全部 Skills"), "home skills section should keep the secondary page entry");
assert.ok(html.includes("可复用 AI 能力库"), "home skills headline should match requested copy");
assert.equal((html.match(/可复用 AI 能力库/g) || []).length, 1, "home skills headline should not be duplicated");
assert.ok(html.includes("选择与您业务场景匹配的 Skill，查看其能力范围、适用用户及上线状态。"), "home skills copy should match requested visitor guidance");
assert.ok(html.includes("<strong>5</strong>"), "home metrics should show agent app count as number");
assert.ok(html.includes("<span>智能体应用</span>"), "home metrics should show agent app label below number");
assert.ok(html.includes("<strong>25+</strong>"), "home metrics should show skill library count as number");
assert.ok(html.includes("<span>Skill库</span>"), "home metrics should show skill library label below number");
assert.ok(html.includes("<strong>100+</strong>"), "home metrics should show codex user count as number");
assert.ok(html.includes("<span>配置codex用户</span>"), "home metrics should show codex user label below number");
assert.ok(html.includes("<strong>20+</strong>"), "home metrics should show dingtalk agent count as number");
assert.ok(html.includes("<span>钉钉智能体</span>"), "home metrics should show dingtalk agent label below number");
assert.ok(!html.includes("<strong>智能体应用 5</strong>"), "home metrics should not combine label and number");
["已上线平台应用", "可复用能力", "内部使用账号", "协同办公入口"].forEach((copy) => {
  assert.ok(!html.includes(copy), `home metrics should not show secondary copy ${copy}`);
});
assert.ok(!html.includes("先来这里查找可复用的 AI 能力"), "home skills copy should not use previous wording");
assert.ok(!html.includes("选择与你的业务场景相近的 Skill"), "home skills copy should not use previous wording");
assert.ok(!html.includes("把高频能力沉淀成可复用组件"), "home skills copy should not be an internal construction slogan");
assert.ok(!html.includes("首页只呈现能力方向和使用入口"), "home skills copy should not describe page maintenance");

const styles = fs.readFileSync(path.join(frontendDir, "styles.css"), "utf8");
const metricLabelRule = styles.match(/\.metric-grid span \{[\s\S]*?\}/);
assert.ok(metricLabelRule, "home metric label style should exist");
assert.ok(metricLabelRule[0].includes("font-size: 22px"), "home metric labels should be larger");
const badgeRule = styles.match(/\.skills-home-sidebar > span \{[\s\S]*?\}/);
assert.ok(badgeRule, "skills library badge style should exist");
assert.ok(!badgeRule[0].includes("width: 100%"), "skills library badge should not stretch full width");
assert.ok(badgeRule[0].includes("align-self: flex-start"), "skills library badge should keep compact content width inside flex layout");

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

const elements = {
  "#skillsGrid": createElement(),
};
const context = {
  window: {
    setInterval() {},
  },
  document: {
    querySelector(selector) {
      if (selector === ".hero") {
        return createElement();
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
vm.runInContext(dataSource, context);
vm.runInContext(scriptSource, context);

const rendered = elements["#skillsGrid"].innerHTML;

assert.ok(rendered.includes("skill-overview-card"), "home skills render should use overview cards");
assert.ok(!rendered.includes("<tr>"), "home skills render should not output table rows");
assert.ok(!rendered.includes("12 项"), "home skills render should not show total item count");
[
  "通用-svn拉取",
  "通用-项目资料获取",
  "通用-SOP文档编写",
  "通用-钉钉文档编写",
].forEach((title) => {
  assert.ok(rendered.includes(title), `home skills should render actual catalog skill ${title}`);
});
[
  "流程处理 Agent",
  "文档生成工作台",
  "合同要点抽取 Skill",
  "会议纪要生成 Skill",
].forEach((title) => {
  assert.ok(!rendered.includes(title), `home skills should not render old project placeholder ${title}`);
});

console.log("home skills section ok");
