#!/usr/bin/env bash
set -euo pipefail

LABEL="com.paceex.software-website"
PORT="5174"
USER_ID="$(id -u)"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$PROJECT_DIR/frontend/"
DOWNLOAD_DIR="$SOURCE_DIR/download/"
TARGET_DIR="$HOME/Sites/software_website_frontend/"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$PROJECT_DIR/logs"
NGINX_BIN="$HOME/opt/nginx/sbin/nginx"
NGINX_CONF="$HOME/opt/nginx/conf/nginx.conf"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Source frontend directory was not found:"
  echo "  $SOURCE_DIR"
  exit 1
fi

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "LaunchAgent plist was not found:"
  echo "  $PLIST_PATH"
  exit 1
fi

mkdir -p "$TARGET_DIR" "$LOG_DIR"

echo "== Sync software website =="
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"
echo

rsync -a --delete --exclude ".DS_Store" "$SOURCE_DIR" "$TARGET_DIR"
if [[ -d "$DOWNLOAD_DIR" ]]; then
  mkdir -p "$TARGET_DIR/download"
  rsync -a --delete --exclude ".DS_Store" "$DOWNLOAD_DIR" "$TARGET_DIR/download/"
fi

echo "== Reload nginx background service =="
if launchctl print "gui/$USER_ID/$LABEL" >/dev/null 2>&1; then
  if [[ -x "$NGINX_BIN" && -f "$NGINX_CONF" ]]; then
    "$NGINX_BIN" -t -c "$NGINX_CONF"
    "$NGINX_BIN" -s reload -c "$NGINX_CONF" || launchctl kickstart -k "gui/$USER_ID/$LABEL"
  else
    launchctl kickstart -k "gui/$USER_ID/$LABEL"
  fi
else
  launchctl bootstrap "gui/$USER_ID" "$PLIST_PATH"
  launchctl enable "gui/$USER_ID/$LABEL"
  launchctl kickstart -k "gui/$USER_ID/$LABEL"
fi

echo "Waiting for service..."
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 &&
    curl -fsS "http://127.0.0.1:$PORT/index.html" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 ||
  ! curl -fsS "http://127.0.0.1:$PORT/index.html" >/dev/null 2>&1; then
  echo "Service did not respond on port $PORT."
  echo "Check logs:"
  echo "  $LOG_DIR/nginx-launchd.stderr.log"
  exit 1
fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")"

echo
echo "Website service is running."
echo "Local URL:    http://127.0.0.1:$PORT/index.html"
echo "Intranet URL: http://$LAN_IP:$PORT/index.html"
