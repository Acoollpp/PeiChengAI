const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const docFile = path.join(__dirname, "../frontend/docs/code-review-platform.html");
assert.ok(fs.existsSync(docFile), "code review platform doc should exist");

const html = fs.readFileSync(docFile, "utf8");

const requiredText = [
  "代码审查平台",
  "软件部面向研发场景建设的内部辅助审查工具",
  "试点中内部平台",
  "平台实际效果",
  "代码提交前自查",
  "审查建议辅助修改",
  "使用情况可统计",
  "适用对象",
  "功能展示",
  "本地客户端使用",
  "代码审查结果",
  "提交前辅助检查",
  "统计看板查看",
  "平台截图",
  "客户端登录界面",
  "客户端审查界面",
  "统计平台用户管理",
  "统计平台任务管理",
  "访问与使用",
  "下载客户端压缩包",
  "访问代码审查看板",
  "看板地址待补充",
  "当前看板尚未部署",
  "常见问题",
  "建设说明",
  "../assets/code-review-client-login.png",
  "../assets/code-review-client-main.png",
  "../assets/code-review-dashboard-users.png",
  "../assets/code-review-dashboard-tasks.png",
  "../assets/downloads/code-review-v1.0.0-beta2.rar",
];

requiredText.forEach((text) => {
  assert.ok(html.includes(text), `missing required code review doc text: ${text}`);
});

const removedText = ["安装包：待更新", "统计平台地址：待补充", "平台截图展示"];

removedText.forEach((text) => {
  assert.ok(!html.includes(text), `placeholder text should not remain: ${text}`);
});

assert.ok(html.includes('class="docs-shell"'), "code review doc should use docs-shell layout");
assert.ok(html.includes('class="docs-sidebar"'), "code review doc should include sidebar navigation");
assert.ok(html.includes('class="docs-toc"'), "code review doc should include page toc");
assert.ok(html.includes('class="doc-callout"'), "code review doc should include callouts");
assert.ok(html.includes('class="doc-flow"'), "code review doc should include flow cards");
assert.ok(html.includes('class="doc-grid-3"'), "code review doc should include outcome cards");
assert.ok(html.includes('class="doc-screenshot-grid"'), "code review doc should include screenshot grid");
assert.ok(html.includes('download="code-review-v1.0.0-beta2.rar"'), "download link should save the client package");
assert.ok(html.includes(`../data/platform-urls.js?v=20260602-code-review-actions-2`), "doc should load URL registry");
assert.ok(html.includes(`../script.js?v=20260602-code-review-actions-2`), "doc should run shared scripts");
assert.ok(html.includes('data-platform-url="codeReviewDashboard"'), "doc should hydrate dashboard placeholder URL");

[
  "../frontend/assets/code-review-client-login.png",
  "../frontend/assets/code-review-client-main.png",
  "../frontend/assets/code-review-dashboard-users.png",
  "../frontend/assets/code-review-dashboard-tasks.png",
  "../frontend/assets/downloads/code-review-v1.0.0-beta2.rar",
].forEach((assetPath) => {
  const fullPath = path.join(__dirname, assetPath);
  assert.ok(fs.existsSync(fullPath), `missing code review asset: ${assetPath}`);
  assert.ok(fs.statSync(fullPath).size > 0, `code review asset should not be empty: ${assetPath}`);
});

console.log("code review doc content ok");
