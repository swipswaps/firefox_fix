#!/usr/bin/env bash
# status.sh — report whether the server is running and what port it is on

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$PROJ_DIR/.server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "STOPPED — no PID file at $PID_FILE"
  exit 1
fi

PID=$(cat "$PID_FILE")

if ! kill -0 "$PID" 2>/dev/null; then
  echo "STOPPED — PID $PID is no longer running (stale PID file)"
  exit 1
fi

PORT=$(ss -tlnp 2>/dev/null | grep "pid=$PID," | grep -oP ':\K[0-9]+' | head -1 || echo "unknown")
echo "RUNNING — PID $PID, port $PORT"
echo "Dashboard: http://localhost:3000"
exit 0

