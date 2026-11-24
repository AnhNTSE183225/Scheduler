#!/usr/bin/env bash
# ==============================================================================
# Fast Production Runner (Bash / Linux / macOS)
# ==============================================================================

set -euo pipefail

BACKGROUND=0
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

for arg in "$@"; do
    case "$arg" in
        --background|-d) BACKGROUND=1 ;;
    esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.pids"
STOP_SCRIPT="$ROOT_DIR/stop.sh"
BUILD_SCRIPT="$ROOT_DIR/build.sh"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_INDEX="$FRONTEND_DIR/dist/index.html"

find_backend_bin() {
    find "$BACKEND_DIR/target/release" -maxdepth 1 -type f -executable \
        ! -name "*.d" ! -name "*.so" ! -name "build-script-*" 2>/dev/null | head -n 1
}

if [ -f "$STOP_SCRIPT" ]; then
    bash "$STOP_SCRIPT" --quiet || true
fi

BACKEND_BIN="$(find_backend_bin || true)"
if [ ! -f "$FRONTEND_INDEX" ] || [ -z "$BACKEND_BIN" ] || [ ! -f "$BACKEND_BIN" ]; then
    bash "$BUILD_SCRIPT"
    BACKEND_BIN="$(find_backend_bin)"
fi

export RUST_LOG="${RUST_LOG:-info}"
export LOG_FORMAT="json"
export RUST_BACKTRACE="1"
export APP__SERVER__PORT="$BACKEND_PORT"

if [ "$BACKGROUND" -eq 1 ]; then
    (cd "$BACKEND_DIR" && nohup "$BACKEND_BIN" > "$ROOT_DIR/.backend.log" 2>&1 &)
    sleep 0.1
    BACKEND_PID=$(pgrep -f "$BACKEND_BIN" | head -n 1 || true)

    (cd "$FRONTEND_DIR" && nohup pnpm run preview -- --port "$FRONTEND_PORT" --host > "$ROOT_DIR/.frontend.log" 2>&1 &)
    sleep 0.2
    FRONTEND_PID=$(lsof -ti :"$FRONTEND_PORT" 2>/dev/null | head -n 1 || true)

    cat > "$PID_FILE" <<EOF
BACKEND_PID=$BACKEND_PID
FRONTEND_PID=$FRONTEND_PID
BACKEND_PORT=$BACKEND_PORT
FRONTEND_PORT=$FRONTEND_PORT
STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
    echo "Application running in background! Open: http://localhost:$FRONTEND_PORT"
    exit 0
fi

(cd "$BACKEND_DIR" && exec "$BACKEND_BIN") 2>&1 | sed 's/^/[Backend] /' &
BACKEND_PID=$!

(cd "$FRONTEND_DIR" && exec pnpm run preview -- --port "$FRONTEND_PORT" --host) 2>&1 | sed 's/^/[Frontend] /' &
FRONTEND_PID=$!

cat > "$PID_FILE" <<EOF
BACKEND_PID=$BACKEND_PID
FRONTEND_PID=$FRONTEND_PID
BACKEND_PORT=$BACKEND_PORT
FRONTEND_PORT=$FRONTEND_PORT
STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

cleanup() {
    [ -f "$STOP_SCRIPT" ] && bash "$STOP_SCRIPT" || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:$FRONTEND_PORT" >/dev/null 2>&1; then
        break
    fi
    sleep 0.1
done

echo "Application is ready! Open http://localhost:$FRONTEND_PORT"
wait
