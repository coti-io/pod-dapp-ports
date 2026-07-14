# Extensions: Sablier LL / LT / VCA / Execute

Sablier MerkleInstant is the **primary** conversion target. Other campaign types in [airdrops/src](https://github.com/sablier-labs/evm-monorepo/tree/main/airdrops/src) extend the same client-server model but add **time-based** and **conditional** logic that must move entirely to COTI.

Apply the same mandatory phases from `SKILL.md` before mapping any extension.

## Campaign type overview

| Sablier type | Public behavior | Payroll use case |
|--------------|-----------------|------------------|
| **MerkleInstant** | One-shot claim + transfer | Bonus, one-time payment |
| **MerkleLL** (Linear Lockup) | Claim creates Sablier stream with linear vesting | Salary vesting over period |
| **MerkleLT** (Linear Timed) | Timed tranche unlock | Scheduled payroll ticks |
| **MerkleVCA** (Variable Collateral Allocation) | Conditional allocation | Performance-based pay |
| **MerkleExecute** | Custom execution hook | Complex payroll rules |

---

## MerkleLL — Linear Lockup

**Sablier:** `claim` does not transfer full amount immediately. It creates a Sablier stream with linear unlock between `start` and `end`.

**Private conversion:**

| Concern | Where |
|---------|-------|
| Total allocated amount | COTI encrypted (`gtUint256`) |
| Vesting schedule (start, end, cliff) | COTI public metadata OK; rate computation on COTI |
| Claimable amount at time T | **COTI MPC math only** |
| Stream ID / per-employee state | COTI private storage |
| Public token release | AVAX callback per withdraw tick |

**Messaging pattern:**

- Initial `claim` → two-way (register vesting position on COTI, optional small AVAX release if cliff = 0)
- Periodic `withdrawVested` → two-way per tick (COTI computes claimable → AVAX releases)
- Higher two-way volume than Instant — budget inbox fees accordingly

**Visibility:**

- Observers must not see full salary or accrued amount on AVAX
- UI decrypts employee's current claimable amount from COTI response

**Do not:** Replicate Sablier stream contract on AVAX with plaintext `amounts`.

---

## MerkleLT — Linear Timed

**Sablier:** Tranches unlock on discrete timestamps.

**Private conversion:**

| Concern | Where |
|---------|-------|
| Tranche schedule | Public metadata on AVAX or COTI |
| Tranche amounts | COTI encrypted per employee |
| Eligibility per tranche | COTI verify at each tick |
| Release | AVAX callback per unlocked tranche |

**Messaging:** One two-way per tranche claim. Employer may batch multiple employees off-chain but each inbox message is per-employee unless designing batch MPC (out of scope).

**UI:** Show next tranche date (public) and encrypted amount (decrypt on demand).

---

## MerkleVCA — Variable Collateral Allocation

**Sablier:** Allocation depends on variable conditions (e.g. KPI, governance vote).

**Private conversion:**

| Concern | Where |
|---------|-------|
| Condition predicate | COTI MPC evaluation |
| Input signals | One-way feeds to COTI or encrypted inputs |
| Final allocation | COTI-only until release callback |
| Public release | AVAX two-way callback |

**Messaging:**

- Condition update → one-way to COTI (if no AVAX state change)
- Allocation finalize → two-way (AVAX releases)

**Visibility:** Condition inputs may be sensitive — classify in `visibility-matrix.md` before design.

---

## MerkleExecute — Custom execution

**Sablier:** Claim triggers arbitrary contract call via execution payload.

**Private conversion:**

- Treat execution payload as **opaque to AVAX** — only COTI interprets
- AVAX callback receives minimal release instruction (token, to, amount or encrypted credit)
- Highest design risk: arbitrary execution must not leak plaintext args on AVAX

**Recommendation:** Defer Execute mapping until Instant + LL/LT patterns are stable. Document as "requires per-payload visibility audit."

---

## Shared extension rules

### Time logic on COTI only

```
block.timestamp checks for vesting → COTI
AVAX stores only public run window (start, end)
```

### Tick volume planning

| Type | Two-way messages per employee |
|------|------------------------------|
| Instant | 1 per claim |
| LL | 1 claim + N withdraw ticks |
| LT | 1 per tranche |
| VCA | 1+ per condition evaluation |
| Execute | Variable |

Document expected inbox cost in conversion deliverable.

### `firstClaimTime` / grace period

Sablier uses `firstClaimTime` for clawback grace. In private design:

- Store on AVAX as public run metadata if acceptable
- Or move clawback eligibility entirely to COTI with encrypted unclaimed totals

### Streaming UI state machine

Extend Instant state machine:

```
Registered → Vesting → TickPending → TickPaid → ... → FullyVested
```

Each `TickPending` follows same async pattern as Instant `Pending`.

---

## When to stop at Instant

If the user only needs one-shot payroll (bonus, contractor payment), **do not** map LL/LT/VCA unless explicitly requested. Note in deliverable:

> "Source app supports [LL/LT/...]. This design covers Instant only. See `extensions.md` for vesting extension path."

---

## Cross-references

- Instant mapping: `sablier-instant-mapping.md`
- Messaging volume: `messaging-decisions.md` § Volume and cost notes
- Visibility for vesting amounts: `visibility-matrix.md`
- Async UI patterns: `pod-privacy-portal` skill
