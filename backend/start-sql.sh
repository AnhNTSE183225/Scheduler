#!/usr/bin/env bash
# ==============================================================================
# Scheduler SQLite Web Inspector Launcher (Linux / Tailnet-Only)
# ==============================================================================
# Starts sqlite-web bound to 127.0.0.1 and exposes it ONLY on your private
# Tailscale network via `tailscale serve` on a dedicated HTTPS port
# (default: 8443), leaving port 443 Funnel routes untouched.
#
# Usage:
#   ./start-sql.sh                              # Inspect backend/data/scheduler.db on :8443
#   ./start-sql.sh /path/to/other.db            # Inspect another DB on :8443
#   SQL_LOCAL_PORT=8092 SQL_TS_PORT=8444 ./start-sql.sh /path/to/second.db
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$ROOT_DIR/logs"

DB_PATH="${1:-$ROOT_DIR/data/scheduler.db}"
LOCAL_PORT="${SQL_LOCAL_PORT:-8091}"
TS_PORT="${SQL_TS_PORT:-8443}"

if [ "$TS_PORT" = "443" ]; then
    echo "ERROR: Refusing to bind TS_PORT=443 so existing Tailscale Funnel routes stay untouched." >&2
    exit 1
fi

if [ ! -f "$DB_PATH" ]; then
    echo "ERROR: SQLite file not found: $DB_PATH" >&2
    exit 1
fi

DB_PATH="$(cd "$(dirname "$DB_PATH")" && pwd)/$(basename "$DB_PATH")"
STATE_FILE="$ROOT_DIR/logs/sqlite_web_${TS_PORT}.state"
LOG_FILE="$ROOT_DIR/logs/sqlite_web_${TS_PORT}.log"

# Stop any previous sqlite-web instance tracked on this TS_PORT
if [ -f "$STATE_FILE" ]; then
    OLD_PID="$(awk -F= '/^PID=/{print $2}' "$STATE_FILE" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Stopping previous sqlite-web instance (PID $OLD_PID)..."
        kill -15 "$OLD_PID" 2>/dev/null || true
        sleep 1
        kill -9 "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$STATE_FILE"
fi

# Resolve sqlite-web runner
if command -v sqlite_web >/dev/null 2>&1; then
    CMD=(sqlite_web)
elif command -v python3 >/dev/null 2>&1 && python3 -c "import sqlite_web" >/dev/null 2>&1; then
    CMD=(python3 -m sqlite_web)
elif command -v pipx >/dev/null 2>&1; then
    CMD=(pipx run --spec sqlite-web sqlite_web)
elif command -v uvx >/dev/null 2>&1; then
    CMD=(uvx --from sqlite-web sqlite_web)
else
    echo "ERROR: Could not find sqlite_web, pipx, or uvx." >&2
    echo "Install once with: pipx install sqlite-web  (or: pip install sqlite-web)" >&2
    exit 1
fi

echo "=================================================="
echo "   SQLite Web Inspector (Tailnet-Only)            "
echo "=================================================="

# Stop Scheduler backend cleanly before opening the database for editing
if [ -f "$ROOT_DIR/stop.sh" ]; then
    bash "$ROOT_DIR/stop.sh"
fi

echo "Database   : $DB_PATH"
echo "Local Bind : 127.0.0.1:$LOCAL_PORT (read-write)"

nohup "${CMD[@]}" -H 127.0.0.1 -p "$LOCAL_PORT" "$DB_PATH" >"$LOG_FILE" 2>&1 &
SQL_PID=$!

READY=0
for _ in $(seq 1 40); do
    if ! kill -0 "$SQL_PID" 2>/dev/null; then
        echo "ERROR: sqlite-web exited unexpectedly. Log output:" >&2
        cat "$LOG_FILE" >&2 || true
        exit 1
    fi
    if (echo > "/dev/tcp/127.0.0.1/$LOCAL_PORT") >/dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 0.5
done

if [ "$READY" -ne 1 ]; then
    echo "ERROR: sqlite-web did not start listening on 127.0.0.1:$LOCAL_PORT within 20s. Log output:" >&2
    cat "$LOG_FILE" >&2 || true
    kill -15 "$SQL_PID" 2>/dev/null || true
    exit 1
fi

printf 'PID=%s\nLOCAL_PORT=%s\nTS_PORT=%s\nDB_PATH=%s\n' \
    "$SQL_PID" "$LOCAL_PORT" "$TS_PORT" "$DB_PATH" >"$STATE_FILE"

if ! command -v tailscale >/dev/null 2>&1; then
    echo "WARN: 'tailscale' CLI not found. Local URL: http://127.0.0.1:$LOCAL_PORT"
    exit 0
fi

echo "Adding temporary Tailscale Serve route (https:${TS_PORT} -> 127.0.0.1:${LOCAL_PORT})..."
if ! (sudo -n tailscale serve --bg --yes --https="$TS_PORT" "http://127.0.0.1:$LOCAL_PORT" >/dev/null 2>&1 \
    || sudo tailscale serve --bg --yes --https="$TS_PORT" "http://127.0.0.1:$LOCAL_PORT"); then
    echo "ERROR: Failed to configure Tailscale Serve on port $TS_PORT." >&2
    kill -15 "$SQL_PID" 2>/dev/null || true
    rm -f "$STATE_FILE"
    exit 1
fi

TS_DNS="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 | sed 's/\.$//')"
if [ -n "$TS_DNS" ]; then
    echo "OK: Ready at https://${TS_DNS}:${TS_PORT}  (Tailscale network only)"
else
    TS_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || echo "127.0.0.1")"
    echo "OK: Ready via Tailscale Serve on port ${TS_PORT} (host IP: ${TS_IP})"
fi
echo "Log : $LOG_FILE"
echo "Stop: ./stop-sql.sh  (then ./start.sh to restart the backend)"
