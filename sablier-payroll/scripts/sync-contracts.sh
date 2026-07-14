#!/usr/bin/env bash
# Copy contracts into a consumer repo's Hardhat sources (e.g. pod-ecosystem-integration).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/contracts"
DST="${1:-${ROOT}/../pod-ecosystem-integration/contracts/sablier-payroll}"
rm -rf "$DST"
mkdir -p "$DST/mocks"
cp "$SRC/SablierMerkleInstantHarness.sol" "$DST/"
cp "$SRC/mocks/"*.sol "$DST/mocks/"
echo "Synced sablier contracts to $DST"
