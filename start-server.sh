#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3456}"
LOG_FILE="${TMPDIR:-/tmp}/claude-side-panel-server.log"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Server already running on ws://localhost:$PORT"
  exit 0
fi

cd "$ROOT_DIR"
nohup node server/index.js >"$LOG_FILE" 2>&1 &

echo "Server started on ws://localhost:$PORT (PID: $!)"
echo "Logs: $LOG_FILE"
