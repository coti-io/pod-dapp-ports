# Architecture — PoD Payroll Port

## Split

```mermaid
flowchart LR
  subgraph avax [Hardhat / AVAX surrogate]
    Facade[PayrollCampaignFacade]
    Vault[PayrollVault]
    Store[PodClaimStore]
    Token[SablierPayrollToken]
  end
  subgraph coti [simCOTI]
    PPC[PrivatePayrollCoti]
  end
  Stories[test/stories] --> Lib[test/lib]
  Lib --> Facade
  Facade --> Vault
  Facade --> Store
  Vault -->|two-way inbox| PPC
  Facade --> Token
```

## Claim flow (iteration 2 — full async)

1. `freshCampaign` builds PoD merkle tree, deploys facade, registers leaves on COTI + facade
2. `claimPackage` / `preparePayload` sets `PodClaimStore` with `itUint256` + `proofHandle`
3. Facade `_preProcessClaim` (time, fee, merkle, amount)
4. Facade `requestPayout` → inbox two-way to COTI; `ClaimInstant` emitted in same tx (story event scope)
5. `runCrossChainTwoWayRoundTrip` mines COTI `verifyAndCredit(gtUint256, proofHandle)`
6. Vault `onPayoutAuthorized` → `facade.payoutTo` + `markClaimed`

## Merkle spec

See `docs/MERKLE_POD.md` and `test/lib/merkle.ts`.
