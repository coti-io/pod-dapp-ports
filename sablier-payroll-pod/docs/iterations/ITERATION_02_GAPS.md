# Iteration 2 — Gap Report

## Summary: 35/35 passing (full async cross-chain)

`npm run test:sablier-payroll-pod` passes all Sablier-shaped stories with **`simSyncPayout` removed** and real `runCrossChainTwoWayRoundTrip` claim mining.

## Root cause fixed (iteration 1 `errorCode=2` / `0x07044e63`)

`errorCode=2` is **`ERROR_CODE_ENCODE_FAILED`** on the COTI inbox miner, not a merkle reject from `PrivatePayrollCoti`.

Two issues:

1. **COTI callee ABI** — `MpcAbiCodec.reEncodeWithGt` validates `itUint256` on the inbox leg and delivers **`gtUint256`** to the target. `verifyAndCredit` must accept `gtUint256 claimed`, not `itUint256` (same pattern as `PodErc20CotiMother.transfer`).
2. **IT signatures** — Claim payloads use default **`inboxCoti` + `batchProcessRequests`** IT signing (msg.sender during codec validate). Register uses **`PrivatePayrollCoti` + `registerLeaf`** (direct owner call on COTI).

## Contract / lib changes

| Area | Change |
|------|--------|
| `PrivatePayrollCoti.verifyAndCredit` | `gtUint256 claimed`; `proofHandle = abi.encode(proof, index)`; leaf rebuilt from `_amountCommitment`; MPC `eq` vs registered ct |
| `PayrollCampaignFacade` | Removed `simSyncPayout`; emit `ClaimInstant` in claim tx after `requestPayout` (story S16 block scope) |
| `PayrollVault` | Callback decodes `(runId, index, claimant)` only; payroll-sized inbox fee quote in scenario |
| `pod-backend.ts` | Register vs claim IT signing split |
| `campaign-facade.ts` | `proofHandle` without plaintext / leaf |

## Remaining gaps (production, iteration 3+)

| Gap | Notes |
|-----|--------|
| pToken payout | Still `SablierPayrollToken` ERC20 on facade for story API parity |
| Portal employer funding | Employer mints ERC20 to facade in tests |
| `PodClaimStore` | Test harness for encrypted claim payloads; production needs client encryption + router |
| ClaimInstant timing | Emitted when claim is **submitted** (same tx as `claim`); token transfer completes after COTI round-trip |
| Duplicate-spend guard | If COTI verify fails after `ClaimInstant`, event is optimistic — add reconciliation in production UI |

## Verification

```bash
npm run test:sablier-payroll-pod   # 35/35
npm run test:sablier-payroll    # 35/35 (unchanged Phase 1)
```
