#!/usr/bin/env bash
# ==============================================================================
# Scheduler Backend Production Build Script (Linux / bash)
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$ROOT_DIR/logs"

echo "=================================================="
echo "   Scheduler Rust Backend Production Build (Linux)"
echo "=================================================="

# Stop running process if running
if [ -f "$ROOT_DIR/scheduler.pid" ]; then
    PID="$(cat "$ROOT_DIR/scheduler.pid" 2>/dev/null || true)"
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "Stopping running Scheduler backend (PID $PID)..."
        kill -15 "$PID" 2>/dev/null || true
        sleep 0.5
    fi
fi

# Load Cargo environment for non-interactive shells
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env" || true
export PATH="$HOME/.cargo/bin:$PATH"

cd "$ROOT_DIR"

if [ "${1:-}" = "-Clean" ] || [ "${1:-}" = "--clean" ]; then
    echo "Cleaning build artifacts..."
    cargo clean
fi

echo "Compiling Rust binary in release mode (--release)..."
cargo build --release

RELEASE_BIN="$ROOT_DIR/target/release/scheduler-backend"
if [ ! -f "$RELEASE_BIN" ]; then
    echo "ERROR: Target binary not found at $RELEASE_BIN"
    exit 1
fi

BIN_SIZE="$(du -h "$RELEASE_BIN" | cut -f1)"
echo "Build complete! Binary size: $BIN_SIZE"
echo "Launch with ./start.sh"
