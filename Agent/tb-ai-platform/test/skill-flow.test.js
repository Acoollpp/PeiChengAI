const assert = require("assert");
const { parseSkillSteps } = require("../src/skillFlow");
const { buildModeFlow } = require("../src/skillFlow");

const markdown = `
# 示例 skill

## 其他说明

1. 不应读取这里

## 必须自动执行的步骤

1. 获取创建源数据：优先查审批
2. 提取字段：至少提取项目名称
3. 回读验收。
`;

const steps = parseSkillSteps(markdown, { sectionNames: ["必须自动执行的步骤"] });

assert.deepStrictEqual(steps, [
  "获取创建源数据：优先查审批",
  "提取字段：至少提取项目名称",
  "回读验收。"
]);

const createFlow = buildModeFlow(
  "create",
  { skill: "missing-skill" },
  { skillRootDir: "/tmp/skill-flow-missing-root" }
);
assert.ok(!createFlow.some(step => step.label.includes("获取创建源数据")));

const changeFlow = buildModeFlow(
  "change",
  { skill: "missing-skill" },
  { skillRootDir: "/tmp/skill-flow-missing-root" }
);
assert.ok(changeFlow.some(step => step.label === "从用户提供的项目地址定位项目"));
assert.ok(!changeFlow.some(step => step.label.includes("搜索并定位已存在项目")));
assert.ok(changeFlow.some(step => step.label === "校验完整 PCB 号优先保留"));
assert.ok(changeFlow.some(step => step.label === "校验售前工程师等于审批提交人"));
assert.ok(changeFlow.some(step => step.label.includes("原迭代任务截止时间") && step.label.includes("2025-10-01")));
assert.ok(changeFlow.some(step => step.label === "校验任务标识为 TZ一类审批任务"));
assert.ok(changeFlow.some(step => step.label === "校验需求资料时间和计划工时"));
assert.ok(changeFlow.some(step => step.label === "回查完整 PCB 迭代、文件夹、概览、任务标识和任务字段"));

const researchCreateFlow = buildModeFlow(
  "researchCreate",
  { skill: "missing-skill" },
  { skillRootDir: "/tmp/skill-flow-missing-root" }
);
assert.ok(researchCreateFlow.some(step => step.label.includes("创建研发项目迭代")));
assert.ok(researchCreateFlow.some(step => step.label.includes("设置研发任务标题前缀")));

console.log("ok - skill flow parser extracts scoped numbered steps");
