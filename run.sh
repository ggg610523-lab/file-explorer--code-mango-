#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d dist/renderer ] || [ "$1" = "--build" ]; then
  echo "Building..."
  export PATH="/tmp/node-v20.18.0-linux-x64/bin:$PATH"
  npx webpack --config webpack.config.js --mode development 2>&1 | tail -5
  cp -r src/renderer/reversal-icons dist/renderer/reversal-icons 2>/dev/null || true
fi

ELECTRON="${ELECTRON:-node_modules/.bin/electron}"
exec "$ELECTRON" . "$@"
