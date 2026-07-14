# Iteration 3 — Gap Report

## Summary: 35/35 passing (pToken + Privacy Portal)

`npm run test:sablier-payroll-pod` passes all Sablier-shaped stories with **real `PodErc20Mintable` pToken**, **Privacy Portal employer funding**, and **double mining** (payroll verify + pToken transfer).

## What changed (iteration 3)

| Area | Change |
|------|--------|
| `PayrollCampaignFacade` | `TOKEN` is pToken address; `poolBalance` + `creditPool` for Sablier-sync underfund guard; `payoutTo` / `clawback` use live `IPodERC20.estimateFee()`; `receive()` for inbox ETH |
| Employer funding | `freshCampaign` → `portalDepositTo` + `creditPool`; S27 `mint`/`transfer` → portal deposit + encrypted transfer + `creditPoolTo` |
| `pod-token-adapter.ts` | Story ERC20 API: decrypt balances, per-account sim IT signing, encrypted transfer/approve/transferFrom with mining |
| `portal-setup.ts` | Portal + `PodErc20Mintable` (minter = portal) + mother registration |
| `pod-scenario.ts` | Onboard employees by env private key; facade sim onboard; payroll + pToken fee wiring |
| `async.ts` | `mineAfterPayoutClaim` + `mineAfterPayoutTransfer` |

## Root causes fixed

1. **`SimUserNotOnboarded` (`0x07044e63`)** on pToken payout — employees/facade not registered on simCOTI; fixed with `onboardByAddress` + `registerUserOnSim` for facade.
2. **`TargetFeeTooLow` (`0xcf3cbb39`)** on payout callback — static `pTokenTransferFeeWei` stale vs `tx.gasprice`; fixed with `estimateFee()` at payout time.
3. **S22 underfund** — async pToken transfer does not revert synchronously; fixed with `poolBalance` check in `_preProcessClaim`.
4. **S28–S31 transfer encode failures** — IT built with pod-owner key / wrong validating contract; fixed with per-account `prepareSimIT256` + inbox default selector.
5. **S27 manual funding** — `mint` threw; `poolBalance` zero after transfer; fixed with adapter `mint` → `portalDepositTo` and `creditPoolTo` after employer→facade transfer.

## Claim / payout path (iteration 3)

1. **Fund** — `portalDepositTo(facade)` + `creditPool(amount)` + ETH on facade for pToken inbox fees
2. **Claim tx** — facade pre-checks (incl. `poolBalance`) → vault `requestPayout` → emit `ClaimInstant`
3. **Mine payroll** — COTI `verifyAndCredit` → vault `onPayoutAuthorized` → `payoutTo` (queues pToken public transfer)
4. **Mine pToken** — `runCrossChainTwoWayRoundTrip` for facade→recipient transfer
5. **Sync** — `syncPodBalancesRoundTrip` for decrypted story `balanceOf`

## Remaining gaps (production, iteration 4+)

| Gap | Notes |
|-----|--------|
| `poolBalance` vs ciphertext | Plaintext pool credits mirror Sablier ERC20 balance for sync revert; production may track portal deposit events or decrypt facade balance |
| Encrypted pToken payout | After private verify, facade uses **public** `IPodERC20.transfer(to, amount)` with registered plaintext amount |
| `PodClaimStore` | Test harness; production needs client-side IT + `proofHandle` construction |
| `ClaimInstant` timing | Still optimistic at claim submit; token arrives after double mine |
| Carol wallet | With 3 Hardhat env keys, `carol` falls back to `wallets[0]` — stories still pass; use 4+ keys for distinct carol |

## Verification

```bash
npm run test:sablier-payroll-pod   # 35/35
npm run test:sablier-payroll    # 35/35 (unchanged Phase 1)
```
