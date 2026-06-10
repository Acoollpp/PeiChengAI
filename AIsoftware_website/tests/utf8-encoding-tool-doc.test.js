const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const docHtml = fs.readFileSync(path.join(frontendDir, "docs/utf8-encoding-tool.html"), "utf8");
const dataSource = fs.readFileSync(path.join(frontendDir, "data/site-data.js"), "utf8");
const packageFile = path.join(frontendDir, "download/文件编码格式转UTF-8工具.rar");

[
  "文件编码格式转UTF-8工具",
  "批量将项目目录下的 .c 与 .h 文件转换为 UTF-8 编码",
  "准备文件与脚本",
  "启动转换并选择是否备份",
  "选择目标文件夹",
  "执行批量转换",
  "验证转换效果",
  "[CONVERT]",
  "[SKIP]",
  "Done. Converted",
  "修改前",
  "修改后",
  "download/文件编码格式转UTF-8工具.rar",
].forEach((text) => {
  assert.ok(docHtml.includes(text), `UTF-8 tool doc should include: ${text}`);
});

assert.ok(!docHtml.includes("<h3>选择是否备份原文件</h3>"), "backup choice should be merged into the startup stage");
assert.ok(!docHtml.includes("<span>阶段 6</span>"), "merged flow should have 5 stages");

[
  "utf8-encoding-tool-step-1.png",
  "utf8-encoding-tool-step-2.png",
  "utf8-encoding-tool-step-3.png",
  "utf8-encoding-tool-step-4.png",
  "utf8-encoding-tool-before.png",
  "utf8-encoding-tool-after.png",
].forEach((fileName) => {
  assert.ok(fs.existsSync(path.join(frontendDir, "assets", fileName)), `${fileName} should exist in frontend assets`);
  assert.ok(docHtml.includes(`../assets/${fileName}`), `UTF-8 tool doc should reference ${fileName}`);
});

assert.ok(fs.existsSync(packageFile), "UTF-8 encoding tool package should exist in frontend/download");
assert.ok(fs.statSync(packageFile).size > 0, "UTF-8 encoding tool package should not be empty");
assert.ok(dataSource.includes('title: "文件编码格式转UTF-8工具"'), "tool data should include UTF-8 encoding tool");
assert.ok(dataSource.includes('toolUrl: "download/文件编码格式转UTF-8工具.rar"'), "tool data should link UTF-8 tool package");
assert.ok(dataSource.includes('docUrl: "docs/utf8-encoding-tool.html"'), "tool data should link UTF-8 tool document");

console.log("utf8 encoding tool doc ok");
