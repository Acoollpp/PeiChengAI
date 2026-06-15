const assert = require("assert");
const fs = require("fs");

const html = fs.readFileSync("public/index.html", "utf8");
const js = fs.readFileSync("public/app.js", "utf8");

assert.match(html, /id="loginPanel"/);
assert.match(html, /id="loginKeyInput"/);
assert.match(html, /id="accountName"/);
assert.match(html, /id="logoutBtn"/);
assert.match(html, /id="workspace"/);
assert.match(html, /id="flowSteps"/);
assert.match(html, /id="flowSummary"/);
assert.doesNotMatch(html, /id="output"/);
assert.doesNotMatch(html, /<pre\b/i);

assert.match(cssText(), /\[hidden\][^{]*{[^}]*display:\s*none\s*!important/i);
assert.ok(js.includes('fetch("/api/me"'));
assert.ok(js.includes('fetch("/api/login"'));
assert.ok(js.includes('fetch("/api/logout"'));
assert.ok(js.includes('fetch("/api/flows"'));
assert.ok(js.includes('fetch("/api/repair"'));
assert.ok(js.includes("renderFlowSteps"));
assert.ok(js.includes("consumeNdjson"));
assert.doesNotMatch(js, /Authorization/);
assert.doesNotMatch(js, /appendOutput/);
assert.doesNotMatch(js, /event\.type === "stdout"/);
assert.doesNotMatch(js, /event\.type === "stderr"/);
assert.ok(!js.includes('localStorage.setItem("tbAiToken"'));

console.log("ok - frontend has login state and flow panel without token or console output storage");

function cssText() {
  return fs.readFileSync("public/styles.css", "utf8");
}
