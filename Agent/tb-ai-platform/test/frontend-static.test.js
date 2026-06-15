const assert = require("assert");
const fs = require("fs");

const html = fs.readFileSync("public/index.html", "utf8");
const js = fs.readFileSync("public/app.js", "utf8");

assert.match(html, /id="loginPanel"/);
assert.match(html, /id="loginKeyInput"/);
assert.match(html, /id="accountName"/);
assert.match(html, /id="logoutBtn"/);
assert.match(html, /id="workspace"/);

assert.match(cssText(), /\[hidden\][^{]*{[^}]*display:\s*none\s*!important/i);
assert.ok(js.includes('fetch("/api/me"'));
assert.ok(js.includes('fetch("/api/login"'));
assert.ok(js.includes('fetch("/api/logout"'));
assert.doesNotMatch(js, /Authorization/);
assert.ok(!js.includes('localStorage.setItem("tbAiToken"'));

console.log("ok - frontend has login state without key storage");

function cssText() {
  return fs.readFileSync("public/styles.css", "utf8");
}
