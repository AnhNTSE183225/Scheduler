#!/usr/bin/env bash
# ==============================================================================
# Scheduler Backend Stopper (Linux / bash)
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/scheduler.pid"
PORT="${APP__SERVER__PORT:-8080}"

echo "Stopping Scheduler backend services..."

if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "Stopping PID $PID..."
        kill -15 "$PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE"
fi

# Fallback: kill lingering scheduler-backend binaries
pkill -f "$ROOT_DIR/target/release/scheduler-backend" 2>/dev/null || true

# Release backend port if bound
if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
fi

# Note: Decoupled host observability services (victoria-logs.service, systemd-journal-upload.service)
# are intentionally NOT stopped here so shutdown/exit/crash logs remain captured and queryable.
echo "OK: Scheduler backend stopped."
