const assert = require("assert");
const { detectProjectItems } = require("../src/projectItems");

const items = detectProjectItems(
  "create",
  [
    "项目名称：60411-P15S100A-低压户储",
    "项目编号：P15S100A-MK60411L10-IOB-1.0",
    "客户：A",
    "",
    "项目名称：60412-P16S100A-低压户储",
    "项目编号：P16S100A-MK60412L10-IOB-1.0",
    "客户：B"
  ].join("\n")
);

assert.strictEqual(items.length, 2);
assert.strictEqual(items[0].id, "item-1");
assert.match(items[0].title, /60411/);
assert.match(items[1].message, /60412/);

const singleCreate = detectProjectItems(
  "create",
  `
陈志恒提交的项目启动申请
审批通过
项目名称
61374-P16S200A-低压户储
项目编号
P16S200A-LG61374L20-1.0
客户
烟台力高动力科技有限公司
启动原因描述
在项目 P16S200A-WL61137L20-1.4 基础上修改逆变器协议和屏幕协议。
PCB=21887-4.1
应用场合
PACE项目/户用储能/低压户储
客户要求日期
2026-05-25
项目工程师
梁水凤
`
);
assert.strictEqual(singleCreate.length, 1);
assert.match(singleCreate[0].message, /61374-P16S200A/);
assert.match(singleCreate[0].message, /梁水凤/);

const changeItems = detectProjectItems("change", "项目名称：A\n项目地址：https://example.com/project/1");
assert.strictEqual(changeItems.length, 1);

const singleChange = detectProjectItems(
  "change",
  `
陈志恒提交的项目变更申请
项目名称
61374-P16S200A-低压户储
原项目编号
P16S200A-LG61374L20-1.0
新项目编号
P16S200A-LG61374L20-1.1
变更类别
客户新需
项目工程师
梁水凤
`
);
assert.strictEqual(singleChange.length, 1);
assert.match(singleChange[0].message, /61374-P16S200A/);

const batchChangeItems = detectProjectItems(
  "change",
  `
项目名称
30549-CTP35H-低压户储-显示屏、
30550-CTP35H-低压户储-显示屏、
40663-CTP35H-低压户储-显示屏。
原项目编号
CTP35H-RN30549-1.5、
CTP35H-RN30550-1.5、
CTP35H-RN40663-1.2。
新项目编号
CTP35H-RN30549-2.0、
CTP35H-RN30550-2.0、
CTP35H-RN40663-2.0。
阶段属性
MP
项目工程师
顾坤梅
`
);
assert.strictEqual(batchChangeItems.length, 3);
assert.match(batchChangeItems[0].message, /30549-CTP35H/);
assert.match(batchChangeItems[0].message, /CTP35H-RN30549-1.5/);
assert.match(batchChangeItems[0].message, /CTP35H-RN30549-2.0/);
assert.match(batchChangeItems[2].message, /CTP35H-RN40663-2.0/);

console.log("ok - project item detector splits multi-project create and change forms");
