#!/usr/bin/env bash
# Retry payroll system e2e against live COTI, reusing cached COTI inbox/executor/mother.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MAX_ATTEMPTS="${E2E_MAX_ATTEMPTS:-8}"
export COTI_BACKEND=testnet
export PAYROLL_SYSTEM_E2E=1
export COTI_REUSE_CONTRACTS=true
export COTI_REUSE_ALLOW_FRESH_HARDHAT=1
export COTI_MINE_GAS_MPC_256="${COTI_MINE_GAS_MPC_256:-80000000}"
export COTI_MINE_GAS_POD_TOKEN="${COTI_MINE_GAS_POD_TOKEN:-80000000}"
export COTI_REGISTER_LEAF_GAS="${COTI_REGISTER_LEAF_GAS:-8000000}"

echo "[e2e-retry] max attempts=$MAX_ATTEMPTS (reuse COTI via deployments/e2e-testnet-cache.json)"

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  echo ""
  echo "========== e2e testnet attempt $i / $MAX_ATTEMPTS =========="
  # Fresh Hardhat restarts outbound nonces at 1. Reused COTI inbox requires contiguous
  # nonces per sourceChainId — so each attempt uses a unique Hardhat chain id.
  export HARDHAT_CHAIN_ID=$((313370000 + i * 1000 + RANDOM % 900))
  echo "[e2e-retry] HARDHAT_CHAIN_ID=$HARDHAT_CHAIN_ID (unique source chain for COTI nonce space)"

  if [ -f deployments/e2e-testnet-cache.json ]; then
    echo "[e2e-retry] cache:"
    cat deployments/e2e-testnet-cache.json
  else
    echo "[e2e-retry] no cache yet — first run deploys COTI inbox/executor/mother"
  fi

  set +e
  npx hardhat test --no-compile test/runner-e2e-testnet.ts 2>&1 | tee "/tmp/payroll-e2e-testnet-$i.log"
  code=${PIPESTATUS[0]}
  set -e

  if rg -q "5 passing" "/tmp/payroll-e2e-testnet-$i.log"; then
    echo "[e2e-retry] SUCCESS on attempt $i"
    exit 0
  fi

  passing=$(rg -o '[0-9]+ passing' "/tmp/payroll-e2e-testnet-$i.log" | tail -1 || true)
  failing=$(rg -o '[0-9]+ failing' "/tmp/payroll-e2e-testnet-$i.log" | tail -1 || true)
  echo "[e2e-retry] attempt $i exit=$code $passing $failing — sleeping 8s"
  sleep 8
done

echo "[e2e-retry] FAILED after $MAX_ATTEMPTS attempts"
exit 1
