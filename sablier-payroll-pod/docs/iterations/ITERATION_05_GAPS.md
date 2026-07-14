# Iteration 5 — Gap Report

## Summary: 35/35 passing (encrypted ops end-to-end)

`npm run test:sablier-payroll-pod` passes with **encrypted pToken** for treasury funding, payout, and clawback; **claimant-submitted** payloads; and **employer `ackPoolCredit`** replacing admin `creditPool`.

## Architecture (iteration 5)

```
Privacy Portal (test infra) → corporate treasury
        │
        ▼ encrypted pToken transfer + employer ackPoolCredit
PayrollCampaignFacade (poolBalance)
        │
        ▼ claimant submitPayload (verify IT + payout IT) → claim
PayrollVault → COTI verify → encrypted payoutTo → employee
```

Payroll contracts never call Privacy Portal.

## What changed

| Area | Change |
|------|--------|
| `PodClaimStore` | `submitPayload` by claimant (verify IT + payout IT); removed admin `setPayload` |
| `PayrollCampaignFacade` | `payoutTo(to, itUint256)` encrypted; `clawback(to, amount, itUint256)` encrypted; `ackPoolCredit` replaces `creditPool` |
| `PayrollVault` | Stores `payoutItAmount`; forwards inbox fees to `payoutTo`; timing guards delegated to facade |
| `pod-backend` | `buildPayoutItAmount` for facade-registered sim key |
| `campaign-facade` | Claimant submits payload; clawback builds encrypted IT; pre-claim facade/claimant sync |
| `pod-token-adapter` | Payroll facade transfers → encrypted fund path + `ackPoolCredit` |
| Funding | Employer `pToken.transfer(facade)` (encrypted) + `ackPoolCredit` — not `fundCampaign` internal transfer (avoids wrong `msg.sender` on pToken) |

## Root causes fixed

1. **Public payout/clawback** — replaced with encrypted `itUint256` pToken transfers.
2. **Admin `creditPool`** — replaced with employer `ackPoolCredit` after encrypted treasury transfer.
3. **Admin `setPayload`** — replaced with claimant `submitPayload` (production-shaped client flow).
4. **`fundCampaign` internal transfer** — reverted; pToken `transfer` must originate from treasury EOA (`msg.sender` = employer).
5. **S27b start boundary** — pre-claim `syncAccount` for facade + claimant before building payout IT.

## Remaining gaps (production)

| Gap | Notes |
|-----|--------|
| `ackPoolCredit` | Plaintext pool mirror; production may bind credit to pToken callback or decrypt facade balance |
| `ClaimInstant` timing | Emitted at claim submit (required for S16 same-block); means “claim accepted” not “payout mined” |
| Vault fee float | Vault forwards `estimateFee()` ETH to facade `payoutTo`; production may use dedicated fee escrow |
| Portal | Test infra for treasury seed only |

## Verification

```bash
npm run test:sablier-payroll-pod   # 35/35
npm run test:sablier-payroll    # 35/35 (unchanged Phase 1)
```
