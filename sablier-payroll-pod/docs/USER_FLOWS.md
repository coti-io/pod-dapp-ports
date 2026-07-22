# User flows — networks, contracts, callbacks

Iteration 08 thin Fuji facade. **UI only talks to Fuji.** Encrypted pool MPC runs on COTI via the two-way inbox.

| Network | Role | Contracts |
|---------|------|-----------|
| Avalanche Fuji (`43113`) | PoD client | `pToken`, `PayrollCampaignFactory`, `PayrollCampaignFacade`, `PayrollVault`, `PodClaimStore`, `Comptroller`, `Inbox` |
| COTI testnet (`7082400`) | MPC server | `PrivatePayrollCoti`, `Inbox` (same address), `MpcExecutor` (relayer) |

Inbox pattern for every async path: Fuji vault → `Inbox` two-way → COTI method → `inbox.respond` / `inbox.raise` → Fuji vault **callback** → facade.

---

## Legend

```mermaid
flowchart LR
  UI[UI / wallet] --> Fuji[Fuji contract]
  Fuji -->|two-way request| Inbox[(Inbox)]
  Inbox -->|relayer mines| COTI[PrivatePayrollCoti]
  COTI -->|respond / raise| Inbox
  Inbox -->|callback| VaultCB[Vault callback]
  VaultCB --> Facade[Facade]
```

---

## 1. Create campaign (admin / ops)

No inbox. Fuji factory clones + wires; ops then registers leaves on both chains.

```mermaid
sequenceDiagram
  autonumber
  actor Admin
  participant Factory as PayrollCampaignFactory<br/>(Fuji)
  participant Facade as PayrollCampaignFacade<br/>(Fuji)
  participant Vault as PayrollVault<br/>(Fuji)
  participant PPC as PrivatePayrollCoti<br/>(COTI)

  Admin->>Factory: createCampaign(admin, root, pToken, start, exp, name, minFeeUSD)
  Factory->>Facade: clone / deploy template
  Factory->>Vault: createRun(root, pToken, facade, …)
  Factory->>Facade: wirePayroll(vault, claimStore, runId)
  Note over Factory,Facade: Same tx on Fuji — no callback

  Note over Admin,PPC: Ops / backend (separate txs)
  Admin->>Facade: registerLeaf(index, recipient, commitment)
  Admin->>PPC: registerRun(runId, root)
  Admin->>PPC: registerLeaf(runId, index, employee, commitment, itAmount)
  Note over PPC: MpcCore.validateCiphertext / offBoard (COTI 0x64)
```

| Step | Network | Contract.call | Callback? |
|------|---------|---------------|-----------|
| Create | Fuji | `Factory.createCampaign` → `Vault.createRun` + `Facade.wirePayroll` | No |
| Register Fuji leaf | Fuji | `Facade.registerLeaf` | No |
| Register COTI run/leaf | COTI | `PrivatePayrollCoti.registerRun` / `registerLeaf` | No (direct owner tx) |

---

## 2. Fund campaign (employer / admin)

Public pToken move on Fuji, then encrypted pool credit on COTI.

```mermaid
sequenceDiagram
  autonumber
  actor Employer
  participant pToken as pToken / PodERC20<br/>(Fuji)
  participant Facade as PayrollCampaignFacade<br/>(Fuji)
  participant Vault as PayrollVault<br/>(Fuji)
  participant Inbox as Inbox<br/>(Fuji ↔ COTI)
  participant PPC as PrivatePayrollCoti<br/>(COTI)

  Employer->>pToken: transfer(facade, amount, callbackFee) + AVAX fees
  Note over pToken: PoD pToken settle (async mint/sync)<br/>Not yet COTI pool credit

  Admin->>Facade: requestCreditPool(amount, callbackFee) + live inbox AVAX
  Facade->>Vault: requestCreditPool(runId, amount, callbackFeeWei) {value: msg.value}
  Vault->>Inbox: two-way → creditPool(runId, amount)<br/>success: onPoolCredited<br/>fail: onPoolCreditRejected

  Inbox->>PPC: creditPool(runId, amount)
  Note over PPC: setPublic256 + add to _poolBalanceCt
  PPC-->>Inbox: respond(runId, amount)

  Inbox->>Vault: onPoolCredited(abi.encode(runId, amount))
  Vault->>Facade: onPoolCredited(amount)
  Note over Facade: poolCreditedTotal += amount<br/>emit PoolCredited
```

### Callback map (fund)

| Direction | Selector | Who calls | Payload |
|-----------|----------|-----------|---------|
| Request | `PrivatePayrollCoti.creditPool` | Inbox → COTI | `runId`, `amount` |
| Success callback | `PayrollVault.onPoolCredited` | Inbox → Vault | `(runId, amount)` |
| Then | `Facade.onPoolCredited` | Vault → Facade | `amount` |
| Fail callback | `PayrollVault.onPoolCreditRejected` | Inbox → Vault | `(runId, 0, errorCode)` |

UI poll: `facade.poolCreditedTotal()` (and/or `PoolCredited` event).

---

## 3. Claim (employee)

Fuji: merkle + fee + claimStore. COTI: verify amount + deduct pool. Fuji callback: public payout.

```mermaid
sequenceDiagram
  autonumber
  actor Employee
  participant Store as PodClaimStore<br/>(Fuji)
  participant Facade as PayrollCampaignFacade<br/>(Fuji)
  participant Comptroller as Comptroller<br/>(Fuji)
  participant Vault as PayrollVault<br/>(Fuji)
  participant Inbox as Inbox<br/>(Fuji ↔ COTI)
  participant PPC as PrivatePayrollCoti<br/>(COTI)
  participant pToken as pToken<br/>(Fuji)

  Employee->>Store: submitPayload(facade, index, verifyIt, proofHandle)
  Note over Store: Stores verify IT + proof for consume

  Employee->>Facade: claim(index, recipient, proof, inboxFees, pTokenFees) + minFeeWei
  Facade->>Facade: _preProcessClaim (time, fee, merkle — no MpcCore)
  Facade->>Comptroller: call{value: fee}("")
  Facade->>Store: consumePayload(facade, index, recipient)
  Facade->>Vault: requestPayout(..., inboxCallback, pTokenFees) {value: inboxTotal}
  Note over Facade: emit ClaimInstant (= submitted, not paid)

  Vault->>Inbox: two-way → verifyAndCredit(…)<br/>success: onPayoutAuthorized<br/>fail: onPayoutRejected

  Inbox->>PPC: verifyAndCredit(runId, claimant, claimed, proofHandle)
  Note over PPC: merkle + eq(claimed, registered)<br/>deduct _poolBalanceCt<br/>decrypt plain amount
  PPC-->>Inbox: respond(runId, index, claimant, plainAmount)

  Inbox->>Vault: onPayoutAuthorized(abi.encode(runId, index, claimant, amount))
  Vault->>Facade: payoutTo(to, amount, pTokenCallback) {value: reserved pTokenTotal}
  Facade->>pToken: transfer(to, amount, callbackFee)
  Vault->>Facade: markClaimed(index)
  Note over Facade: hasClaimed(index) = true<br/>emit PayoutCompleted on vault
```

### Callback map (claim)

| Direction | Selector | Who calls | Payload |
|-----------|----------|-----------|---------|
| Request | `PrivatePayrollCoti.verifyAndCredit` | Inbox → COTI | `runId`, `claimant`, `it/gt amount`, `proofHandle` |
| Success callback | `PayrollVault.onPayoutAuthorized` | Inbox → Vault | `(runId, index, claimant, plainAmount)` |
| Then | `Facade.payoutTo` → `pToken.transfer` | Vault → Facade → pToken | public `uint256` amount |
| Then | `Facade.markClaimed` | Vault → Facade | `index` |
| Fail callback | `PayrollVault.onPayoutRejected` | Inbox → Vault | `(runId, index, errorCode)` |

`ClaimInstant` ≠ paid. Paid when vault `PayoutCompleted` / `hasClaimed` + pToken balance sync.

---

## 4. Clawback (admin)

Same two-way shape as fund, but COTI deducts pool and Fuji pays out to admin-chosen `to`.

```mermaid
sequenceDiagram
  autonumber
  actor Admin
  participant Facade as PayrollCampaignFacade<br/>(Fuji)
  participant Vault as PayrollVault<br/>(Fuji)
  participant Inbox as Inbox<br/>(Fuji ↔ COTI)
  participant PPC as PrivatePayrollCoti<br/>(COTI)
  participant pToken as pToken<br/>(Fuji)

  Admin->>Facade: clawback(to, amount, inboxCb, pTokenFees) + inboxFee AVAX
  Facade->>Vault: requestClawback(runId, to, amount, callbackFeeWei, pTokenFees)
  Note over Facade: emit Clawback (requested)

  Vault->>Inbox: two-way → clawbackPool(runId, amount)<br/>success: onClawbackAuthorized<br/>fail: onClawbackRejected

  Inbox->>PPC: clawbackPool(runId, amount)
  Note over PPC: deduct _poolBalanceCt
  PPC-->>Inbox: respond(runId, amount)

  Inbox->>Vault: onClawbackAuthorized(abi.encode(runId, amount))
  Vault->>Facade: payoutTo(to, amount, pTokenCallback) {value: reserved}
  Facade->>pToken: transfer(to, amount, callbackFee)
```

### Callback map (clawback)

| Direction | Selector | Who calls | Payload |
|-----------|----------|-----------|---------|
| Request | `PrivatePayrollCoti.clawbackPool` | Inbox → COTI | `runId`, `amount` |
| Success callback | `PayrollVault.onClawbackAuthorized` | Inbox → Vault | `(runId, amount)` |
| Then | `Facade.payoutTo` → `pToken.transfer` | Vault → Facade → pToken | public amount to `to` |
| Fail callback | `PayrollVault.onClawbackRejected` | Inbox → Vault | `(runId, 0, errorCode)` |

---

## 5. Master callback matrix

| User flow | Fuji entry | Inbox request (COTI) | Success callback (Fuji) | Fail callback (Fuji) | Facade follow-up |
|-----------|------------|----------------------|-------------------------|----------------------|------------------|
| Fund | `Facade.requestCreditPool` | `creditPool` | `Vault.onPoolCredited` | `Vault.onPoolCreditRejected` | `Facade.onPoolCredited` |
| Claim | `Facade.claim` / `claimTo` | `verifyAndCredit` | `Vault.onPayoutAuthorized` | `Vault.onPayoutRejected` | `payoutTo` + `markClaimed` |
| Clawback | `Facade.clawback` | `clawbackPool` | `Vault.onClawbackAuthorized` | `Vault.onClawbackRejected` | `payoutTo` |

All three register success/fail selectors at send time via `_sendTwoWayWithFee(..., successSelector, rejectSelector)`.

---

## 6. Who the UI calls (and who it never calls)

```mermaid
flowchart TB
  subgraph fuji [Avalanche Fuji — UI]
    UI[Wallet / dApp]
    UI --> pToken[pToken.transfer]
    UI --> Factory[Factory.createCampaign]
    UI --> Store[ClaimStore.submitPayload]
    UI --> Facade[Facade.requestCreditPool / claim / clawback]
    UI --> Comp[Comptroller via claim msg.value]
  end

  subgraph hidden [Not called by UI]
    Vault[PayrollVault]
    Inbox[Inbox]
    PPC[PrivatePayrollCoti]
    Exec[MpcExecutor]
  end

  Facade -.->|internal| Vault
  Vault -.-> Inbox
  Inbox -.-> PPC
```

---

## Related

- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`iterations/ITERATION_08_GAPS.md`](./iterations/ITERATION_08_GAPS.md)
- Skill: `pod-ecosystem-integration/.cursor/skills/pod-sablier-payroll-ui/`
