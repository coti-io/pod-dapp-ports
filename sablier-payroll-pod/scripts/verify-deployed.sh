#!/usr/bin/env bash
# Verify production payroll contracts on Sepolia + COTI explorers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY="${ROOT}/deployments/production-payroll.json"
INBOX="0xAb625bE229F603f6BBF964474AFf6d5487e364De"
OWNER="0xdF9F8FcA4591227C092FCBAb45A846C19fb6d1ae"

COTI=$(python3 -c "import json; print(json.load(open('$DEPLOY'))['privatePayrollCoti'])")
VAULT=$(python3 -c "import json; print(json.load(open('$DEPLOY'))['payrollVault'])")
CLAIM=$(python3 -c "import json; print(json.load(open('$DEPLOY'))['payrollClaimStore'])")
FACADE=$(python3 -c "import json; print(json.load(open('$DEPLOY'))['payrollCampaignFacade'])")
COMP=$(python3 -c "import json; print(json.load(open('$DEPLOY'))['comptroller'])")

verify() {
  local network="$1"; shift
  echo ""
  echo "=== verify --network $network $* ==="
  npx hardhat verify --network "$network" "$@" || true
}

# Align HH sourceName (pod-payroll-port) with synced artifacts
mkdir -p artifacts/contracts/pod-payroll-port
rsync -a artifacts/contracts/sablier-payroll-pod/ artifacts/contracts/pod-payroll-port/
[[ -e contracts/pod-payroll-port ]] || ln -sfn sablier-payroll-pod contracts/pod-payroll-port

verify sepolia \
  --contract contracts/pod-payroll-port/avax/PayrollVault.sol:PayrollVault \
  "$VAULT" "$INBOX" "$COTI"

verify sepolia \
  --contract contracts/pod-payroll-port/avax/PodClaimStore.sol:PodClaimStore \
  "$CLAIM"

verify sepolia \
  --contract contracts/pod-payroll-port/mocks/MockSablierComptroller.sol:MockSablierComptroller \
  "$COMP" 0

verify sepolia \
  --contract contracts/pod-payroll-port/avax/PayrollCampaignFacade.sol:PayrollCampaignFacade \
  --constructor-args-path scripts/verify-args/facade.cjs \
  "$FACADE"

echo ""
echo "=== COTI PrivatePayrollCoti via Blockscout standard-json ==="
# PrivatePayrollCoti was Paris-compiled outside Hardhat; submit solc standard-json if present.
if [[ -f /tmp/payroll-coti-out.json && -f /tmp/payroll-coti-input.json ]]; then
  python3 <<PY
import json, urllib.request, urllib.parse
inp=json.load(open("/tmp/payroll-coti-input.json"))
# Blockscout sourcify/standard-json verify
payload={
  "addressHash": "$COTI",
  "name": "PrivatePayrollCoti",
  "compilerVersion": "v0.8.28+commit.7893614a",
  "optimization": True,
  "optimizationRuns": 10,
  "evmVersion": "paris",
  "sourceCode": json.dumps(inp),
  "contractInterface": "",
  "constructorArguments": "",
  "autodetectConstructorArguments": True,
}
# Prefer Solidity-standard-json-input mode used by Blockscout
form={
  "module": "contract",
  "action": "verifysourcecode",
  "contractaddress": "$COTI",
  "codeformat": "solidity-standard-json-input",
  "contractname": "sablier-payroll-pod/coti/PrivatePayrollCoti.sol:PrivatePayrollCoti",
  "compilerversion": "v0.8.28+commit.7893614a",
  "sourceCode": json.dumps(inp),
  "constructorArguements":  # blockscout typo historically
    "000000000000000000000000ab625be229f603f6bbf964474aff6d5487e364de"
    "000000000000000000000000df9f8fca4591227c092fcbab45a846c19fb6d1ae",
}
# Try etherscan-compatible endpoint
data=urllib.parse.urlencode(form).encode()
req=urllib.request.Request("https://testnet.cotiscan.io/api", data=data, method="POST")
try:
  with urllib.request.urlopen(req, timeout=120) as r:
    print(r.read().decode()[:2000])
except Exception as e:
  print("Blockscout API error:", e)
PY
else
  echo "Missing /tmp/payroll-coti-*.json — trying hardhat verify on cotiTestnet"
  verify cotiTestnet \
    --contract contracts/pod-payroll-port/coti/PrivatePayrollCoti.sol:PrivatePayrollCoti \
    "$COTI" "$INBOX" "$OWNER"
fi

echo ""
echo "Done. Explorer links:"
echo "  Sepolia vault:   https://sepolia.etherscan.io/address/$VAULT#code"
echo "  Sepolia claim:   https://sepolia.etherscan.io/address/$CLAIM#code"
echo "  Sepolia facade:  https://sepolia.etherscan.io/address/$FACADE#code"
echo "  Sepolia compt:   https://sepolia.etherscan.io/address/$COMP#code"
echo "  COTI payroll:    https://testnet.cotiscan.io/address/$COTI#code"
