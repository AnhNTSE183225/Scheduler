#!/usr/bin/env bash
# ==============================================================================
# Scheduler SQLite Web Inspector Stopper (Linux / Tailnet-Only)
# ==============================================================================
# Cleanly stops sqlite-web instance(s) started by start-sql.sh and removes ONLY
# their dedicated Tailscale Serve HTTPS port(s). Never resets port 443 Funnel.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"

shopt -s nullglob
STATE_FILES=("$LOG_DIR"/sqlite_web_*.state)
shopt -u nullglob

if [ "${#STATE_FILES[@]}" -eq 0 ]; then
    echo "No active sqlite-web state files found in $LOG_DIR."
    exit 0
fi

for STATE_FILE in "${STATE_FILES[@]}"; do
    PID="$(awk -F= '/^PID=/{print $2}' "$STATE_FILE" 2>/dev/null || true)"
    LOCAL_PORT="$(awk -F= '/^LOCAL_PORT=/{print $2}' "$STATE_FILE" 2>/dev/null || true)"
    TS_PORT="$(awk -F= '/^TS_PORT=/{print $2}' "$STATE_FILE" 2>/dev/null || true)"

    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "Stopping sqlite-web (PID $PID, local port ${LOCAL_PORT:-?})..."
        kill -15 "$PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$PID" 2>/dev/null; then
            kill -9 "$PID" 2>/dev/null || true
        fi
    fi

    if [ -n "$LOCAL_PORT" ] && command -v fuser >/dev/null 2>&1; then
        fuser -k "${LOCAL_PORT}/tcp" >/dev/null 2>&1 || true
    fi

    if [ -n "$TS_PORT" ] && [ "$TS_PORT" != "443" ] && command -v tailscale >/dev/null 2>&1; then
        echo "Removing Tailscale Serve route on HTTPS port $TS_PORT..."
        sudo -n tailscale serve --https="$TS_PORT" off >/dev/null 2>&1 \
            || sudo tailscale serve --https="$TS_PORT" off >/dev/null 2>&1 \
            || echo "WARN: Could not remove Tailscale Serve route on port $TS_PORT (run: sudo tailscale serve --https=$TS_PORT off)." >&2
    fi

    rm -f "$STATE_FILE"
done

echo "OK: SQLite Web Inspector stopped and temporary Tailscale Serve route(s) removed."
echo "Run ./start.sh when ready to bring the Scheduler backend back up."
