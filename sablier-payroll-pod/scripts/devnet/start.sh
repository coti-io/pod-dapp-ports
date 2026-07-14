#!/usr/bin/env bash
# Start the persistent local devnet: two long-running `hardhat node` processes
# (AVAX surrogate + simCOTI) that a browser wallet / UI can connect to over
# plain JSON-RPC. Mirrors connectDualChainForTests's "node" mode
# (pod-ecosystem-integration/test/sim-coti/sim-coti-utils.ts) but keeps the
# nodes alive after this script exits, instead of tearing them down per test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

STATE_DIR="$ROOT/.devnet"
LOG_DIR="$STATE_DIR/logs"
mkdir -p "$LOG_DIR"

AVAX_PORT="${DEVNET_AVAX_PORT:-8545}"
COTI_PORT="${DEVNET_COTI_PORT:-8546}"

wait_for_rpc() {
  local url="$1"
  local deadline=$(( $(date +%s) + 60 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -s -X POST -H 'content-type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
        "$url" 2>/dev/null | grep -q '"result"'; then
      return 0
    fi
    sleep 0.5
  done
  echo "error: RPC not ready at $url after 60s (see $LOG_DIR)" >&2
  return 1
}

is_running() {
  local pidfile="$1"
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

if is_running "$STATE_DIR/avax.pid" && is_running "$STATE_DIR/coti.pid"; then
  echo "Devnet already running (avax pid $(cat "$STATE_DIR/avax.pid"), coti pid $(cat "$STATE_DIR/coti.pid"))."
  exit 0
fi

echo "Compiling contracts (avoids a concurrent-compile race between the two nodes)..."
npm run compile > "$LOG_DIR/compile.log" 2>&1

echo "Starting AVAX-surrogate node on 127.0.0.1:$AVAX_PORT..."
nohup npx hardhat --network hardhat node --port "$AVAX_PORT" --hostname 127.0.0.1 \
  > "$LOG_DIR/avax.log" 2>&1 &
echo $! > "$STATE_DIR/avax.pid"
wait_for_rpc "http://127.0.0.1:$AVAX_PORT"
echo "  ready (pid $(cat "$STATE_DIR/avax.pid"), log: $LOG_DIR/avax.log)"

echo "Starting simCOTI node on 127.0.0.1:$COTI_PORT..."
nohup npx hardhat --network simCoti node --port "$COTI_PORT" --hostname 127.0.0.1 \
  > "$LOG_DIR/coti.log" 2>&1 &
echo $! > "$STATE_DIR/coti.pid"
wait_for_rpc "http://127.0.0.1:$COTI_PORT"
echo "  ready (pid $(cat "$STATE_DIR/coti.pid"), log: $LOG_DIR/coti.log)"

echo ""
echo "Devnet up. Next: npm run devnet:deploy"
