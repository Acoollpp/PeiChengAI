const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const version = "20260602-code-review-actions-2";
const htmlFiles = ["index.html", "platform.html", "skills.html"];

htmlFiles.forEach((fileName) => {
  const html = fs.readFileSync(path.join(frontendDir, fileName), "utf8");
  assert.ok(html.includes(`styles.css?v=${version}`), `${fileName} should use current stylesheet version`);
  assert.ok(html.includes(`data/platform-urls.js?v=${version}`), `${fileName} should use current platform URL version`);
  assert.ok(html.includes(`data/site-data.js?v=${version}`), `${fileName} should use current data version`);
  assert.ok(html.includes(`script.js?v=${version}`), `${fileName} should use current script version`);
});

const contactHtml = fs.readFileSync(path.join(frontendDir, "contact.html"), "utf8");
assert.ok(contactHtml.includes(`styles.css?v=${version}`), "contact.html should use current stylesheet version");

console.log("asset version ok");
