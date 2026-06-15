const assert = require("assert");
const { parseSkillSteps } = require("../src/skillFlow");

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

console.log("ok - skill flow parser extracts scoped numbered steps");
