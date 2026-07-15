#!/usr/bin/env bash
# Verify production payroll contracts on Sepolia (Etherscan) + COTI (Cotiscan).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 scripts/verify-production.py
