const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const frontendDir = path.join(__dirname, "../frontend");
const html = fs.readFileSync(path.join(frontendDir, "skills.html"), "utf8");
const dataSource = fs.readFileSync(path.join(frontendDir, "data/site-data.js"), "utf8");
const scriptSource = fs.readFileSync(path.join(frontendDir, "script.js"), "utf8");

assert.ok(html.includes("skillhub-page"), "skills page should use skillhub-page layout");
assert.ok(html.includes("skillhub-search-row"), "skills page should include a large search row");
assert.ok(html.includes("探索全部技能"), "skills page should include the explore action");
assert.ok(html.includes("skillhub-tabs"), "skills page should include SkillHub-style tabs");
assert.ok(html.includes('id="skillsPagination"'), "skills page should include pagination controls");
assert.ok(!html.includes("一级看名称和用途"), "skills page should not include the old subtitle suffix");
assert.ok(!html.includes("进入业务沟通后再补充更细的使用说明、模板和交付材料"), "skills page should remove secondary explanation");
assert.ok(!html.includes("directory-stats"), "skills page should not show directory stats");
assert.ok(!html.includes('id="skillsCount"'), "skills page should not show count badge");
assert.ok(!html.includes("skill-category-map"), "skills page should not show category summary cards");

function createElement(attributes = {}) {
  const listeners = {};

  return {
    innerHTML: "",
    textContent: "",
    value: "",
    attributes,
    getAttribute(name) {
      return this.attributes[name];
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
      add(name) {
        this.values[name] = true;
      },
      remove(name) {
        delete this.values[name];
      },
    },
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    dispatch(event, payload) {
      if (listeners[event]) {
        listeners[event](payload);
      }
    },
    querySelectorAll() {
      return [];
    },
  };
}

const filterButtons = [];
const filterEl = createElement();
Object.defineProperty(filterEl, "innerHTML", {
  get() {
    return this._innerHTML || "";
  },
  set(value) {
    this._innerHTML = value;
    filterButtons.length = 0;
    Array.from(value.matchAll(/data-filter="([^"]+)"/g)).forEach((match) => {
      filterButtons.push(createElement({ "data-filter": match[1] }));
    });
  },
});
filterEl.querySelectorAll = function () {
  return filterButtons;
};

const elements = {
  "#skillsGrid": createElement(),
  "#skillsFilters": filterEl,
  "#skillsSearch": createElement(),
  "#skillsEmpty": createElement(),
  "#skillsPagination": createElement(),
};
const context = {
  window: {
    innerWidth: 1180,
    setInterval() {},
  },
  document: {
    querySelector(selector) {
      if (selector === ".hero") {
        return null;
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
const pagination = elements["#skillsPagination"].innerHTML;

assert.ok(rendered.includes("skill-market-card"), "skills directory should render market-style cards");
assert.ok(rendered.includes("skill-card-meta"), "skills directory cards should include compact metadata");
assert.ok(rendered.includes("skill-version"), "skills directory cards should include version badges");
assert.ok(rendered.includes("skill-title-category"), "skills directory cards should merge category into title row");
assert.ok(rendered.includes("skill-title-main"), "skills directory title should separate main title text");
assert.ok(rendered.includes("skill-title-paren"), "skills directory title should separate parenthetical suffix for wrapped titles");
assert.ok(rendered.includes("skill-purpose"), "skills directory cards should place purpose in the status row");
assert.ok(!rendered.includes("<dl>"), "skills directory cards should not use backend detail definition lists");
assert.ok(!rendered.includes("skill-card-icon"), "skills directory cards should remove large icon blocks");
assert.ok(!rendered.includes("asset-meta"), "skills directory cards should not render extra tag rows");
assert.ok(rendered.includes("skill-card-foot"), "skills directory cards should render a compact source/action row");
assert.ok(!rendered.includes("适用："), "skills directory cards should not render user suitability text");
assert.ok(!rendered.includes('<span class="skill-module">'), "skills directory cards should not render category as a separate tag row");
assert.equal((rendered.match(/skill-market-card/g) || []).length, 12, "skills directory should render 12 medium cards per desktop page");
assert.ok(pagination.includes("第 1 /"), "skills directory should show current page status");
assert.ok(pagination.includes("下一页"), "skills directory should include next page action");
assert.ok(pagination.includes('data-skill-page="2"'), "skills directory should include page 2 navigation");
assert.ok(scriptSource.includes("normalizeWrappedSkillTitles"), "skills directory should normalize parenthetical wrapping after render");
assert.ok(scriptSource.includes("skill-title-wrap-paren"), "skills directory should only split parentheses when title wraps");
assert.ok(scriptSource.includes("equalizeSkillCardHeights"), "skills directory should equalize current page card heights");
assert.ok(scriptSource.includes("style.minHeight"), "skills directory should set card height from the tallest current card");

const skills = context.window.siteData.skillsCatalog;
assert.ok(Array.isArray(skills), "skills catalog should be a dedicated secondary-page data set");
assert.equal(skills.length, 26, "skills catalog should include all 26 listed Skills");

[
  "通用-svn拉取",
  "通用-项目资料获取",
  "通用-SOP文档编写",
  "通用-钉钉文档编写",
  "brainstorming（头脑风暴）",
  "户用-协议文档识别",
  "writing-plans（任务拆解）",
  "dispatching-parallel-agents（并行执行）",
  "subagent-driven-development（自动执行计划）",
  "户用-CAN协议生成",
  "户用-485协议生成",
].forEach((title) => {
  assert.ok(rendered.includes(title), `skills directory first page should render ${title}`);
});

[
  "动力-CAN协议生成",
  "基站-DHCP移植指导",
  "天线-4g电摩通用",
  "requesting-code-review（主动发起审查）",
].forEach((title) => {
  assert.ok(!rendered.includes(title), `skills directory first page should not render later-page item ${title}`);
});

["通用", "需求分析", "任务计划", "户用", "动力", "基站", "天线", "代码审查", "代码测试"].forEach((category) => {
  assert.ok(elements["#skillsFilters"].innerHTML.includes(`data-filter="${category}"`), `skills filters should include category ${category}`);
});

["用户", "基础"].forEach((category) => {
  assert.ok(!elements["#skillsFilters"].innerHTML.includes(`data-filter="${category}"`), `skills filters should not include old category ${category}`);
});

console.log("skills directory layout ok");
