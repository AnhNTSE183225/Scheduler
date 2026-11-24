#!/usr/bin/env bash
# ==============================================================================
# Zero-Assumption Production Build Script (Bash / Linux / macOS)
# ==============================================================================

set -euo pipefail

CLEAN=0
SKIP_FRONTEND=0
SKIP_BACKEND=0

for arg in "$@"; do
    case "$arg" in
        --clean)          CLEAN=1 ;;
        --skip-frontend)  SKIP_FRONTEND=1 ;;
        --skip-backend)   SKIP_BACKEND=1 ;;
    esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
STOP_SCRIPT="$ROOT_DIR/stop.sh"

[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/pnpm:$PATH"

throw_missing_dep() {
    local dep_name="$1" purpose="$2" download_url="$3" install_cmd="$4"
    echo ""
    echo "=================================================================="
    echo " [ERROR] FATAL: MISSING REQUIRED BUILD ENVIRONMENT DEPENDENCY"
    echo "=================================================================="
    echo "  Missing Component : $dep_name"
    echo "  Required For      : $purpose"
    echo "  Download URL      : $download_url"
    echo "  Manual Command    : $install_cmd"
    echo "=================================================================="
    exit 1
}

try_pkg_install() {
    local apt_pkgs="$1" dnf_pkgs="$2" pacman_pkgs="$3"
    if ! command -v sudo &>/dev/null; then return 1; fi
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -y && sudo apt-get install -y $apt_pkgs && return 0
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y $dnf_pkgs && return 0
    elif command -v pacman &>/dev/null; then
        sudo pacman -Sy --noconfirm $pacman_pkgs && return 0
    fi
    return 1
}

echo "[Phase 0] Running Zero-Assumption Toolchain Checklist..."

if ! command -v curl &>/dev/null || ! command -v git &>/dev/null; then
    try_pkg_install "curl git ca-certificates" "curl git ca-certificates" "curl git ca-certificates" || true
    if ! command -v curl &>/dev/null || ! command -v git &>/dev/null; then
        throw_missing_dep "curl & git" "Fetching toolchains and repository dependencies" "https://git-scm.com/downloads" "sudo apt update && sudo apt install -y curl git"
    fi
fi

if [ "$SKIP_BACKEND" -eq 0 ] && [ -d "$BACKEND_DIR" ]; then
    if ! command -v cc &>/dev/null || ! command -v pkg-config &>/dev/null; then
        try_pkg_install "build-essential pkg-config libssl-dev" "gcc gcc-c++ make pkgconfig openssl-devel" "base-devel pkgconf openssl" || true
        if ! command -v cc &>/dev/null || ! command -v pkg-config &>/dev/null; then
            throw_missing_dep "C Compiler / Linker" "Linking native Rust executables" "https://doc.rust-lang.org/book/ch01-01-installation.html" "sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev"
        fi
    fi

    if ! command -v cargo &>/dev/null || ! command -v rustc &>/dev/null; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y || true
        [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
        export PATH="$HOME/.cargo/bin:$PATH"
        if ! command -v cargo &>/dev/null || ! command -v rustc &>/dev/null; then
            throw_missing_dep "Rust Toolchain" "Compiling Rust backend (--release)" "https://rustup.rs/" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
        fi
    fi
fi

if [ "$SKIP_FRONTEND" -eq 0 ] && [ -d "$FRONTEND_DIR" ]; then
    if ! command -v node &>/dev/null; then
        try_pkg_install "nodejs npm" "nodejs npm" "nodejs npm" || true
        if ! command -v node &>/dev/null; then
            throw_missing_dep "Node.js LTS" "Compiling TypeScript and bundling SolidJS/Vite" "https://nodejs.org/" "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs"
        fi
    fi

    if ! command -v pnpm &>/dev/null; then
        if command -v corepack &>/dev/null; then
            corepack enable 2>/dev/null || sudo corepack enable 2>/dev/null || true
            corepack prepare pnpm@latest --activate 2>/dev/null || true
        fi
        if ! command -v pnpm &>/dev/null && command -v npm &>/dev/null; then
            npm install -g pnpm 2>/dev/null || sudo npm install -g pnpm 2>/dev/null || true
        fi
        if ! command -v pnpm &>/dev/null; then
            throw_missing_dep "pnpm" "Frontend dependency locking and bundling" "https://pnpm.io/installation" "sudo corepack enable && corepack prepare pnpm@latest --activate"
        fi
    fi
fi

if [ -f "$STOP_SCRIPT" ]; then
    bash "$STOP_SCRIPT" --quiet || true
fi

if [ "$CLEAN" -eq 1 ]; then
    rm -rf "$FRONTEND_DIR/dist"
fi

if [ "$SKIP_FRONTEND" -eq 0 ] && [ -d "$FRONTEND_DIR" ]; then
    echo "[Phase 3] Building Frontend..."
    cd "$FRONTEND_DIR"
    if [ "$CLEAN" -eq 1 ] || [ ! -d "node_modules" ]; then
        pnpm install --frozen-lockfile || pnpm install
    fi
    pnpm run build
    [ -f "$FRONTEND_DIR/dist/index.html" ] || { echo "Frontend dist/index.html missing"; exit 1; }
fi

if [ "$SKIP_BACKEND" -eq 0 ] && [ -d "$BACKEND_DIR" ]; then
    echo "[Phase 4] Building Backend (--release)..."
    cd "$BACKEND_DIR"
    [ "$CLEAN" -eq 1 ] && cargo clean
    cargo build --release
fi

echo "Production build completed successfully."
