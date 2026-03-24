#!/usr/bin/env bash
# stop.sh — cleanly stop the Firefox Optimizer server
# Reads .server.pid, sends SIGTERM, waits 5 s, falls back to SIGKILL.
# Safe to run even when the server is not running.

set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$PROJ_DIR/.server.pid"
LOCK_FILE="$PROJ_DIR/firefox_optimizer.lock"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Server not running (no $PID_FILE found)."
  exit 0
fi

PID=$(cat "$PID_FILE")

if ! kill -0 "$PID" 2>/dev/null; then
  echo "Process $PID is already gone (stale PID file). Cleaning up."
  rm -f "$PID_FILE" "$LOCK_FILE"
  exit 0
fi

echo "Stopping server (PID $PID) with SIGTERM..."
kill -TERM "$PID"

for i in $(seq 1 10); do
  sleep 0.5
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Server stopped cleanly."
    rm -f "$PID_FILE" "$LOCK_FILE"
    exit 0
  fi
done

echo "Server did not stop within 5 s. Sending SIGKILL..."
kill -KILL "$PID" 2>/dev/null || true
sleep 0.5
rm -f "$PID_FILE" "$LOCK_FILE"
echo "Server killed."

