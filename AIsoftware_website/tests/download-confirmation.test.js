const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const scriptSource = fs.readFileSync(path.join(frontendDir, "script.js"), "utf8");
const styles = fs.readFileSync(path.join(frontendDir, "styles.css"), "utf8");

assert.ok(scriptSource.includes("bindDownloadConfirmations"), "script should bind download confirmation behavior");
assert.ok(scriptSource.includes("download-confirm-modal"), "script should render a download confirmation modal");
assert.ok(scriptSource.includes("是否下载"), "confirmation modal should include the requested wording");
assert.ok(scriptSource.includes("确认"), "confirmation modal should include confirm action");
assert.ok(scriptSource.includes("取消"), "confirmation modal should include cancel action");
assert.ok(scriptSource.includes("isDownloadLink"), "script should detect download links consistently");
assert.ok(scriptSource.includes(".rar"), "script should detect RAR downloads");
assert.ok(scriptSource.includes(".zip"), "script should detect ZIP downloads");
assert.ok(scriptSource.includes("event.preventDefault()"), "download click should be intercepted before confirmation");
assert.ok(scriptSource.includes("confirmDownloadLink.click()"), "confirmed action should continue the original download");

[
  ".download-confirm-backdrop",
  ".download-confirm-dialog",
  ".download-confirm-actions",
  ".download-confirm-confirm",
  ".download-confirm-cancel",
].forEach((selector) => {
  assert.ok(styles.includes(selector), `styles should include ${selector}`);
});

console.log("download confirmation ok");
