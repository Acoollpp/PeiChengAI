const assert = require("assert");
const { loadConfig } = require("../src/config");

const config = loadConfig({
  PORT: "9999",
  HOST: "127.0.0.1",
  CODEX_BIN: "/tmp/codex",
  SESSION_SECRET: "secret-value",
  SESSION_TTL_HOURS: "12",
  CCH_SYNC_INTERVAL_MS: "30000",
  TB_BATCH_CONCURRENCY: "12",
  TB_DATA_DIR: "/tmp/tb-data"
});

assert.strictEqual(config.port, 9999);
assert.strictEqual(config.host, "127.0.0.1");
assert.strictEqual(config.codexBin, "/tmp/codex");
assert.strictEqual(config.sessionSecret, "secret-value");
assert.strictEqual(config.sessionTtlHours, 12);
assert.strictEqual(config.cchSyncIntervalMs, 30000);
assert.strictEqual(config.batchConcurrency, 12);
assert.strictEqual(config.dataDir, "/tmp/tb-data");

const defaultConfig = loadConfig({});
assert.strictEqual(defaultConfig.batchConcurrency, 5);
console.log("ok - config loads typed values");
