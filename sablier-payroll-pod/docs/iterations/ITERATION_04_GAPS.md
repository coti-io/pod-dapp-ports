# Iteration 4 — Gap Report

## Summary: 35/35 passing (corporate treasury → pToken-only payroll)

`npm run test:sablier-payroll-pod` passes with **Privacy Portal confined to corporate treasury seeding** and **all campaign funding via employer pToken transfers** (no portal → facade path).

## Funding model (iteration 4)

```
Privacy Portal (test infra only)
        │
        ▼ one-time seed + story `mint` top-ups
  Corporate treasury (employer pToken balance)
        │
        ▼ encrypted pToken transfer (+ creditPool on facade)
  PayrollCampaignFacade (poolBalance)
        │
        ▼ claim + COTI verify + pToken payout
  Employee wallets
```

Payroll contracts (`PayrollCampaignFacade`, `PayrollVault`, `PrivatePayrollCoti`) interact with **pToken only** — never Privacy Portal.

## What changed

| Area | Change |
|------|--------|
| `seedCorporateTreasury` | One-time 50M pToken portal deposit to employer at scenario start |
| `fundFacade` | Employer `token.transfer(facade)` + `creditPool` + ETH (no `portalDepositTo` to facade) |
| `token.write.mint` | Treasury top-up via portal to recipient (S27 `mint` + `employer.mintAndFund`) |
| `onCampaignFunded` | After treasury transfer to registered facade, admin `creditPool` + inbox ETH |
| `creditPool` natspec | Documents treasury pToken transfer, not portal deposit |
| Carol wallet | Mnemonic index 3 when <4 env keys; Hardhat impersonation + simCOTI native fund |

## Root causes fixed

1. **Portal on every campaign** — facades were funded via `portalDepositTo(facade)`; replaced with treasury → pToken transfer path.
2. **S27 `mint`/`transfer`** — `mint` tops up treasury; `transfer` to campaign triggers `onCampaignFunded` for `poolBalance`.
3. **S31 carol = employer** — treasury seed on employer broke cold-wallet balance; carol is now a distinct mnemonic account.
4. **Carol unknown account** — Hardhat `impersonateAccount` for mnemonic carol on claims and `transferFrom`.

## Remaining gaps (production, iteration 5+)

| Gap | Notes |
|-----|--------|
| `poolBalance` bookkeeping | Admin `creditPool` after treasury transfer; production may use on-chain pToken balance oracle or callback |
| Encrypted treasury → campaign | Stories use encrypted transfer; production may prefer public treasury ops |
| `PodClaimStore` | Test harness; client-side IT in production |
| `ClaimInstant` timing | Optimistic at claim submit; payout after double mine |
| Portal in production | Employer treasury funded off-chain via portal UI; payroll contracts unchanged |

## Verification

```bash
npm run test:sablier-payroll-pod   # 35/35
npm run test:sablier-payroll    # 35/35 (unchanged Phase 1)
```
