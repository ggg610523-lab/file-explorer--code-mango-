#!/bin/bash
set -e
cd "$(dirname "$0")"

# Usage:
#   ./run.sh              -> run the Tauri build (default)
#   ./run.sh --dev        -> run in dev mode with hot reload
#   ./run.sh --build      -> force rebuild

if [ "$1" = "--dev" ]; then
  exec pnpm tauri:dev
fi

# Production mode
BIN="./src-tauri/target/release/file-explorer"
if [ ! -x "$BIN" ] || [ "$1" = "--build" ]; then
  echo "Building Tauri..."
  pnpm tauri:build
fi
exec "$BIN" "$@"
