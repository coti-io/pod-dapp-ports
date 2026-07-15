#!/usr/bin/env bash
# Copy prebuilt artifacts from pod-ecosystem-integration when local solc compile OOMs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PEI="$(cd "$ROOT/../../pod-ecosystem-integration" && pwd)"
ART="$ROOT/artifacts/contracts"

mkdir -p "$ART"

copy_tree() {
  local src="$1" dst="$2"
  if [[ -d "$PEI/artifacts/contracts/$src" ]]; then
    mkdir -p "$ART/$dst"
    cp -a "$PEI/artifacts/contracts/$src/." "$ART/$dst/"
    echo "  artifacts: $src -> $dst"
  fi
}

echo "[sync-artifacts] Copying from $PEI"

# Payroll port (legacy path in PEI artifacts)
copy_tree "pod-payroll-port" "sablier-payroll-pod"
copy_tree "sablier-payroll" "sablier-payroll"

# Shared PoD stack
for dir in Inbox.sol IInbox.sol pod fee utils mocks disperse simCOTI; do
  if [[ -d "$PEI/artifacts/contracts/$dir" ]] || [[ -f "$PEI/artifacts/contracts/$dir" ]]; then
    mkdir -p "$ART/$(dirname "$dir")"
    cp -a "$PEI/artifacts/contracts/$dir" "$ART/$(dirname "$dir")/" 2>/dev/null || cp -a "$PEI/artifacts/contracts/$dir" "$ART/" 2>/dev/null || true
  fi
done

# Full pod tree
if [[ -d "$PEI/artifacts/contracts/pod" ]]; then
  mkdir -p "$ART/pod"
  cp -a "$PEI/artifacts/contracts/pod/." "$ART/pod/"
  echo "  artifacts: pod/*"
fi

if [[ -d "$PEI/artifacts/contracts/simCOTI" ]]; then
  mkdir -p "$ART/simCOTI"
  cp -a "$PEI/artifacts/contracts/simCOTI/." "$ART/simCOTI/"
  echo "  artifacts: simCOTI/*"
fi

echo "[sync-artifacts] Done -> $ART"
