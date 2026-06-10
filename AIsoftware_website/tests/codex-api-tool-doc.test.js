const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const docHtml = fs.readFileSync(path.join(frontendDir, "docs/codex-api-tool.html"), "utf8");
const dataSource = fs.readFileSync(path.join(frontendDir, "data/site-data.js"), "utf8");

[
  "Codex一键配置API工具",
  "下载解压后双击",
  "复制分配好的 key",
  "配置成功界面",
  "Codex 登录方式选择",
  "设置沙盒",
  "测试 Codex",
  "双击运行.bat",
  "download/一键配置api_v2.rar",
].forEach((text) => {
  assert.ok(docHtml.includes(text), `Codex API tool doc should include: ${text}`);
});

[
  "codex-api-tool-step-1.png",
  "codex-api-tool-step-2.png",
  "codex-api-tool-step-3.png",
  "codex-api-tool-step-4.png",
  "codex-api-tool-step-5.png",
  "codex-api-tool-step-6.png",
].forEach((fileName) => {
  assert.ok(fs.existsSync(path.join(frontendDir, "assets", fileName)), `${fileName} should exist in frontend assets`);
  assert.ok(docHtml.includes(`../assets/${fileName}`), `Codex API tool doc should reference ${fileName}`);
});

assert.ok(dataSource.includes('title: "Codex一键配置API工具"'), "tool data should use the new Codex API tool name");
assert.ok(dataSource.includes('docUrl: "docs/codex-api-tool.html"'), "tool data should link the dedicated Codex API tool doc");
assert.ok(!dataSource.includes('title: "一键配置 API 工具"'), "tool data should not use the old one-click API tool name");
assert.ok(!dataSource.includes('docUrl: "docs/quick-start.html"'), "tool data should not use quick-start as the tool document");

console.log("codex api tool doc ok");
