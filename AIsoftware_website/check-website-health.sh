#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5174}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL_FILE="$ROOT_DIR/frontend/data/platform-urls.js"

echo "== AI application center health check =="

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | grep -q nginx; then
  echo "OK: nginx is listening on port $PORT"
else
  echo "FAIL: nginx is not listening on port $PORT"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN || true
  exit 1
fi

for path in /healthz /index.html /platform.html /skills.html; do
  if curl -fsS "http://127.0.0.1:$PORT$path" >/dev/null; then
    echo "OK: http://127.0.0.1:$PORT$path"
  else
    echo "FAIL: http://127.0.0.1:$PORT$path"
    exit 1
  fi
done

echo "== Registered platform URLs =="
node - "$URL_FILE" <<'NODE'
const fs = require("node:fs");
const vm = require("node:vm");

const file = process.argv[2];
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(file, "utf8"), context);

Object.entries(context.window.platformUrls || {}).forEach(([key, url]) => {
  console.log(`${key}: ${url}`);
});
NODE

echo "Health check passed."
