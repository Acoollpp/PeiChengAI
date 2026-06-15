const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");

const PORT = 18887;

function waitForHealth() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;

    const retry = () => {
      if (Date.now() > deadline) reject(new Error("server did not start"));
      else setTimeout(check, 100);
    };

    const check = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, res => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
    };

    check();
  });
}

function postRun(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/api/run",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data)
        }
      },
      res => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          raw += chunk;
        });
        res.on("end", () => resolve({ statusCode: res.statusCode, body: raw }));
      }
    );
    req.on("error", reject);
    req.end(data);
  });
}

(async () => {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      ACCESS_TOKEN: "test-token"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth();
    const response = await postRun({ mode: "create", message: "" });
    assert.strictEqual(response.statusCode, 400);
    assert.match(response.body, /请输入任务内容/);
    console.log("ok - /api/run does not require a token");
  } finally {
    child.kill("SIGTERM");
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
