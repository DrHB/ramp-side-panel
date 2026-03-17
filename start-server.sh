#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3456}"
HOST="${HOST:-127.0.0.1}"
LOG_FILE="${TMPDIR:-/tmp}/claude-side-panel-server.log"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | grep -q "$HOST:$PORT\\|\\*:$PORT"; then
  echo "Server already running on ws://$HOST:$PORT"
  exit 0
fi

cd "$ROOT_DIR"
HOST="$HOST" PORT="$PORT" nohup node server/index.js </dev/null >"$LOG_FILE" 2>&1 &

echo "Server started on ws://$HOST:$PORT (PID: $!)"
echo "Logs: $LOG_FILE"
