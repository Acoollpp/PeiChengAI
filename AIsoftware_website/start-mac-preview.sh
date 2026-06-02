#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-5174}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/frontend"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 was not found. Please install Python 3 and try again."
  exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo
  echo "Port $PORT is already in use."
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  echo
  echo "Use another port, for example:"
  echo "  ./start-mac-preview.sh 5175"
  echo
  exit 1
fi

IP="$(
  ipconfig getifaddr en0 2>/dev/null ||
  ipconfig getifaddr en1 2>/dev/null ||
  echo "127.0.0.1"
)"

echo
echo "Software AI website preview started."
echo "Local URL:    http://127.0.0.1:$PORT/index.html"
echo "Intranet URL: http://$IP:$PORT/index.html"
echo "Site root:    $ROOT"
echo
echo "Press Ctrl + C to stop the server."
echo

cd "$ROOT"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
