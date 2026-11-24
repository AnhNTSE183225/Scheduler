#!/usr/bin/env bash
# ==============================================================================
# Scheduler Backend Production Launcher (Linux / bash)
# ==============================================================================
# Standalone backend-only launcher with PID tracking (scheduler.pid) and
# decoupled systemd/VictoriaLogs observability enforcement.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$ROOT_DIR/logs"

PID_FILE="$ROOT_DIR/scheduler.pid"
RUNNER_LOG="$ROOT_DIR/logs/backend_runner.log"
RELEASE_BIN="$ROOT_DIR/target/release/scheduler-backend"

echo "=================================================="
echo "   Scheduler Backend Background Runner (Linux)    "
echo "=================================================="

# 1. Verify decoupled host logging systemd services are active
MISSING_LOGGING_SERVICES=()
if ! command -v systemctl >/dev/null 2>&1; then
    echo "ERROR: 'systemctl' not found. Linux production observability requires systemd." >&2
    echo "Install and enable the centralized TECHSTACK logging stack (observability/install.sh) first." >&2
    exit 1
fi

for svc in victoria-logs.service systemd-journal-upload.service; do
    if ! systemctl is-active --quiet "$svc"; then
        MISSING_LOGGING_SERVICES+=("$svc")
    fi
done

if [ "${#MISSING_LOGGING_SERVICES[@]}" -gt 0 ]; then
    echo "==================================================" >&2
    echo "ERROR: Required logging systemd service(s) are NOT running:" >&2
    for svc in "${MISSING_LOGGING_SERVICES[@]}"; do
        echo "  - $svc" >&2
    done
    echo "" >&2
    echo "Turn on the systemd logging services with:" >&2
    echo "  sudo systemctl enable --now victoria-logs.service systemd-journal-upload.service" >&2
    echo "" >&2
    echo "If not installed yet on this host, run the one-line TECHSTACK installer:" >&2
    echo "  curl -fsSL https://raw.githubusercontent.com/AnhNTSE183225/techstack/main/observability/install.sh | sudo bash" >&2
    echo "==================================================" >&2
    exit 1
fi
echo "OK: Host observability active (victoria-logs.service + systemd-journal-upload.service)."

# 2. Stop existing process if running
if [ -f "$PID_FILE" ]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Stopping existing Scheduler backend process (PID $OLD_PID)..."
        kill -15 "$OLD_PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$OLD_PID" 2>/dev/null; then
            kill -9 "$OLD_PID" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE"
fi

# 3. Check build artifacts
if [ ! -f "$RELEASE_BIN" ]; then
    echo "Release binary missing. Automatically building with ./build.sh..."
    bash "$ROOT_DIR/build.sh"
fi

# 4. Load .env if present
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
fi

export PROFILE="${PROFILE:-PROD}"
export LOG_FORMAT="${LOG_FORMAT:-json}"
export RUST_LOG="${RUST_LOG:-info}"
export RUST_BACKTRACE="${RUST_BACKTRACE:-1}"

# Read server.port and server.funnel_path from cascading YAML (local -> prod -> default)
read_yaml_server_val() {
    local key="$1"
    local files=("$ROOT_DIR/config/local.yaml")
    if [ "${PROFILE^^}" = "PROD" ]; then
        files+=("$ROOT_DIR/config/prod.yaml")
    fi
    files+=("$ROOT_DIR/config/default.yaml")
    for f in "${files[@]}"; do
        if [ -f "$f" ]; then
            local val
            val="$(grep -E "^[[:space:]]+${key}:" "$f" | head -n 1 | sed -E "s/^[[:space:]]+${key}:[[:space:]]*//; s/#.*$//; s/^[\"']//; s/[\"'][[:space:]]*$//; s/[[:space:]]*$//")"
            if [ -n "$val" ]; then
                echo "$val"
                return 0
            fi
        fi
    done
}

PORT="${APP__SERVER__PORT:-$(read_yaml_server_val port)}"
PORT="${PORT:-8080}"
FUNNEL_PATH="${TAILSCALE_FUNNEL_PATH:-${APP__SERVER__FUNNEL_PATH:-$(read_yaml_server_val funnel_path)}}"
FUNNEL_PATH="${FUNNEL_PATH:-/}"

# 5. Start in background (stream all stdout/stderr—including panics & exit logs—into journald -> VictoriaLogs)
echo "Starting Scheduler backend in background on port $PORT..."
cd "$ROOT_DIR"
if command -v systemd-cat >/dev/null 2>&1; then
    nohup "$RELEASE_BIN" < /dev/null > >(tee -a "$RUNNER_LOG" | systemd-cat -t scheduler-backend) 2>&1 &
else
    nohup "$RELEASE_BIN" < /dev/null >> "$RUNNER_LOG" 2>&1 &
fi
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PID_FILE"

sleep 1.2

if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "ERROR: Scheduler backend failed to start! Last log lines:"
    tail -n 25 "$RUNNER_LOG"
    rm -f "$PID_FILE"
    exit 1
fi

echo "OK: Scheduler backend started in background (PID $BACKEND_PID) on port $PORT!"
echo "API: http://127.0.0.1:$PORT/api/health"
echo "Log: $RUNNER_LOG"

# 6. Register shared Tailscale Funnel path (from config/prod.yaml -> server.funnel_path) if not already present
# (Never resets existing routes like MusicBot on /, and stop.sh intentionally leaves Funnel intact.)
if command -v tailscale >/dev/null 2>&1; then
    FUNNEL_STATUS="$(tailscale funnel status 2>/dev/null || true)"
    if echo "$FUNNEL_STATUS" | grep -q "${FUNNEL_PATH}.*127\.0\.0\.1:${PORT}"; then
        echo "OK: Tailscale Funnel already serving ${FUNNEL_PATH} -> 127.0.0.1:${PORT}."
    else
        echo "Adding Tailscale Funnel route ${FUNNEL_PATH} -> http://127.0.0.1:${PORT}..."
        if (sudo -n tailscale funnel --bg --yes --https=443 --set-path="$FUNNEL_PATH" "http://127.0.0.1:$PORT" >/dev/null 2>&1 || tailscale funnel --bg --yes --https=443 --set-path="$FUNNEL_PATH" "http://127.0.0.1:$PORT" >/dev/null 2>&1); then
            echo "OK: Tailscale Funnel serving ${FUNNEL_PATH} -> 127.0.0.1:${PORT}."
        else
            echo "WARN: Could not configure Tailscale Funnel automatically (run once: sudo tailscale funnel --bg --yes --https=443 --set-path=${FUNNEL_PATH} http://127.0.0.1:${PORT})."
        fi
    fi
fi
