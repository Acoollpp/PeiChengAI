const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const frontendDir = path.join(__dirname, "../frontend");
const dataSource = fs.readFileSync(path.join(frontendDir, "data/site-data.js"), "utf8");
const scriptSource = fs.readFileSync(path.join(frontendDir, "script.js"), "utf8");

function createElement() {
  return {
    innerHTML: "",
    textContent: "",
    classList: {
      toggle() {},
      add() {},
      remove() {},
    },
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
  };
}

function createContext(search) {
  const elements = {
    "#skillsGrid": createElement(),
    "#skillsFilters": createElement(),
    "#skillsSearch": createElement(),
    "#skillsEmpty": createElement(),
    "#skillsPagination": createElement(),
    "#skillDetail": createElement(),
    "#skillDetailTitle": createElement(),
    "#skillDetailNavTitle": createElement(),
    "title": createElement(),
  };
  const context = {
    URLSearchParams,
    window: {
      innerWidth: 1180,
      location: { search },
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

  return { context, elements };
}

const directory = createContext("");
const skills = directory.context.window.siteData.skillsCatalog;
const pptSkill = skills.find((item) => item.title === "ppt-master（PPT生成）");

assert.ok(pptSkill, "skills catalog should include ppt-master（PPT生成）");
assert.equal(pptSkill.category, "文档生成");
assert.equal(pptSkill.stage, "试点中");
assert.equal(pptSkill.purpose, "PPT生成");
assert.ok(pptSkill.description.includes("基于文本内容生成可编辑 PPTX 初稿"));

const renderedDirectory = directory.elements["#skillsGrid"].innerHTML;
assert.ok(renderedDirectory.includes("ppt-master"), "skills directory should render ppt-master name");
assert.ok(renderedDirectory.includes("PPT生成"), "skills directory should render ppt-master parenthetical label");
assert.ok(renderedDirectory.includes("GitHub 开源"), "ppt-master card should show GitHub open source badge");

const detail = createContext("?skill=" + encodeURIComponent("ppt-master（PPT生成）"));
const detailHtml = detail.elements["#skillDetail"].innerHTML;

assert.ok(detailHtml.includes("GitHub 开源 Skill"), "detail page should identify ppt-master as GitHub open source");
assert.ok(detailHtml.includes("使用提示"), "detail page should include usage notice title");
assert.ok(
  detailHtml.includes("该 Skill 只能作为初稿参考，生成内容仍需人工调整、排版润色和业务复核后再正式使用。"),
  "detail page should include ppt-master usage notice"
);
assert.ok(detailHtml.includes("基于文本内容生成可编辑 PPTX 初稿"), "detail page should explain ppt-master positioning");
assert.ok(detailHtml.includes("https://github.com/hugohe3/ppt-master"), "detail page should link to ppt-master repository");
assert.ok(detailHtml.includes("查看项目仓库"), "detail page should show repository action");
assert.ok(detailHtml.includes("返回 Skills 库"), "detail page should keep return action");

console.log("ppt master skill ok");
