const fs = require("fs");
const path = require("path");

function loadEnvFile(rootDir = path.join(__dirname, ".."), env = process.env) {
  const envFile = path.join(rootDir, ".env");
  if (!fs.existsSync(envFile)) return;

  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!env[key]) env[key] = value;
  }
}

function numberFrom(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function loadConfig(env = process.env, rootDir = path.join(__dirname, "..")) {
  const home = env.HOME || "/home/gpt";
  const dataDir = env.TB_DATA_DIR || path.join(rootDir, "data");

  return {
    rootDir,
    publicDir: path.join(rootDir, "public"),
    workspaceDir: path.join(rootDir, "workspace"),
    dataDir,
    databasePath: env.TB_DATABASE_PATH || path.join(dataDir, "tb-platform.sqlite"),
    codexBin: env.CODEX_BIN || path.join(home, ".local/bin/codex"),
    port: numberFrom(env.PORT, 8787),
    host: env.HOST || "0.0.0.0",
    cchDatabaseUrl: env.CCH_DATABASE_URL || "",
    sessionSecret: env.SESSION_SECRET || "tb-ai-platform-dev-secret",
    sessionTtlHours: numberFrom(env.SESSION_TTL_HOURS, 24),
    cchSyncIntervalMs: numberFrom(env.CCH_SYNC_INTERVAL_MS, 60000)
  };
}

module.exports = {
  loadConfig,
  loadEnvFile
};
