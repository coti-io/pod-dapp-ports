# Payroll E2E — Inbox + Privacy Portal + pToken

System tests mirror PEI [`privacy-portal-system.ts`](../../../pod-ecosystem-integration/test/privacy/privacy-portal-system.ts): full dual-chain stack via `setupContext` + portal/pToken helpers, then payroll create → fund → claim → clawback.

## Modes

| Command | Source chain | COTI | What it does |
|---------|--------------|------|----------------|
| `npm run test:e2e` | Hardhat (Fuji/Sepolia **surrogate**, no `0x64`) | simCoti | Fresh inbox + PP + pToken + payroll; mines in-process |
| `npm run test:e2e:testnet` | Hardhat surrogate | live `cotiTestnet` | Same app flows; real MPC mine |
| `npm run test:e2e:live:fuji` | live Avalanche Fuji | live COTI | **Attach** to deployed Inbox/PP/pToken/payroll; wiring smoke |
| `npm run test:e2e:live:sepolia` | live Sepolia | live COTI | Same attach smoke |

Functional create/fund/claim/clawback with deterministic mining is **sim** or **Hardhat↔COTI testnet**. Live Fuji/Sepolia attach verifies production addresses (network miners are outside the harness).

## Stack under test

```
Hardhat or Fuji/Sepolia          COTI (sim or 7082400)
─────────────────────────        ─────────────────────
Inbox                            Inbox
PrivacyPortal → pToken           PodErc20CotiMother
PayrollVault / Facade / Factory  PrivatePayrollCoti
PodClaimStore                    (MPC at 0x64)
```

Utils (from `pod-ecosystem-integration`):

- `connectDualChainForTests` / `setupContext`
- portal deposit round-trips (`portal-setup.ts` ≈ PEI `depositAndComplete`)
- `runCrossChainTwoWayRoundTrip` / `completePodOpRoundTrip`

## Env

Same as [TESTNET.md](./TESTNET.md) for live COTI. Live attach also needs RPC + keys for `avalancheFuji` / `sepolia` in Hardhat config / PEI `.env`.

## Files

- `test/e2e/payroll-system.e2e.ts` — functional system suite
- `test/e2e/live-source.e2e.ts` — production attach
- `test/runner-e2e.ts` / `runner-e2e-testnet.ts` / `runner-e2e-live.ts`
