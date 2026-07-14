# Iteration 06 — Private amounts (no public leak)

`npm run test:sablier-payroll-pod` passes **35/35**. Amounts are encrypted in calldata, events, and registration; stories still call plaintext `amount` in JS — the test lib builds `itUint256` before hitting the facade.

## Architecture

```
Employer encrypted pToken.transfer(facade)
        ▼
PayrollCampaignFacade.claim(itUint256 amount, …)
        ▼ claimant PodClaimStore.submitPayload (verify IT + payout IT)
PayrollVault.requestPayout → COTI verifyAndCredit (private eq)
        ▼
PayrollCampaignFacade.payoutTo(itUint256) → employee
```

## Contract changes

| Surface | Iteration 5 | Iteration 6 |
|---------|-------------|-------------|
| `claim` / `claimTo` | `uint128 amount` calldata | `itUint256 amount` calldata (COTI verifies amount) |
| `registerLeaf` | `uint128 amount` + commitment | commitment only; no `registeredAmount` storage |
| `ClaimInstant` | public `uint128 amount` | `bytes32 amountCommitment` |
| `Clawback` event | public `uint128 amount` | admin + to only |
| `clawback` | `uint128` + `itUint256` | `itUint256` only |
| `ackPoolCredit` / `poolBalance` | plaintext pool mirror | **removed** — pool = encrypted pToken balance on facade |
| `PayrollVault.requestPayout` | `plainAmount` arg | removed |

## Test lib

| File | Change |
|------|--------|
| `campaign-facade.ts` | Plaintext story args → `buildClaimItAmount` / `buildVerifyItAmount`; clawback uses `buildPayoutItAmount` |
| `pod-backend.ts` | Per-account sim IT builders (claimant / employer keys) |
| `pod-scenario.ts` | `registerLeaf(index, recipient, commitment)`; funding = transfer + sync (no `ackPoolCredit`) |

## Story touch

- **S16** — event ABI/assertion uses `amountCommitment` instead of plaintext `amount` (only on-chain surface that still reflected salary; now commitment-only).

## Remaining gaps (superseded by iteration 07)

See `ITERATION_07_GAPS.md` for encrypted pool ledger, facade `validateCiphertext`, and on-chain S22.

## Commands

```bash
npm run test:sablier-payroll-pod   # 35/35
bash sablier-payroll-pod/scripts/sync-contracts.sh
```
