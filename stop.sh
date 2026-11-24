#!/usr/bin/env bash
# ==============================================================================
# Deterministic PID Stop Script (Bash / Linux / macOS)
# ==============================================================================

set -euo pipefail

QUIET=0
for arg in "$@"; do
    case "$arg" in
        --quiet|-q) QUIET=1 ;;
    esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.pids"
FALLBACK_PORTS=(8080 5173)

log_msg() {
    [ "$QUIET" -eq 0 ] && echo "$1"
}

stop_pid_tree() {
    local target_pid="$1" label="$2"
    if [ -z "$target_pid" ] || [ "$target_pid" -le 1 ] 2>/dev/null; then return 1; fi
    if ! kill -0 "$target_pid" 2>/dev/null; then return 1; fi
    log_msg "  [$label] Stopping PID $target_pid..."
    pkill -TERM -P "$target_pid" 2>/dev/null || true
    kill -TERM "$target_pid" 2>/dev/null || true
    sleep 0.2
    if kill -0 "$target_pid" 2>/dev/null; then
        pkill -KILL -P "$target_pid" 2>/dev/null || true
        kill -KILL "$target_pid" 2>/dev/null || true
    fi
    return 0
}

STOPPED_ANY=0

if [ -f "$PID_FILE" ]; then
    # shellcheck disable=SC1090
    source "$PID_FILE" || true
    [ -n "${FRONTEND_PID:-}" ] && stop_pid_tree "$FRONTEND_PID" "Frontend" && STOPPED_ANY=1 || true
    [ -n "${BACKEND_PID:-}" ] && stop_pid_tree "$BACKEND_PID" "Backend" && STOPPED_ANY=1 || true
    [ -n "${BACKEND_PORT:-}" ] && FALLBACK_PORTS+=("$BACKEND_PORT")
    [ -n "${FRONTEND_PORT:-}" ] && FALLBACK_PORTS+=("$FRONTEND_PORT")
    rm -f "$PID_FILE"
fi

if command -v lsof &>/dev/null; then
    for port in "${FALLBACK_PORTS[@]}"; do
        pids=$(lsof -ti :"$port" 2>/dev/null || true)
        for pid in $pids; do
            stop_pid_tree "$pid" "Port $port" && STOPPED_ANY=1 || true
        done
    done
fi

[ "$STOPPED_ANY" -eq 1 ] && log_msg "All application services stopped." || log_msg "No active application services running."
