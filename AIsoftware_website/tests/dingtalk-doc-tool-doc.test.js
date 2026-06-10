const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const docHtml = fs.readFileSync(path.join(frontendDir, "docs/dingtalk-doc-tool.html"), "utf8");
const dataSource = fs.readFileSync(path.join(frontendDir, "data/site-data.js"), "utf8");

[
  "钉钉文档写入工具",
  "通用-钉钉文档编写",
  "在指定钉钉文档文件夹内创建一份测试文档",
  "目标文件夹地址",
  "操作者凭证",
  "测试文件_YYYYMMDD",
  "测试目的、测试范围、测试步骤、测试结果",
  "创建完成后，请返回文档标题及文档链接",
  "本次操作无需发送通知",
  "操作者凭证找程昊工程师获取",
  "不能写入图片到文档中",
  "不能读取识别文档到图片",
  "assets/skill-packages/通用-钉钉文档编写.zip",
].forEach((text) => {
  assert.ok(docHtml.includes(text), `DingTalk doc tool page should include: ${text}`);
});

[
  "dingtalk-doc-tool-step-1.jpg",
  "dingtalk-doc-tool-step-2.jpg",
  "dingtalk-doc-tool-step-3.jpg",
  "dingtalk-doc-tool-case-1-action.png",
  "dingtalk-doc-tool-case-1-result.png",
  "dingtalk-doc-tool-case-2-action.png",
  "dingtalk-doc-tool-case-2-result.png",
].forEach((fileName) => {
  assert.ok(fs.existsSync(path.join(frontendDir, "assets", fileName)), `${fileName} should exist in frontend assets`);
  assert.ok(docHtml.includes(`../assets/${fileName}`), `DingTalk doc tool page should reference ${fileName}`);
});

assert.ok(dataSource.includes('title: "钉钉文档写入工具"'), "tool data should include DingTalk doc tool");
assert.ok(dataSource.includes('toolUrl: "assets/skill-packages/通用-钉钉文档编写.zip"'), "tool data should keep DingTalk skill package link");
assert.ok(dataSource.includes('docUrl: "docs/dingtalk-doc-tool.html"'), "tool data should link dedicated DingTalk doc tool page");
assert.ok(!dataSource.includes('docUrl: "skill-detail.html?skill=通用-钉钉文档编写"'), "tool data should not use skill detail as efficiency tool document");

console.log("dingtalk doc tool doc ok");
