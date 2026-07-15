# Production Deploy (Bound to Launched Inbox)

Deploy payroll contracts to **live source chain + COTI testnet**, wired to the **canonical Inbox** already in [`deployConfig.json`](../../../pod-ecosystem-integration/deployConfig.json). Does **not** deploy Inbox, MpcExecutor, or Privacy Portal.

Supported source chains:

| Source | Hardhat network | Chain ID | Manifest |
|--------|-----------------|----------|----------|
| Sepolia | `sepolia` (default) | 11155111 | [`deployments/production-payroll-sepolia.json`](../deployments/production-payroll-sepolia.json) (+ legacy `production-payroll.json`) |
| Avalanche Fuji | `avalancheFuji` | 43113 | [`deployments/production-payroll-avalancheFuji.json`](../deployments/production-payroll-avalancheFuji.json) |

`PrivatePayrollCoti` is shared on COTI — Fujis deploy reuses the Sepolia COTI address when present.

## Gate

- `npm run test:testnet` → **35/35** green
- `deployConfig` has inbox + cotiExecutor on both paired chains
- Portal `pUSDC` (preferred) / `pWAVAX` / `pWETH` deployed on source chain

## Prerequisites

```bash
cd ../../../pod-ecosystem-integration
MINER_ADDRESS=$MINER_ADDRESS npm run deploy:full-testnet
# Fuji inbox pair (if not already):
MINER_ADDRESS=$MINER_ADDRESS npm run deploy:full-testnet:avax
```

Env (from PEI `.env`):

- Sepolia: `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY` (or `PRIVATE_KEY`)
- Fuji: `AVALANCHE_FUJI_RPC_URL` (optional), `AVALANCHE_FUJI_PRIVATE_KEY` (falls back to `PRIVATE_KEY`)
- COTI: `COTI_TESTNET_RPC_URL`, `COTI_TESTNET_PRIVATE_KEY`
- Optional overrides: `SOURCE_INBOX`, `COTI_INBOX`, `COTI_MPC_EXECUTOR_ADDRESS`, `PAYROLL_PTOKEN_ADDRESS`, `PRIVATE_PAYROLL_COTI`

## Deploy

```bash
cd sablier-payroll-pod

# Sepolia + COTI
npm run deploy:production

# Avalanche Fuji + COTI
npm run deploy:production:avax
```

From PEI / monorepo root:

```bash
npm run deploy:pod-payroll-port:production        # PEI → Sepolia
npm run deploy:pod-payroll-port:production:avax   # PEI → Fuji
npm run deploy:sablier-payroll-pod:production:avax  # pod-dapp-ports
```

## What gets deployed

| Contract | Chain | Inbox binding |
|----------|-------|---------------|
| `PrivatePayrollCoti` | COTI (7082400) | Reused if already deployed; else `constructor(inboxCoti, owner)` |
| `PayrollVault` | Sepolia / Fuji | `constructor(inboxSource, cotiPayroll)` |
| `PodClaimStore` | Sepolia / Fuji | — |
| `PayrollCampaignFacade` | Sepolia / Fuji | Template campaign; `wirePayroll(vault, claimStore, …)` |

`PayrollVault.configure(0x0, mpcExecutor, 7082400)` sets COTI executor without changing inbox (already set in constructor).

## Artifacts

Per-network manifests under `deployments/`, plus [`deployConfig.json`](../../../pod-ecosystem-integration/deployConfig.json) updated with:

- `chains[11155111|43113].payrollVault`, `payrollClaimStore`, `payrollCampaignFacade`, `privatePayrollCoti`
- `chains[7082400].privatePayrollCoti`

## Verify

```bash
npm run verify:production           # Sepolia + COTI
npm run verify:production:avax      # Fuji (Snowscan) + COTI
```

## Post-deploy

1. Fund `PayrollVault` and facade with native ETH/AVAX for inbox fees
2. Employer seeds corporate treasury via existing Privacy Portal (`pUSDC` deposit)
3. Create campaigns via `freshCampaign` flow or new facade deploys per merkle root
4. Verify on [Cotiscan](https://testnet.cotiscan.io) / [Sepolia](https://sepolia.etherscan.io) / [Snowscan Fuji](https://testnet.snowscan.xyz)

## Test vs production

| | Test harness | Production |
|--|--------------|------------|
| Script | `deploy:testnet` | `deploy:production` / `deploy:production:avax` |
| Source chain | Hardhat surrogate | Live Sepolia or Fuji |
| Portal / pToken | Mock portal + test pToken | `deployConfig.privacyPortalTokens.pUSDC` |
| Inbox | Per-run or reused from harness | **Canonical** Inbox from deployConfig |
