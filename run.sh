#!/bin/bash
set -e
cd "$(dirname "$0")"

# Usage:
#   ./run.sh              -> run the Tauri build (default)
#   ./run.sh --electron   -> run the legacy Electron build
#   ./run.sh --build      -> force rebuild of the frontend bundle

if [ "$1" = "--electron" ]; then
  if [ ! -d dist/renderer ] || [ "$2" = "--build" ]; then
    echo "Building..."
    npx webpack --config webpack.config.js --mode development 2>&1 | tail -5
    cp -r src/renderer/reversal-icons dist/renderer/reversal-icons 2>/dev/null || true
  fi
  ELECTRON="${ELECTRON:-node_modules/.bin/electron}"
  exec "$ELECTRON" . "$@"
fi

# Tauri mode (default)
if [ ! -f dist/renderer/index.html ] || [ "$1" = "--build" ]; then
  echo "Building renderer (production/minified)..."
  NODE_ENV=production node build-tauri-renderer.js
  cp -r src/renderer/reversal-icons dist/renderer/reversal-icons 2>/dev/null || true
fi
# Prefer the optimized release binary if present (much faster than debug);
# fall back to the debug build for quick iteration.
BIN="./src-tauri/target/release/file-explorer"
if [ ! -x "$BIN" ]; then
  BIN="./src-tauri/target/debug/file-explorer"
  if [ ! -x "$BIN" ] || [ "$1" = "--build" ]; then
    echo "Building Tauri backend (first run takes a few minutes)..."
    (cd src-tauri && cargo build)
  fi
fi
exec "$BIN" "$@"
