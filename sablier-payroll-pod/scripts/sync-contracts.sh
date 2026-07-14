#!/usr/bin/env bash
# Sync contracts-src → contracts/sablier-payroll-pod for Hardhat compile (after link:contracts).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/contracts-src"
DST="$ROOT/contracts/sablier-payroll-pod"
if [[ ! -d "$SRC/avax" ]]; then
  echo "error: missing $SRC (port Solidity sources)" >&2
  exit 1
fi
if [[ ! -d "$ROOT/contracts/pod" ]]; then
  echo "error: run npm run link:contracts first" >&2
  exit 1
fi
rm -rf "$DST"
mkdir -p "$DST"/{avax,coti,mocks}
cp "$SRC/avax/"*.sol "$DST/avax/"
cp "$SRC/coti/"*.sol "$DST/coti/"
cp "$SRC/mocks/"*.sol "$DST/mocks/"
echo "Synced sablier-payroll-pod contracts to $DST"
