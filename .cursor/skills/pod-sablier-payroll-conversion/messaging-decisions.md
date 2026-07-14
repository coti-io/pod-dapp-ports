# Messaging Decisions: One-Way vs Two-Way

Every cross-chain step must use `sendOneWayMessage` or `sendTwoWayMessage`. Document each step.

**Default payroll claim = 2 two-way hops (v1 nested):** verify + pToken transfer.

## Quick decision tree

```
Does AVAX state need to change after COTI finishes?
├── YES → sendTwoWayMessage (callback + error selectors)
└── NO  → sendOneWayMessage (COTI-only)
```

## Payroll messaging plan (default)

| Step | Direction | Type | Trigger | Target |
|------|-----------|------|---------|--------|
| 1. Register run | COTI direct or one-way | One-way | Employer setup | `registerRun` |
| 2. Register leaves | COTI direct or one-way | One-way | Employer setup | `registerLeaf` per employee |
| 3. Fund pool | AVAX sync + mint async | Portal deposit | Employer | `PrivacyPortal.deposit` → pToken mint |
| 4. Verify claim | AVAX → COTI | **Two-way** | Employee `requestPayout` | `verifyAndCredit` |
| 5. Credit employee | AVAX → COTI | **Two-way** | `onPayoutAuthorized` callback | `pToken.transfer(itAmount)` |

### Step 4 — Verify leg

```
PayrollVault.requestPayout(runId, itAmount, proofHandle)
  → sendTwoWayMessage → PrivatePayrollCoti.verifyAndCredit
  → callback: onPayoutAuthorized(data)
  → error: onPayoutRejected(data)
```

AVAX state change: `payoutRequestStatus[requestId] = VerifyCompleted`.

### Step 5 — Transfer leg (v1 nested)

```
PayrollVault.onPayoutAuthorized
  → pToken.transfer{value}(claimant, itAmount, callbackFee)
  → sendTwoWayMessage → PodErc20CotiMother transfer
  → callback: (pToken transferCallback — existing pattern)
```

AVAX state change: `payoutRequestStatus[requestId] = Completed`.

**Do not** use `safeTransfer` with decrypted plaintext amount.

### v2 combined (future)

Single two-way: COTI `verifyAndCredit` calls `PodErc20CotiMother` transfer internally. AVAX callback only marks complete. Deferred until v1 E2E passes.

---

## When to use two-way

| Scenario | Callback |
|----------|----------|
| Eligibility verified | `onPayoutAuthorized` → start pToken transfer |
| Verify rejected | `onPayoutRejected` |
| pToken credited | pToken `transferCallback` (existing) |
| Portal deposit mint | `PrivacyPortal` mint callback (employer funding) |

Reference: `PodLibBase._sendTwoWayWithFee`, `PodERC20._sendPodTwoWay`.

### Fee model (2 legs per claim)

```
verifyFee = podInboxTwoWayFee(verify call size)
transferFee = podInboxTwoWayFee(transfer call size)
employeePays = verifyFee + transferFee (+ portal fee if applicable)
```

Quote with live gas price — see `pod-pp-fee-oracle-upgrade`.

---

## When to use one-way

| Scenario | Why |
|----------|-----|
| `registerRun` on COTI | No AVAX state change |
| `registerLeaf` batch on COTI | Employer setup only |
| Pause propagation | Mirror `PrivacyPortalFactory` |

Ensure registration completes before claims open.

---

## Messaging plan template

```
Step N: [name]
  Direction: AVAX → COTI | COTI direct
  Type: one-way | two-way
  Trigger: [actor.function]
  COTI target: [contract.function]
  AVAX callback: [selector | none]
  AVAX error: [selector | none]
  Justification: [...]
```

---

## Anti-patterns

| Anti-pattern | Why wrong |
|--------------|-----------|
| One-way for verify when AVAX must trigger transfer | Vault never learns to pay |
| `safeTransfer` in verify callback | Leaks plaintext amount |
| Single two-way expecting sync payout | pToken credit is separate async hop |
| Omitting transfer leg fee | Second tx reverts |

## Volume notes

- Each employee claim = **2 two-way** messages in v1 (verify + transfer)
- Employer setup = N one-way/direct `registerLeaf` + 1 portal deposit (mint async)
- v2 combined reduces to 1 two-way per claim
