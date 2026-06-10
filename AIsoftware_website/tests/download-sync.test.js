const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(projectDir, "sync-and-restart-service.sh"), "utf8");
const apiConfigFile = path.join(projectDir, "frontend/download/一键配置api_v2.rar");
const legacyApiConfigFile = path.join(projectDir, "frontend/download/一键配置api.rar");
const codeReviewClientFile = path.join(projectDir, "frontend/download/AI代码审查客户端-v1.3.4.exe.zip");
const legacyCodeReviewClientFile = path.join(projectDir, "frontend/download/代码审查-v1.0.0-beat4.exe.zip");
const utf8EncodingToolFile = path.join(projectDir, "frontend/download/文件编码格式转UTF-8工具.rar");

assert.ok(fs.existsSync(apiConfigFile), "one-click API config archive should exist in download/");
assert.ok(fs.statSync(apiConfigFile).size > 0, "one-click API config archive should not be empty");
assert.ok(!fs.existsSync(legacyApiConfigFile), "legacy one-click API config archive should be cleaned from frontend/download/");
assert.ok(fs.existsSync(codeReviewClientFile), "code review client archive should exist in download/");
assert.ok(fs.statSync(codeReviewClientFile).size > 0, "code review client archive should not be empty");
assert.ok(!fs.existsSync(legacyCodeReviewClientFile), "legacy code review client archive should be cleaned from frontend/download/");
assert.ok(fs.existsSync(utf8EncodingToolFile), "UTF-8 encoding tool archive should exist in frontend/download/");
assert.ok(fs.statSync(utf8EncodingToolFile).size > 0, "UTF-8 encoding tool archive should not be empty");
assert.ok(script.includes('SOURCE_DIR="$PROJECT_DIR/frontend/"'), "sync script should define frontend source");
assert.ok(script.includes('DOWNLOAD_DIR="$SOURCE_DIR/download/"'), "sync script should define frontend download source directory");
assert.ok(script.includes('rsync -a --delete --exclude ".DS_Store" "$SOURCE_DIR" "$TARGET_DIR"'), "sync script should publish frontend directory to service root");
assert.ok(script.includes('rsync -a --delete --exclude ".DS_Store" "$DOWNLOAD_DIR" "$TARGET_DIR/download/"'), "sync script should publish root download directory");

console.log("download sync ok");
