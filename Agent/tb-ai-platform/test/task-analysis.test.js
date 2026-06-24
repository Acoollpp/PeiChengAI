const assert = require("assert");
const {
  analyzeTask,
  extractFields,
  extractFullPcb,
  suggestMode
} = require("../src/taskAnalysis");

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
assert.strictEqual(suggestMode("项目立项开发\n项目重要等级\n一级项目\n项目分类\n轻型动力/AGV", "create"), "researchCreate");
assert.strictEqual(extractFields("change", changeText).engineer, "顾坤梅");

const preview = analyzeTask({ mode: "change", message: changeText });
assert.strictEqual(preview.itemCount, 2);
assert.strictEqual(preview.items[0].fields.oldCode, "CTP35H-RN30549-1.5");
assert.strictEqual(preview.items[1].fields.newCode, "CTP35H-RN30550-2.0");

const changeWithFullPcb = `
陈心博提交的项目变更申请
项目名称
42078-P16S200A-低压户储
原项目编号
P16S200A-GLN42078L10BW-IOB-1.4
新项目编号
P16S200A-GLN42078L10BW-IOB-2.0
更换底板
SST22-1887-5.0
项目工程师
刘虹谊
新能源PM
张振国
`;
const changeFields = extractFields("change", changeWithFullPcb);
assert.strictEqual(changeFields.pcb, "SST22-1887-5.0");
assert.strictEqual(changeFields.presales, "陈心博");
assert.strictEqual(changeFields.pm, "张振国");
assert.strictEqual(extractFullPcb("底板版本：SST26-0615"), "SST26-0615");
assert.strictEqual(extractFullPcb("PCB：21887-6.0"), "21887-6.0");
const changePreview = analyzeTask({ mode: "change", message: changeWithFullPcb });
assert.ok(changePreview.checks.some(check => check.key === "fullPcb" && check.ok && check.value === "SST22-1887-5.0"));
assert.ok(changePreview.checks.some(check => check.key === "presalesSubmitter" && check.ok && check.value === "陈心博"));
assert.ok(!changePreview.warnings.some(warning => warning.includes("完整 PCB")));

const bigPreview = analyzeTask({ mode: "create", message: Array.from({ length: 6 }, (_, index) => `项目名称：P${index}\n项目编号：C${index}`).join("\n\n") });
assert.strictEqual(bigPreview.requiresConfirmation, true);

const researchText = `
刘云翔提交的项目立项开发
项目名称
宁德人形机器人BMS开发
项目重要等级
一级项目（战略级/核心级）
项目分类
轻型动力/AGV
项目编号
BMS: PB16S50A-ND60616-IOB（ PCB=SST26-0615）
项目负责人
甘园园
`;
const researchPreview = analyzeTask({ mode: "researchCreate", message: researchText });
assert.strictEqual(researchPreview.suggestedMode, "researchCreate");
assert.strictEqual(researchPreview.missingFields.length, 0);
assert.strictEqual(researchPreview.items[0].fields.projectName, "宁德人形机器人BMS开发");
assert.strictEqual(researchPreview.items[0].fields.projectLevel, "一级项目（战略级/核心级）");
assert.strictEqual(researchPreview.items[0].fields.projectCategory, "轻型动力/AGV");

console.log("ok - task analysis previews mode, fields, and confirmation needs");
