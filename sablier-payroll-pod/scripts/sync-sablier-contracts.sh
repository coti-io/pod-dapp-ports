#!/usr/bin/env bash
# Copy Phase 1 harness for S22+ native comparison tests.
set -euo pipefail
bash "$(dirname "$0")/../../sablier-payroll/scripts/sync-contracts.sh" \
  "$(cd "$(dirname "$0")/.." && pwd)/contracts/sablier-payroll"
