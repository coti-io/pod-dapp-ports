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

# hardhat.config.ts (and everything run through it: deploy.ts, the relayer) loads
# DEVNET_AVAX_PORT/DEVNET_COTI_PORT via dotenv from these same two .env files, in this
# same precedence order (own .env, then pod-ecosystem-integration's). Plain bash doesn't
# know about .env files, so without this a port set only there — not actually exported in
# the shell — would leave this script binding the default port while deploy/relayer connect
# to whatever the .env file says, silently splitting the "one devnet" in two.
read_env_var() {
  local key="$1"
  local f val
  for f in "$ROOT/.env" "$ROOT/../../pod-ecosystem-integration/.env"; do
    if [ -f "$f" ]; then
      val="$(grep -E "^${key}=" "$f" 2>/dev/null | tail -n1 | cut -d'=' -f2-)"
      if [ -n "$val" ]; then
        echo "$val"
        return
      fi
    fi
  done
}

AVAX_PORT="${DEVNET_AVAX_PORT:-$(read_env_var DEVNET_AVAX_PORT)}"
AVAX_PORT="${AVAX_PORT:-8545}"
COTI_PORT="${DEVNET_COTI_PORT:-$(read_env_var DEVNET_COTI_PORT)}"
COTI_PORT="${COTI_PORT:-8546}"

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

# Each node is checked and (re)started independently — if only one is already up
# (e.g. the other crashed), starting both again would try to rebind the live
# node's port (EADDRINUSE) and clobber its pid file with the failed attempt.
need_compile=0
if ! is_running "$STATE_DIR/avax.pid"; then need_compile=1; fi
if ! is_running "$STATE_DIR/coti.pid"; then need_compile=1; fi

if [ "$need_compile" -eq 1 ]; then
  echo "Compiling contracts (avoids a concurrent-compile race between the two nodes)..."
  npm run compile > "$LOG_DIR/compile.log" 2>&1
fi

if is_running "$STATE_DIR/avax.pid"; then
  echo "AVAX-surrogate node already running (pid $(cat "$STATE_DIR/avax.pid"))."
else
  echo "Starting AVAX-surrogate node on 127.0.0.1:$AVAX_PORT..."
  nohup npx hardhat --network hardhat node --port "$AVAX_PORT" --hostname 127.0.0.1 \
    > "$LOG_DIR/avax.log" 2>&1 &
  echo $! > "$STATE_DIR/avax.pid"
  wait_for_rpc "http://127.0.0.1:$AVAX_PORT"
  echo "  ready (pid $(cat "$STATE_DIR/avax.pid"), log: $LOG_DIR/avax.log)"
fi

if is_running "$STATE_DIR/coti.pid"; then
  echo "simCOTI node already running (pid $(cat "$STATE_DIR/coti.pid"))."
else
  echo "Starting simCOTI node on 127.0.0.1:$COTI_PORT..."
  nohup npx hardhat --network simCoti node --port "$COTI_PORT" --hostname 127.0.0.1 \
    > "$LOG_DIR/coti.log" 2>&1 &
  echo $! > "$STATE_DIR/coti.pid"
  wait_for_rpc "http://127.0.0.1:$COTI_PORT"
  echo "  ready (pid $(cat "$STATE_DIR/coti.pid"), log: $LOG_DIR/coti.log)"
fi

echo ""
echo "Devnet up. Next: npm run devnet:deploy"
