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
# System e2e (Inbox + PP + pToken + fund/claim/clawback) — sim
npm run test:e2e

# Same system e2e against live COTI (Hardhat AVAX surrogate)
npm run test:e2e:testnet

# Attach smoke to live Fuji/Sepolia + COTI deploy manifests
npm run test:e2e:live:fuji
npm run test:e2e:live:sepolia

# Smoke (~12 stories): deploy, fund, claim, underfund, clawback
npm run test:testnet:smoke

# Full suite (stories 01–08)
npm run test:testnet

# Persist harness deploy addresses (optional reuse)
npm run deploy:testnet
```

See also [E2E.md](./E2E.md).

From monorepo root or PEI:

```bash
npm run test:sablier-payroll-pod:testnet:smoke   # pod-dapp-ports
npm run test:pod-payroll-port:testnet:smoke      # pod-ecosystem-integration
npm run test:payroll-e2e                         # PEI wrapper → smoke runner
```

## Architecture

| Chain | Mode | Role |
|-------|------|------|
| Hardhat (31337) | In-process surrogate | AVAX/Fuji-shaped contracts: facade, vault, test Privacy Portal + pToken |
| COTI testnet (7082400) | Live RPC | `PrivatePayrollCoti`, inbox mining, real MPC |

**Do not** inject sim MPC at `0x64` on the Hardhat/AVAX surrogate — live Fuji has empty code there. MPC runs only on COTI (`PrivatePayrollCoti`).

## Env for contract reuse

System e2e (`npm run test:e2e:testnet` / `test:e2e:testnet:retry`) auto-persists live COTI infra to
`deployments/e2e-testnet-cache.json` (Inbox, MpcExecutor, PodErc20CotiMother) and reuses it on the
next attempt. Hardhat-side contracts stay fresh each process (in-memory). Set
`COTI_REUSE_ALLOW_FRESH_HARDHAT=1` (default in the e2e runner).

`test:e2e:testnet:retry` sets a unique `HARDHAT_CHAIN_ID` (≥ `313370000`) per attempt so the reused
COTI inbox gets a fresh inbound-nonce space (fresh Hardhat always restarts outbound nonces at 1).
`registerLeaf` uses `COTI_REGISTER_LEAF_GAS` (default 8M) — eth_estimateGas alone often OOGs
`validateCiphertext` and leaves the roster empty (claim then raises errorCode 4).

After `npm run deploy:testnet`, optional manual reuse:

```bash
export COTI_REUSE_CONTRACTS=true
export COTI_INBOX_ADDRESS=...
export COTI_MPC_EXECUTOR_ADDRESS=...
export HARDHAT_INBOX_ADDRESS=...
```

## RPC flakiness

Live COTI may return `TransactionNotFound` or `replacement transaction underpriced`. Prefer
`npm run test:e2e:testnet:retry` (reuses COTI infra). Increase `COTI_MINE_GAS_MPC_256` /
`COTI_MINE_GAS_POD_TOKEN` / `COTI_REGISTER_LEAF_GAS` if mining or roster registration OOGs.

## Production deploy

After stories pass on testnet, run production deploy bound to launched Inbox — see [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md).
