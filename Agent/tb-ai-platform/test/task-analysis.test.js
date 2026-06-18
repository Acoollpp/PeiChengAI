const assert = require("assert");
const { analyzeTask, extractFields, suggestMode } = require("../src/taskAnalysis");

const changeText = `
项目名称
30549-CTP35H-低压户储-显示屏、
30550-CTP35H-低压户储-显示屏。
原项目编号
CTP35H-RN30549-1.5、
CTP35H-RN30550-1.5。
新项目编号
CTP35H-RN30549-2.0、
CTP35H-RN30550-2.0。
项目工程师
顾坤梅
`;

assert.strictEqual(suggestMode("项目变更申请\n原项目编号\nA\n新项目编号\nB", "create"), "change");
assert.strictEqual(suggestMode("项目启动申请\n项目编号\nA", "change"), "create");
assert.strictEqual(extractFields("change", changeText).engineer, "顾坤梅");

const preview = analyzeTask({ mode: "change", message: changeText });
assert.strictEqual(preview.itemCount, 2);
assert.strictEqual(preview.items[0].fields.oldCode, "CTP35H-RN30549-1.5");
assert.strictEqual(preview.items[1].fields.newCode, "CTP35H-RN30550-2.0");

const bigPreview = analyzeTask({ mode: "create", message: Array.from({ length: 6 }, (_, index) => `项目名称：P${index}\n项目编号：C${index}`).join("\n\n") });
assert.strictEqual(bigPreview.requiresConfirmation, true);

console.log("ok - task analysis previews mode, fields, and confirmation needs");
