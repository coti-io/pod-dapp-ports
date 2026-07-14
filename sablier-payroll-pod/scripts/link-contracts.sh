#!/usr/bin/env bash
# Mirror sibling repos into contracts/ for Hardhat (inbox + pod + simCOTI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="${ROOT}/contracts"
INBOX="${ROOT}/../../coti-pod-inbox-contracts/contracts"
POD="${ROOT}/../../coti-contracts/contracts/pod"
MPC_SRC="${ROOT}/../../pod-mpc-lib/contracts/utils/mpc"
MPC_EXECUTOR_SRC="${ROOT}/../../pod-mpc-lib/contracts/mpc/coti-side/MpcExecutor.sol"

if [[ ! -d "$INBOX" || ! -d "$POD" ]]; then
  echo "error: clone coti-pod-inbox-contracts and coti-contracts as siblings of pod-dapp-ports" >&2
  exit 1
fi

rm -rf "$CONTRACTS"
mkdir -p "$CONTRACTS"

rsync -a \
  --exclude 'utils/' \
  "$INBOX/" "$CONTRACTS/"

rsync -a "$POD/" "$CONTRACTS/pod/"

mkdir -p "$CONTRACTS/utils/mpc"
if [[ -d "$MPC_SRC" ]]; then
  rsync -a "$MPC_SRC/" "$CONTRACTS/utils/mpc/"
else
  rsync -a "${ROOT}/../../coti-contracts/contracts/utils/mpc/" "$CONTRACTS/utils/mpc/"
fi

if [[ -f "$MPC_EXECUTOR_SRC" ]]; then
  mkdir -p "$CONTRACTS/pod/mpc/coti-side"
  sed \
    's|import "../../utils/mpc/MpcCore.sol"|import "../../../utils/mpc/MpcCore.sol"|' \
    "$MPC_EXECUTOR_SRC" > "$CONTRACTS/pod/mpc/coti-side/MpcExecutor.sol"
  echo "  mpc:   ${MPC_EXECUTOR_SRC} -> pod/mpc/coti-side/MpcExecutor.sol"

  MPC_COTI_SIDE="${ROOT}/../../pod-mpc-lib/contracts/mpc/coti-side"
  for f in MpcExecutorCotiProxyInbox.sol MpcExecutorCotiTest.sol; do
    if [[ -f "${MPC_COTI_SIDE}/${f}" ]]; then
      sed \
        -e 's|import "../../utils/mpc/MpcCore.sol"|import "../../../utils/mpc/MpcCore.sol"|' \
        "${MPC_COTI_SIDE}/${f}" > "$CONTRACTS/pod/mpc/coti-side/${f}"
      echo "  mpc:   ${MPC_COTI_SIDE}/${f} -> pod/mpc/coti-side/${f}"
    fi
  done
fi

SIM_PKG="${ROOT}/node_modules/@coti-io/sim-coti-node/contracts"
if [[ -d "$SIM_PKG" ]]; then
  mkdir -p "$CONTRACTS/simCOTI"
  rsync -a \
    --exclude 'test/' \
    "$SIM_PKG/" "$CONTRACTS/simCOTI/"
  mkdir -p "$CONTRACTS/simCOTI/test"
  if [[ -f "${SIM_PKG}/test/SimSmokeHarness.sol" ]]; then
    rsync -a "${SIM_PKG}/test/" "$CONTRACTS/simCOTI/test/"
  fi
  echo "  sim:   ${SIM_PKG} -> contracts/simCOTI/"
fi

echo "Mirrored contracts -> ${CONTRACTS}/"
