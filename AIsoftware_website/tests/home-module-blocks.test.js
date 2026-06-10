const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const html = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(frontendDir, "styles.css"), "utf8");

[
  'class="section module-section module-agent"',
  'class="section module-section module-tools"',
  'class="section section-muted module-section module-skills"',
  'class="section request-section module-section module-request"',
].forEach((className) => {
  assert.ok(html.includes(className), `home page should include module block class: ${className}`);
});

[
  ".module-section {",
  ".module-section::before",
  ".module-eyebrow-row",
  ".module-eyebrow-row::after",
  ".module-section .section-head",
  ".module-agent",
  ".module-tools",
  ".module-skills",
  ".module-request",
].forEach((selector) => {
  assert.ok(styles.includes(selector), `home module styles should include ${selector}`);
});

[
  "平台应用区",
  "工具下载区",
  "能力复用区",
  "需求承接区",
].forEach((label) => {
  assert.ok(html.includes(label), `home page should include module band label: ${label}`);
});

["01", "02", "03", "04"].forEach((number) => {
  assert.ok(!html.includes(`>${number}<`), `home module bands should not use visible sequence number ${number}`);
});

const agentSectionMatch = html.match(/<section class="section module-section module-agent" id="agent-platform">[\s\S]*?<\/section>/);
assert.ok(agentSectionMatch, "home page should include agent platform module section");
const agentSection = agentSectionMatch[0];
const agentHeadMatch = agentSection.match(/<div class="section-head">[\s\S]*?<\/div>\s*<\/div>/);
assert.ok(agentHeadMatch, "agent module should include section head");
assert.ok(agentHeadMatch[0].includes("查看全部智能体应用"), "agent module full link should sit in the top section head");
assert.ok(!agentSection.includes("section-more"), "agent module should not place the full link below the cards");

assert.ok(styles.includes("border-top: 1px solid rgba(15, 23, 42, 0.08);"), "module sections should have visible boundaries");
assert.ok(styles.includes("margin-top: 24px;"), "module sections should create a visible break between areas");
assert.ok(styles.includes("box-shadow: 0 18px 42px rgba(23, 32, 51, 0.08);"), "module sections should use a refined surface shadow");
assert.doesNotMatch(
  styles,
  /\.module-eyebrow-row\s*{[^}]*background:\s*var\(--blue-dark\)/s,
  "module divider should not use a heavy dark banner",
);

console.log("home module blocks ok");
