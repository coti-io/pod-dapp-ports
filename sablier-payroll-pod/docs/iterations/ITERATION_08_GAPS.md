# Iteration 08 — PoD-shaped facade (no Fuji MpcCore)

Live Fuji fund/claim failed because `PayrollCampaignFacade` called local `MpcCore` at `0x64`, which does not exist on PoD client chains. Sim masked this by injecting `SimExtendedOperations` at `0x64`.

## Architecture

```
Employer public pToken.transfer(facade, amount) + settle
        ▼
facade.requestCreditPool(amount) → vault inbox → COTI creditPool (setPublic + add)
        ▼
onPoolCredited → poolCreditedTotal (public marker)
        ▼
claim (merkle/fees only) → vault → COTI verifyAndCredit (+ decrypt amount + deduct pool)
        ▼
onPayoutAuthorized → facade.payoutTo(to, uint256) public transfer
```

## Contract changes

| Surface | Before | After |
|---------|--------|-------|
| Fuji facade | `ackPoolCredit` / `_deductPool` / `MpcCore.*` | No MpcCore calls; `requestCreditPool`; public `payoutTo` / `clawback` |
| COTI `PrivatePayrollCoti` | Roster verify only | `creditPool`, `clawbackPool`, pool deduct in `verifyAndCredit` |
| Vault | Stores payout IT | Callback carries plain amount; credit/clawback inbox paths |
| ClaimStore | verify IT + payout IT | verify IT + proof only |

## Harness

| File | Change |
|------|--------|
| `pod-scenario.ts` | Public fund transfer + `requestCreditPool` + mine |
| `campaign-facade.ts` | `submitPayload` without payout IT; clawback `uint256` + dual mine |
| `10-architecture-fund-claim.stories.ts` | Source asserts + create/fund/claim e2e |

## Commands

```bash
npm run test:sablier-payroll-pod   # simCOTI; facade no longer needs AVAX 0x64 for pool
```

**Test status:** **39/39** passing (includes architecture create→fund→claim e2e).
