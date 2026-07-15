# Production Deploy (Bound to Launched Inbox)

Deploy payroll contracts to **live Sepolia + COTI testnet**, wired to the **canonical Inbox** already in [`deployConfig.json`](../../../pod-ecosystem-integration/deployConfig.json). Does **not** deploy Inbox, MpcExecutor, or Privacy Portal.

## Gate

- `npm run test:testnet` → **35/35** green
- `deployConfig` has inbox + cotiExecutor on both paired chains
- Portal `pUSDC` or `pWETH` deployed on source chain

## Prerequisites

```bash
cd ../../../pod-ecosystem-integration
MINER_ADDRESS=$MINER_ADDRESS npm run deploy:full-testnet
# Portal tokens (if missing):
npm run deploy:privacy:source-portal   # per token
```

Env (from `.env`):

- `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY`
- `COTI_TESTNET_RPC_URL`, `COTI_TESTNET_PRIVATE_KEY`
- Optional overrides: `SOURCE_INBOX`, `COTI_INBOX`, `COTI_MPC_EXECUTOR_ADDRESS`, `PAYROLL_PTOKEN_ADDRESS`

## Deploy

```bash
cd sablier-payroll-pod
npm run deploy:production
```

Or from PEI:

```bash
npm run deploy:pod-payroll-port:production
```

For Fuji source chain:

```bash
SOURCE_NETWORK=avalancheFuji npm run deploy:production
```

## What gets deployed

| Contract | Chain | Inbox binding |
|----------|-------|---------------|
| `PrivatePayrollCoti` | COTI (7082400) | `constructor(inboxCoti, owner)` from deployConfig |
| `PayrollVault` | Sepolia/Fuji | `constructor(inboxSource, cotiPayroll)` |
| `PodClaimStore` | Sepolia/Fuji | — |
| `PayrollCampaignFacade` | Sepolia/Fuji | Template campaign; `wirePayroll(vault, claimStore, …)` |

`PayrollVault.configure(0x0, mpcExecutor, 7082400)` sets COTI executor without changing inbox (already set in constructor).

## Artifacts

- [`deployments/production-payroll.json`](../deployments/production-payroll.json) — full wiring manifest
- [`deployConfig.json`](../../../pod-ecosystem-integration/deployConfig.json) — updated with:
  - `chains[11155111].payrollVault`, `payrollClaimStore`, `payrollCampaignFacade`, `privatePayrollCoti`
  - `chains[7082400].privatePayrollCoti`

## Post-deploy

1. Fund `PayrollVault` and facade with native ETH/COTI for inbox fees
2. Employer seeds corporate treasury via existing Privacy Portal (`pUSDC` deposit)
3. Create campaigns via `freshCampaign` flow or new facade deploys per merkle root
4. Verify on [Cotiscan](https://testnet.cotiscan.io) / Sepolia explorer

## Test vs production

| | Test harness | Production |
|--|--------------|------------|
| Script | `deploy:testnet` | `deploy:production` |
| Source chain | Hardhat surrogate | Live Sepolia/Fuji |
| Portal / pToken | Mock portal + test pToken | `deployConfig.privacyPortalTokens.pUSDC` |
| Inbox | Per-run or reused from harness | **Canonical** `0xAb625…` |
