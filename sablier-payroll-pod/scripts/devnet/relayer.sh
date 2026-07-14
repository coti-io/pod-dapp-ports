#!/usr/bin/env bash
# Start the background relayer (scripts/devnet/relayer.ts) as a persistent process.
# Requires: devnet nodes running (start.sh) and a deployment (npm run devnet:deploy).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

STATE_DIR="$ROOT/.devnet"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$LOG_DIR"

if [ -f "$STATE_DIR/relayer.pid" ] && kill -0 "$(cat "$STATE_DIR/relayer.pid")" 2>/dev/null; then
  echo "Relayer already running (pid $(cat "$STATE_DIR/relayer.pid"))."
  exit 0
fi

if [ ! -f "$ROOT/deployments/local-devnet.json" ]; then
  echo "error: no deployments/local-devnet.json — run 'npm run devnet:deploy' first" >&2
  exit 1
fi

nohup npx hardhat run scripts/devnet/relayer.ts > "$LOG_DIR/relayer.log" 2>&1 &
echo $! > "$STATE_DIR/relayer.pid"
echo "Relayer started (pid $(cat "$STATE_DIR/relayer.pid"), log: $LOG_DIR/relayer.log)"
