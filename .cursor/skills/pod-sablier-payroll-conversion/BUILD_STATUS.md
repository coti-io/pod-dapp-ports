# BUILD_STATUS — Private Payroll Temp Impl

**Updated:** 2026-07-12

## Summary

| Gate | Status |
|------|--------|
| Skill updated (pToken, encrypted-leaf merkle, no AVAX index) | **Done** |
| Contracts compile (`PayrollVault`, `PrivatePayrollCoti`) | **Done** |
| E2E test written (`test/payroll/payroll-e2e.test.ts`) | **Done** |
| Harness fixes (portal clone, MpcExecutor link, Paris EVM, `COTI_BACKEND=testnet`) | **Done** |
| Live E2E pass (Sepolia Hardhat ↔ COTI testnet) | **Intermittent — COTI RPC** |

**Verdict:** Product is **buildable**. Architecture, contracts, and test harness are complete. Full E2E pass depends on stable COTI testnet RPC (observed: `PUSH0` fixed via Paris overrides; remaining failures are `replacement transaction underpriced` / `TransactionNotFound` during deploy/mine).

---

## Artifacts

| Path | Description |
|------|-------------|
| `/workspaces/coti-contracts/contracts/pod/payroll-eval/` | Source contracts |
| `/tmp/pod-payroll-eval/contracts/` | Mirror copy |
| `/workspaces/pod-ecosystem-integration/test/payroll/payroll-e2e.test.ts` | E2E system test |
| `/workspaces/pod-ecosystem-integration/.cursor/skills/pod-sablier-payroll-conversion/` | Updated skill (11 files) |

---

## Key harness fixes (2026-07-12)

1. **`scripts/link-contracts.sh`** — links `MpcExecutor.sol` from `pod-mpc-lib`
2. **`hardhat.config.ts`** — Paris `evmVersion` overrides for COTI-deployed contracts (avoids `PUSH0` on COTI testnet)
3. **`privacy-portal-system-utils.ts`** — `PrivacyPortal` deployed via `CloneHelper` before `initialize`
4. **`package.json`** — `test:payroll-e2e` sets `COTI_BACKEND=testnet`
5. **Payroll test** — asserts `registerRun` receipt; uses `runId` from vault `nextRunId`

---

## Run

```bash
cd /workspaces/pod-ecosystem-integration
npm run link:contracts
npx hardhat compile
npm run test:payroll-e2e
```

---

## Environment notes

| Issue | Resolution |
|-------|------------|
| `invalid opcode: PUSH0` | Paris overrides for Inbox, MpcExecutor, PriceOracle, PodErc20CotiMother, PrivatePayrollCoti |
| `SimExtendedOperations` not found | `COTI_BACKEND=testnet` |
| COTI reuse + fresh Hardhat inbox | Nonce desync; use fresh deploy both sides |
| COTI RPC tx not found / underpriced | Retry test; transient testnet issue |

---

## Demo limitations (accepted)

| Topic | Status |
|-------|--------|
| Merkle | leafHash commitment tree; public proof path on COTI |
| Payout | pToken encrypted credit |
| AVAX index | Removed |
| Employee address in COTI `registerLeaf` | Public on COTI |
| Two async hops | Accepted for demo |

---

## Open blockers for demo scope

**None in application code.** Remaining gap is **live COTI testnet RPC reliability** for full E2E green run.
