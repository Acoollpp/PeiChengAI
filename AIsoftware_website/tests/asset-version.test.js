const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const version = "20260610-recent-updates-1";
const htmlFiles = ["index.html", "platform.html", "tools.html", "updates.html", "skills.html"];

htmlFiles.forEach((fileName) => {
  const html = fs.readFileSync(path.join(frontendDir, fileName), "utf8");
  assert.ok(html.includes(`styles.css?v=${version}`), `${fileName} should use current stylesheet version`);
  assert.ok(html.includes(`data/platform-urls.js?v=${version}`), `${fileName} should use current platform URL version`);
  assert.ok(html.includes(`data/site-data.js?v=${version}`), `${fileName} should use current data version`);
  assert.ok(html.includes(`script.js?v=${version}`), `${fileName} should use current script version`);
});

const contactHtml = fs.readFileSync(path.join(frontendDir, "contact.html"), "utf8");
assert.ok(contactHtml.includes(`styles.css?v=${version}`), "contact.html should use current stylesheet version");

const quickStartHtml = fs.readFileSync(path.join(frontendDir, "docs/quick-start.html"), "utf8");
assert.ok(quickStartHtml.includes(`styles.css?v=${version}`), "quick-start.html should use current stylesheet version");

const codexApiToolHtml = fs.readFileSync(path.join(frontendDir, "docs/codex-api-tool.html"), "utf8");
assert.ok(codexApiToolHtml.includes(`styles.css?v=${version}`), "codex-api-tool.html should use current stylesheet version");

const utf8EncodingToolHtml = fs.readFileSync(path.join(frontendDir, "docs/utf8-encoding-tool.html"), "utf8");
assert.ok(utf8EncodingToolHtml.includes(`styles.css?v=${version}`), "utf8-encoding-tool.html should use current stylesheet version");

const dingtalkDocToolHtml = fs.readFileSync(path.join(frontendDir, "docs/dingtalk-doc-tool.html"), "utf8");
assert.ok(dingtalkDocToolHtml.includes(`styles.css?v=${version}`), "dingtalk-doc-tool.html should use current stylesheet version");

console.log("asset version ok");
