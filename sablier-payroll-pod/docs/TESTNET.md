# COTI Testnet E2E (Sablier Payroll PoD)

Run the PoD payroll port against **live COTI testnet** with a **Hardhat AVAX surrogate** (chain 31337). Same user-story tests as sim mode; only `test/lib` and infra differ.

## Prerequisites

From [`pod-ecosystem-integration/.env`](../../pod-ecosystem-integration/.env):

| Variable | Purpose |
|----------|---------|
| `COTI_TESTNET_RPC_URL` | Live COTI RPC |
| `COTI_TESTNET_PRIVATE_KEY` or `_PRIVATE_KEY` / `PRIVATE_KEY` | Funded deployer/miner (~0.5+ COTI) |
| `COTI_AES_KEY` | Default onboard key (per-account keys derived in test lib) |
| `MINER_ADDRESS` | Inbox miner (for `deploy:full-testnet` bootstrap) |
| `PRIVATE_KEY_ACCOUNT_2` | Optional — multi-actor stories (carol, etc.) |

Bootstrap shared PoD infra if not already deployed:

```bash
cd ../../pod-ecosystem-integration
npm run test:coti-testnet          # sanity check
MINER_ADDRESS=$MINER_ADDRESS npm run deploy:full-testnet
```

## Commands

```bash
# Smoke (~12 stories): deploy, fund, claim, underfund, clawback
npm run test:testnet:smoke

# Full suite (35 stories)
npm run test:testnet

# Persist harness deploy addresses (optional reuse)
npm run deploy:testnet
```

From monorepo root or PEI:

```bash
npm run test:sablier-payroll-pod:testnet:smoke   # pod-dapp-ports
npm run test:pod-payroll-port:testnet:smoke      # pod-ecosystem-integration
npm run test:payroll-e2e                         # PEI wrapper → smoke runner
```

## Architecture

| Chain | Mode | Role |
|-------|------|------|
| Hardhat (31337) | In-process surrogate | AVAX contracts: facade, vault, pToken test portal |
| COTI testnet (7082400) | Live RPC | `PrivatePayrollCoti`, inbox mining, real MPC |

Testnet harness injects **sim MPC precompile on Hardhat only** so `validateCiphertext` on the facade works while COTI uses real MPC.

## Env for contract reuse

After `npm run deploy:testnet`, optional:

```bash
export COTI_REUSE_CONTRACTS=true
export COTI_INBOX_ADDRESS=...
export COTI_MPC_EXECUTOR_ADDRESS=...
export HARDHAT_INBOX_ADDRESS=...
```

## RPC flakiness

Live COTI may return `TransactionNotFound` or `replacement transaction underpriced`. Retry the test run; increase `COTI_MINE_GAS_MPC_256` / `COTI_MINE_GAS_POD_TOKEN` if mining OOGs.

## Production deploy

After **35/35** on testnet, run production deploy bound to launched Inbox — see [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md).
