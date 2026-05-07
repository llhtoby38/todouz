#!/usr/bin/env bash
# todouz launcher — starts the HTTP/dashboard server.
# Usage:
#   ./start.sh              # foreground
#   ./start.sh --background # daemonised, log to /tmp/todouz.log
#   ./start.sh --stop       # stop the background daemon

set -euo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

PID_FILE="/tmp/todouz.pid"
LOG_FILE="/tmp/todouz.log"

# Prefer nvm node if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

# Subscription billing — make sure no API key leaks into the SDK.
unset ANTHROPIC_API_KEY || true

case "${1:-}" in
  --stop)
    if [ -f "$PID_FILE" ]; then
      pid=$(cat "$PID_FILE")
      kill "$pid" 2>/dev/null || echo "process $pid already gone"
      rm -f "$PID_FILE"
      echo "Stopped."
    else
      echo "Not running."
    fi
    ;;
  --background)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Already running (pid $(cat "$PID_FILE")). Stop it first with --stop."
      exit 1
    fi
    nohup node mcp-server/http-server.mjs > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Started in background (pid $(cat "$PID_FILE"))."
    echo "Logs:  $LOG_FILE"
    echo "URL:   http://localhost:8765/dashboard/"
    echo "Stop:  ./start.sh --stop"
    ;;
  *)
    exec node mcp-server/http-server.mjs
    ;;
esac
