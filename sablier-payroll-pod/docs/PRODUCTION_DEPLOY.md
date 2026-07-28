# Production Deploy (Bound to Launched Inbox)

> **HISTORICAL / DO NOT USE — Sepolia payroll**  
> [`production-payroll-sepolia.json`](../deployments/production-payroll-sepolia.json) (and alias [`production-payroll.json`](../deployments/production-payroll.json)) still point at legacy Inbox `0xAb625bE229F603f6BBF964474AFf6d5487e364De` (pre–v2.2). Do not attach live E2E or fund against that stack.  
> **Current source of truth:** Avalanche Fuji — [`production-payroll-avalancheFuji.json`](../deployments/production-payroll-avalancheFuji.json) (v2.2 Inbox per `deployConfig`). Prefer `npm run deploy:fuji-coti` / `test:e2e:live:fuji`.

Deploy payroll contracts to **live source chain + COTI testnet**, wired to the **canonical Inbox** already in [`deployConfig.json`](../../../pod-ecosystem-integration/deployConfig.json). Does **not** deploy Inbox, MpcExecutor, or Privacy Portal.

**Iteration 08:** Fuji facades must **not** call local `MpcCore` / `0x64`. Encrypted pool lives on `PrivatePayrollCoti` (`creditPool` / `verifyAndCredit`). Prefer **`npm run deploy:fuji-coti`** for a forced fresh Fuji+COTI stack.

Supported source chains:

| Source | Hardhat network | Chain ID | Manifest |
|--------|-----------------|----------|----------|
| Avalanche Fuji (**current SoT**) | `avalancheFuji` | 43113 | [`deployments/production-payroll-avalancheFuji.json`](../deployments/production-payroll-avalancheFuji.json) |
| Sepolia (**historical / do-not-use**) | `sepolia` | 11155111 | [`deployments/production-payroll-sepolia.json`](../deployments/production-payroll-sepolia.json) (+ alias `production-payroll.json`) — legacy Inbox `0xAb625…` |

`PrivatePayrollCoti` is shared on COTI — Fujis deploy reuses an existing COTI payroll address when present **unless** `FORCE_REDEPLOY_PAYROLL=1` (required after iter-08).

## Gate

- `npm run test:sablier-payroll-pod` → **39/39** green (simCOTI + architecture e2e)
- `deployConfig` has inbox + cotiExecutor on both paired chains
- Portal **`pMTT`** (preferred) or `PAYROLL_PTOKEN_KEY` / `PAYROLL_PTOKEN_ADDRESS` override

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
- Optional overrides: `SOURCE_INBOX`, `COTI_INBOX`, `COTI_MPC_EXECUTOR_ADDRESS`, `PAYROLL_PTOKEN_ADDRESS`, `PAYROLL_PTOKEN_KEY` (default `pMTT`), `PRIVATE_PAYROLL_COTI`

## Deploy

```bash
cd sablier-payroll-pod

# Recommended: Fuji + COTI (fresh iter-08 stack, live inbox pair)
npm run deploy:fuji-coti:preflight   # validate inboxes / balances only
npm run deploy:fuji-coti             # deploy + configure

# Legacy entrypoints
npm run deploy:production            # Sepolia + COTI
npm run deploy:production:avax       # Fuji + COTI (may reuse old COTI twin — set FORCE_REDEPLOY_PAYROLL=1)
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
| `PrivatePayrollCoti` | COTI (7082400) | `constructor(inboxCoti, owner)` — includes `creditPool` |
| `PayrollVault` | Sepolia / Fuji | `constructor(inboxSource, cotiPayroll)` + `configure(0x0, mpcExecutor, 7082400)` |
| `PodClaimStore` | Sepolia / Fuji | — |
| `PayrollCampaignFactory` | Sepolia / Fuji | wires vault + fees |
| `PayrollCampaignFacade` | Sepolia / Fuji | Thin facade via factory (no local MpcCore) |

## Fund / claim (post-deploy)

1. Employer: public `pToken.transfer(facade, amount)` → wait PoD settle  
2. Admin: `facade.requestCreditPool(amount)` with inbox AVAX fee → mine Fuji→COTI→Fuji  
3. Employee: `PodClaimStore.submitPayload` + `claim` → mine verify + public payout  

Do **not** call `ackPoolCredit` on Fuji (removed).

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

1. Fund `PayrollVault` and facade with native AVAX for inbox fees  
2. Employer seeds corporate treasury via existing Privacy Portal (`pMTT` deposit)  
3. Create real campaigns via factory (`createCampaign` with merkle root)  
4. Verify on [Cotiscan](https://testnet.cotiscan.io) / [Snowscan Fuji](https://testnet.snowscan.xyz)

## Test vs production

| | Test harness | Production |
|--|--------------|------------|
| Script | `deploy:testnet` | `deploy:fuji-coti` / `deploy:production:avax` |
| Source chain | Hardhat surrogate | Live Fuji |
| Portal / pToken | Mock portal + test pToken | `deployConfig.privacyPortalTokens.pMTT` |
| Inbox | Per-run harness | **Canonical** Inbox from deployConfig |
| Pool | COTI `creditPool` | Same |
