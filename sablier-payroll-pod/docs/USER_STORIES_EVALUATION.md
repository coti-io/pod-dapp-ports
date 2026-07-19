# User Stories — Evaluation (Native vs PoD)

Phase 1 reference: [`pod-dapp-ports/sablier-payroll/`](../../pod-dapp-ports/sablier-payroll/) (native Sablier harness).  
Phase 1 reference: [`sablier-payroll/`](../sablier-payroll/) (native Sablier harness).  
Phase 2 port: `sablier-payroll-pod/` (PoD + simCOTI).

**Evaluation baseline:** iteration 8 (thin Fuji facade; encrypted pool on COTI only).  
**Test status (last run):** PoD suite includes architecture e2e (`10-architecture-fund-claim`); see `ITERATION_08_GAPS.md`.

| Suite | Command | Wall time |
|-------|---------|-----------|
| Native | `npm run test:sablier-payroll` | ~47s |
| PoD | `npm run test:sablier-payroll-pod` | ~90–120s |

**Token:** PUSD (native) / pPUSD (PoD), **6 decimals**. Story amounts are **base units** (e.g. `2_500` = 0.0025 display tokens). UI copy like “$10k funded” is narrative; on-chain S03 uses `10_000` base units.

**Treasury (PoD only):** one-time portal seed of **50,000,000** base units (50 pPUSD) to employer per scenario (test infra).

---

## Iteration 8 — what changed for UI

| Topic | Before (iter 7) | Now (iter 8) |
|-------|-----------------|--------------|
| Employer fund | Public transfer + Fuji `ackPoolCredit` (local MpcCore) | Public transfer + **`requestCreditPool`** → COTI `creditPool` |
| Pool ledger | `_poolBalanceCt` on Fuji facade | **`_poolBalanceCt` on PrivatePayrollCoti only** |
| Claim / payout | Facade local deduct + encrypted `payoutTo(it)` | COTI verify+deduct → callback → **public** `payoutTo(uint256)` |
| Underfund (S22) | Fuji `_deductPool` | COTI `_deductPool` in `verifyAndCredit` / `clawbackPool` |
| Clawback | Dual IT on Fuji | Public amount + COTI pool clawback via inbox |
| Sim | Injected 0x64 on AVAX surrogate (masked the bug) | **Facade never needs AVAX 0x64**; precompile on COTI only |

---

## Privacy & UI readiness (summary)

| User need | Native | PoD | Truly private? |
|-----------|--------|-----|----------------|
| Employer funds campaign | Public ERC20 transfer | Public pToken transfer + COTI `creditPool` via inbox | **Partial** — fund amount public on wire; pool ledger private on COTI |
| Employee sees salary on-chain | Plaintext in merkle + claim calldata | `amountCommitment` in merkle; **`itUint256`** in claim calldata | **Yes** — no plaintext amount in leaves or claim args |
| Employee gets paid | Sync public ERC20 | Async public `pToken.transfer(uint256)` after COTI verify | **Partial** — amount public on payout hop; pool private on COTI |
| Activity feed (S16) | `ClaimInstant` with public amount | `ClaimInstant` with `amountCommitment` | **Partial** — index/recipient public; amount is commitment hash only |
| Move funds after pay (S28–31) | Public ERC20 | Encrypted pToken + decrypt in adapter | **Yes** — if UI uses encrypted paths |
| Employer treasury | Mock `mint` | Privacy Portal deposit (test infra) | **Yes** for balances; portal is separate UI |
| Underfund guard (S22) | Sync `balanceOf` check | COTI encrypted pool `_deductPool` on verify/clawback | **Yes** — reverts on COTI mine when pool insufficient |
| Wrong amount (S09) | Plaintext compare | COTI `verifyAndCredit` private eq | **Yes** — mismatch reverts on COTI |

**UI launch:** Ready for **sim/dev** with async state machine, `submitPayload` + claim ITs, public fund + `requestCreditPool`, and dual fee lines (comptroller ETH + inbox ETH). **Not production-ready** until honest claim-state UX, mainnet fee oracles, and Fuji redeploy of thin facade. See `docs/iterations/ITERATION_08_GAPS.md`.

---

## Fee model

### Native (typical successful claim, e.g. S05)

- Employer `mint` + `transfer` to campaign (mock mint, no cost)
- Protocol fee: `0` wei unless `minFeeUSD` configured → comptroller (S20–S24)
- PoD inbox: none
- **UX:** one tx; balance updates same block

### PoD (typical successful claim, e.g. S05 ~1.1s)

Approximate inbox fees per two-way leg (sim logs):

| Leg | ~targetFee (wei) | ~callbackFee (wei) |
|-----|------------------|---------------------|
| pToken transfer (fund / payout / clawback) | ~19,200,000 | ~430,000 |
| Payroll verify (COTI) | ~22,800,000 | ~913,000 |

Per successful claim (campaign already funded): ~2 inbox round-trips → **~45–50M wei** inbox ETH, plus claim tx gas, plus optional comptroller wei.

Per new campaign (e.g. S03): deploy + COTI leaf registration + encrypted fund + `ackPoolCredit` (~2–3 inbox mines) → **~1–3s** vs native **&lt;100ms**.

---

## Story reference

Format: **UI intent** → **Example** → **Native** → **PoD** → **Notes / fees**

---

### S01 — Deploy wiring

| | |
|--|--|
| **UI** | Show token, comptroller, and campaign addresses after setup. |
| **Example** | Campaign funded **5,000** units; roster alice **1,000**. |
| **Native** | Deploy harness; mint/transfer **5,000** to campaign. **Pass.** |
| **PoD** | Deploy portal, pToken, vault, facade; encrypted fund **5,000** + `ackPoolCredit`. **Pass** (~31s). |
| **Fees** | Native: gas only. PoD: portal seed + token registration + fund mines. |

---

### S02 — Build merkle off-chain

| | |
|--|--|
| **UI** | HR exports claim packages (index, recipient, amount). |
| **Example** | Alice **2,500**, bob **3,000**, carol **1,500**; 3-leaf tree + proofs. |
| **Native** | Plaintext amounts in leaves. **Pass.** |
| **PoD** | Leaves use `amountCommitment` (hash of encrypted amount). **Pass** (~526ms). |
| **Fees** | None (off-chain). See `docs/MERKLE_POD.md`. |

---

### S03 — Funded campaign

| | |
|--|--|
| **UI** | “Campaign live — budget on-chain.” |
| **Example** | Fund **10,000** units; roster totals **7,000** (alice 2,500 + bob 3,000 + carol 1,500). |
| **Native** | `campaign.balance` = **10,000**. **Pass.** |
| **PoD** | Encrypted treasury → facade **10,000** + `ackPoolCredit(itUint256)`; decrypted pToken balance **10,000**. **Pass** (~1.1s). |
| **Fees** | Native: 1 transfer. PoD: ~2 inbox legs for fund + 1 ack tx. |

---

### S04 — View claim package

| | |
|--|--|
| **UI** | Employee opens payroll line; sees salary and index. |
| **Example** | Alice: salary **2,500**, index **0**. |
| **Native** | Preview from off-chain package (plaintext). **Pass.** |
| **PoD** | Same off-chain package; on-chain leaf has commitment only. **Pass.** |

---

### S05 — Claim (sync paid)

| | |
|--|--|
| **UI** | One action → “Paid.” |
| **Example** | Alice claims **2,500**; balance **0 → 2,500**. |
| **Native** | Single `claim` tx; paid same block. **Pass.** |
| **PoD** | `submitPayload` + `claim(itUint256)` + `_deductPool` + payroll mine + pToken mine; alice **2,500**. **Pass** (~1.1s). |
| **Fees** | Native: ~0 protocol. PoD: ~45M wei inbox + mines. |

---

### S06 — Second employee claims

| | |
|--|--|
| **UI** | Same claim flow for another roster slot. |
| **Example** | Alice **2,500**, then bob **3,000** from **10,000** fund. |
| **Native** | Both paid; independent indices. **Pass.** |
| **PoD** | Pool ledger deducts per claim; both paid after mines. **Pass** (~3.1s). |

---

### S07 — Already claimed

| | |
|--|--|
| **UI** | Disable claim button; show “Already claimed.” |
| **Example** | After alice claims index **0**, `hasClaimed(0) === true`. |
| **Native / PoD** | **Pass.** PoD: `hasClaimed` set after COTI callback, not at claim tx. |

---

### S08 — Bad merkle proof

| | |
|--|--|
| **UI** | Error toast: invalid proof. |
| **Example** | Corrupted proof bytes. |
| **Native / PoD** | Revert before payout. **Pass** (PoD ~722ms). |

---

### S09 — Wrong amount

| | |
|--|--|
| **UI** | Error: amount does not match roster. |
| **Example** | Roster **1,000**; claim submits **2,000**. |
| **Native** | Plaintext amount check. **Pass.** |
| **PoD** | COTI private eq or facade IT validation reverts. **Pass.** |

---

### S10 — Double claim

| | |
|--|--|
| **UI** | Error: already claimed. |
| **Example** | Alice claims twice on index **0**. |
| **Native / PoD** | Second claim reverts. **Pass** (PoD first claim mines). |

---

### S11 — Wrong recipient

| | |
|--|--|
| **UI** | Error: not your allocation. |
| **Example** | Package recipient bob; alice wallet submits. |
| **Native / PoD** | Revert. **Pass.** |

---

### S12 — Before campaign start

| | |
|--|--|
| **UI** | Error: campaign not started. |
| **Example** | `campaignStartTime = now + 3600`; claim immediately. |
| **Native / PoD** | Revert. **Pass.** |

---

### S13 — After expiration

| | |
|--|--|
| **UI** | Error: campaign expired. |
| **Example** | Expiration `now + 100`; advance time past expiry. |
| **Native / PoD** | Revert. **Pass.** |

---

### S13b — Insufficient protocol fee

| | |
|--|--|
| **UI** | Error: insufficient fee. |
| **Example** | `minFeeUSD = 1`; `msg.value = 0` on claim. |
| **Native / PoD** | Revert. **Pass.** |

---

### S14 — claimTo external wallet

| | |
|--|--|
| **UI** | Send salary to external wallet. |
| **Example** | Alice claims **2,500** → carol; alice balance stays **0**. |
| **Native / PoD** | Carol **+2,500**. **Pass** (PoD ~1.2s). |

---

### S15 — Admin clawback (grace rules)

| | |
|--|--|
| **UI** | Clawback allowed in grace; blocked after grace while active. |
| **Example** | After alice claims, admin clawbacks **1,000** to employer in grace; after 7 days blocked. |
| **Native** | Public clawback. **Pass.** |
| **PoD** | Dual-IT clawback (`balanceIt` + `payoutIt`), `_deductPool`, mine. **Pass** (~1s). |

---

### S15b — Clawback when expired

| | |
|--|--|
| **UI** | Admin recovery after campaign expiry. |
| **Example** | Clawback **1,000** to employer after expiration. |
| **Native / PoD** | **Pass.** PoD: encrypted clawback path. |

---

### S16 — ClaimInstant event

| | |
|--|--|
| **UI** | Activity feed entry for claim. |
| **Example** | Event: index **0**, recipient alice, `amountCommitment` in same block as claim. |
| **Native** | **Pass.** Amount is **public** on-chain. |
| **PoD** | **Pass.** Emits `amountCommitment` (hash), not plaintext salary. |

---

### S17 — Full roster claims

| | |
|--|--|
| **UI** | Remaining campaign budget updates. |
| **Example** | Fund **10,000**; pay 2,500 + 3,000 + 1,500; remaining **3,000**. |
| **Native** | Public balance decreases. **Pass.** |
| **PoD** | Pool ledger + decrypted adapter balance; remaining **3,000**. **Pass** (~1.5s). |

---

### S18 — Clawback before any claim

| | |
|--|--|
| **UI** | Admin clawback when `firstClaimTime == 0`. |
| **Example** | Clawback **2,000** to employer. |
| **Native / PoD** | **Pass** (PoD ~2s). |

---

### S19 — Non-admin clawback

| | |
|--|--|
| **UI** | Forbidden for non-admin. |
| **Example** | Alice calls `clawback`. |
| **Native / PoD** | Revert. **Pass.** |

---

### S20 — Fee to comptroller

| | |
|--|--|
| **UI** | Protocol fee line item on claim. |
| **Example** | `minFeeUSD = 5`; comptroller receives **5** wei. |
| **Native / PoD** | **Pass** (PoD ~3s). |

---

### S21 — Middle merkle leaf

| | |
|--|--|
| **UI** | Multi-leaf proof (not only first/last index). |
| **Example** | Bob index **1** claims **2,000**. |
| **Native / PoD** | **Pass.** |

---

### S22 — Underfunded campaign

| | |
|--|--|
| **UI** | Payment failed — insufficient pool. |
| **Example** | Salary **5,000**; fund **2,000**; claim reverts; alice **0**. |
| **Native** | Sync `balanceOf` check. **Pass.** |
| **PoD** | Facade `_deductPool` → `InsufficientPoolBalance()` (sync, before vault). **Pass.** |

---

### S23 — Fee quote before pay

| | |
|--|--|
| **UI** | Quote matches successful claim `msg.value`. |
| **Example** | Quote **3** wei; claim with **3** wei; alice paid **1,000**. |
| **Native / PoD** | **Pass** (PoD ~1.2s). |

---

### S24 — Overpaid claim fee

| | |
|--|--|
| **UI** | Full `msg.value` forwarded to comptroller. |
| **Example** | Overpay **10** wei; comptroller **+10**. |
| **Native / PoD** | **Pass.** |

---

### S25 — Wrong employee wallet

| | |
|--|--|
| **UI** | Not your payroll slot. |
| **Example** | Bob tries to claim alice's package. |
| **Native / PoD** | Revert; bob **0**. **Pass.** |

---

### S26 — claimTo zero address

| | |
|--|--|
| **UI** | Invalid payout address. |
| **Example** | `claimTo(address(0))`. |
| **Native / PoD** | Revert. **Pass.** |

---

### S27 — Two slots, same employee

| | |
|--|--|
| **UI** | Two paycheck lines for one employee. |
| **Example** | Alice index **0** **1,000** + index **1** **1,500** = **2,500**; fund **5,000**. |
| **Native / PoD** | **Pass** (PoD ~1.2s). |

---

### S27b — Claim at start boundary

| | |
|--|--|
| **UI** | Claim allowed exactly at `CAMPAIGN_START_TIME`. |
| **Example** | Start `now + 100`; warp to start; alice claims **1,000**. |
| **Native / PoD** | **Pass** (PoD ~2.3s). |

---

### S27c — Claim at expiry boundary

| | |
|--|--|
| **UI** | Claim rejected at expiration timestamp. |
| **Example** | Expiration `now + 200`; warp to expiration; claim reverts. |
| **Native / PoD** | **Pass.** |

---

### S28 — Transfer full paycheck to savings

| | |
|--|--|
| **UI** | Move full paycheck after claim. |
| **Example** | Alice claims **3,200**; transfers **3,200** to carol (savings). |
| **Native** | Public ERC20 transfer. **Pass.** |
| **PoD** | Encrypted transfer + mine. **Pass** (~1.9s). |

---

### S29 — Partial transfer

| | |
|--|--|
| **UI** | Split payment (e.g. rent). |
| **Example** | Bob claims **4,000**; sends **1,500** to alice. |
| **Native / PoD** | **Pass** (PoD ~1.4s). |

---

### S30 — Approve + transferFrom

| | |
|--|--|
| **UI** | Connected app pulls approved amount. |
| **Example** | Alice claims **2,000**; approves carol **800**; carol `transferFrom` **800**. |
| **Native / PoD** | **Pass** (PoD ~1.5s). |

---

### S31 — claimTo then sweep wallets

| | |
|--|--|
| **UI** | Direct deposit to hot wallet; sweep to cold storage. |
| **Example** | Alice `claimTo` bob **2,500**; bob transfers **2,500** to carol. |
| **Native / PoD** | **Pass** (PoD ~1.3s). |

---

## Native vs PoD — comparison

| Dimension | Native Sablier | PoD port |
|-----------|----------------|----------|
| Tests | 35/35 | 35/35 |
| Suite time | ~47s | ~90–95s |
| Typical claim | 1 tx, same-block | 1 tx + 2 cross-chain mines |
| Typical claim latency | &lt;100ms | ~0.9–3s |
| Inbox ETH per claim | 0 | ~45–50M wei (sim) |
| Token movements | Public | Public pToken fund/payout; encrypted pool on COTI |
| Merkle amounts on-chain | Plaintext in leaf | `amountCommitment` hash |
| Claim calldata | Plaintext `uint128` | `itUint256` (encrypted; verified on COTI) |
| Claim events | Public `amount` | `amountCommitment` only |
| Pool underfund (S22) | Sync balance check | COTI encrypted pool + `checkedSub` |
| Employer funding | `mint` + `transfer` | Portal seed + public transfer + `requestCreditPool` |
| Clawback | Plaintext amount | Public amount + COTI `clawbackPool` |
| Sim MPC | N/A | Precompile on **COTI only** (facade is thin) |
| UI async state | Optional | **Required** |

---

## UI flow checklist

1. **Employer (S02–S03):** Build merkle with commitments off-chain; fund via public `token.transfer(facade, amount)`; wait settle; submit **`requestCreditPool(amount)`** (admin + inbox fee); poll `poolCreditedTotal`.
2. **Employee claim (S04–S07):** Quote comptroller fee + inbox fee; `PodClaimStore.submitPayload` (verify IT); `claim(itUint256)`; poll until `hasClaimed` and balance sync.
3. **Activity (S16):** Treat `ClaimInstant` as “claim submitted” — commitment hash visible, not salary; confirm payout via `hasClaimed` + balance.
4. **Admin clawback (S15, S18):** `clawback(to, amount)` with inbox fee; mine COTI clawback + public payout callback.
5. **Post-payroll (S28–31):** Encrypted pToken transfer/approve — async completion (see `pod-privacy-portal` skill).

---

## Production gaps (not blocking sim stories)

| Gap | UI impact |
|-----|-----------|
| Claim-state UX | `ClaimInstant` fires before async payout completes |
| Mainnet fees | Sim inbox wei; production needs live oracle / portal fee quotes |
| Live Fuji redeploy | Existing facades still call 0x64 until factory/facade redeploy |
| Credit UX binding | Optional later: bind `creditPool` to inbound Transfer settle |

Details: `docs/iterations/ITERATION_08_GAPS.md`.

---

## Related docs

- `pod-dapp-ports/sablier-payroll/docs/USER_STORIES.md` — Phase 1 story index
- `docs/MERKLE_POD.md` — PoD merkle / commitment spec
- `docs/ARCHITECTURE.md` — contract split and claim flow
- `docs/iterations/ITERATION_01_GAPS.md` … `ITERATION_08_GAPS.md` — iteration gap reports
