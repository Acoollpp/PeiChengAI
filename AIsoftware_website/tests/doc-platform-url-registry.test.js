const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const version = "20260602-code-review-actions-2";
const docs = [
  {
    file: "docs/ai-account-platform.html",
    keys: ["apiManagement"],
    urls: ["http://172.23.17.242:8090/"],
  },
  {
    file: "docs/openclaw-dingtalk.html",
    keys: ["openclawDev", "openclawDepartment"],
    urls: ["http://172.23.17.79:9181/", "http://172.23.17.190:9181/"],
  },
  {
    file: "docs/ai-app-statistics.html",
    keys: ["aiStatistics"],
    urls: ["http://172.24.21.3:8080/"],
  },
  {
    file: "docs/gpt-account-platform.html",
    keys: ["gptAccount"],
    urls: ["http://172.23.17.242:8080/"],
  },
  {
    file: "docs/code-review-platform.html",
    keys: ["codeReviewDashboard"],
    urls: [],
  },
];

docs.forEach((doc) => {
  const html = fs.readFileSync(path.join(frontendDir, doc.file), "utf8");

  assert.ok(
    html.includes(`../data/platform-urls.js?v=${version}`),
    `${doc.file} should load the central platform URL registry`
  );
  assert.ok(html.includes(`../script.js?v=${version}`), `${doc.file} should run shared URL hydration`);

  doc.keys.forEach((key) => {
    assert.ok(html.includes(`data-platform-url="${key}"`), `${doc.file} should hydrate ${key}`);
  });

  doc.urls.forEach((url) => {
    assert.ok(!html.includes(`href="${url}"`), `${doc.file} should not hard-code href ${url}`);
  });
});

console.log("doc platform url registry ok");
