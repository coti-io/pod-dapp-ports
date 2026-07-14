# Conversion to PoD — What Changes and What Was Built

This document explains how a **public EVM distribution app** (Sablier Merkle airdrops as the reference case) becomes **async private payroll on PoD** (AVAX client + COTI server). It is the high-level conversion guide; detailed checklists and patterns live in the sibling files in this skill folder.

**Reference case:** [Sablier Merkle Instant](https://github.com/sablier-labs/evm-monorepo/tree/main/airdrops/src) → private payroll with p.USDT payout.

**Reference implementation:** `coti-contracts/contracts/pod/payroll-eval/` + E2E test `pod-ecosystem-integration/test/payroll/payroll-e2e.test.ts`.

---

## What “conversion to PoD” means

PoD (Privacy on Demand) is not a line-by-line port of Solidity. It is a **re-architecture** along four axes:

| Axis | Public app (Sablier-style) | PoD private payroll |
|------|---------------------------|---------------------|
| **Execution** | Single-chain, synchronous | Cross-chain, asynchronous (inbox mined requests + callbacks) |
| **Who computes** | Same contract verifies and pays | AVAX submits; COTI verifies eligibility and amount in MPC |
| **What is visible** | Amount, recipient, index on-chain | Salary encrypted; AVAX sees only `itUint256` blobs and opaque `proofHandle` |
| **Payout asset** | Public ERC20 `transfer` | pERC20 credit via Privacy Portal; optional partial withdraw |

The UI becomes the **encryption boundary**: it creates `itUint*` inputs the chains treat as opaque; only the user decrypts balances off-chain.

---

## What was done (this iteration)

### Skill and methodology

- Full conversion skill under `.cursor/skills/pod-sablier-payroll-conversion/` (11 files).
- Mandatory workflow: inventory → fork decisions → visibility → client-server split → messaging → mapping → UI → **build validation**.
- Product model locked per user feedback: **pToken default**, **encrypted-leaf merkle**, **no AVAX index**.

### Contracts

| Contract | Chain | Role |
|----------|-------|------|
| `PayrollVault` | AVAX (client) | Run metadata, payroll pool (pToken), `requestPayout`, callbacks |
| `PrivatePayrollCoti` | COTI (server) | `registerRun` / `registerLeaf`, `verifyAndCredit` (merkle + `eq256`) |
| `IPrivatePayrollCoti` | AVAX | Interface for inbox-encoded verify call |

Existing PoD stack reused (not rewritten): `PrivacyPortal`, `PodErc20Mintable`, `PodErc20CotiMother`, `Inbox`, `MpcAbiCodec`.

### Test harness

- E2E: `npm run test:payroll-e2e` (`COTI_BACKEND=testnet`).
- Validates: portal deposit → vault funding → register run/leaf → claim → two async round-trips → encrypted employee balance.

### Build status

- **Buildable:** contracts compile; architecture and test harness complete.
- **E2E green:** depends on stable COTI testnet RPC (Paris EVM overrides fix `PUSH0`; remaining failures are transient RPC issues).
- Details: `BUILD_STATUS.md` in this folder.

---

## How business logic changes

### 1. Campaign / run creation

**Sablier (public)**

- Factory deploys merkle campaign with public `MERKLE_ROOT`.
- Root is built from leaves that include **plaintext** `index`, `recipient`, `amount`.
- Funding is a direct ERC20 transfer into the campaign contract.

**PoD (private)**

- Employer builds merkle tree **off-chain** from **hash commitments** only:

  ```
  leafHash = keccak256(abi.encode(employeeAddress, hash(encryptedAmount)))
  eligibilityRoot = merkleRoot([leafHash...])
  ```

- **AVAX:** `PayrollVault.createRun(eligibilityRoot, pToken, start, expiration)` — public root and pToken address only.
- **COTI:** `registerRun(runId, eligibilityRoot)` + per-employee `registerLeaf(runId, leafHash, employee, itAmount)`.
- **Funding:** `PrivacyPortal.deposit(recipient=PayrollVault, amount)` — locks public USDT, async-mints p.USDT to vault.

**Business change:** Setup splits across two chains; amounts never appear in merkle leaf preimages on-chain; payroll pool is **pToken**, not raw ERC20.

---

### 2. Eligibility / merkle verification

**Sablier (public)**

- `claim(index, recipient, amount, proof)` on one chain.
- Contract verifies `MerkleProof.verify(leaf, root, hash(index, recipient, amount))` with **all fields in calldata**.
- `hasClaimed(index)` is a public bitmap.

**PoD (private)**

- Employee calls `requestPayout(runId, itAmount, proofHandle)` on AVAX — **no `index`**, no plaintext amount.
- `proofHandle = abi.encode(merkleProof, leafHash)` — AVAX forwards opaque bytes to COTI.
- **COTI** `verifyAndCredit`:
  1. `MerkleProof.verify(proof, eligibilityRoot, leafHash)` — public hashes only.
  2. `eq256(registered[leafHash], itAmount)` — private amount match against employer-registered ciphertext.
  3. `claimant == registeredEmployee[leafHash]`.
  4. `!spent[leafHash]` then mark spent.

**Business change:** Merkle proves **membership in the roster** (leaf hash in tree); **amount correctness** is a separate private check on COTI. Double-spend is per `leafHash`, not per public index.

---

### 3. Payout / settlement

**Sablier (public)**

- Same transaction: verify → `_postProcessClaim` → `safeTransfer(recipient, amount)`.
- `Transfer` event exposes amount and recipient on public chain.
- User is “paid” when the tx confirms.

**PoD (private)**

- **v1 nested async (implemented):**
  1. **Verify leg:** AVAX two-way → COTI verify → callback `onPayoutAuthorized` with `itAmount` (still encrypted).
  2. **Transfer leg:** AVAX `pToken.transfer(employee, itAmount)` — second two-way → COTI credits garbled balance via `PodErc20CotiMother`.

- Employee is “paid” only when **pToken balance** reflects salary (decrypt in UI), not when the first tx mines.
- Optional: employee `requestWithdrawWithPermit` for partial public USDT; remainder stays private on COTI.

**Business change:** Payout is **encrypted credit**, not public ERC20 transfer. Settlement is **two-phase async** with two request IDs to track.

---

### 4. Fees and economics

**Sablier (public)**

- Gas only (plus any protocol fee in Sablier factory).

**PoD (private)**

- **Portal fees** on deposit (and withdraw if used).
- **PoD inbox fees** on each two-way leg (verify + pToken transfer) — quote with live gas price per `pod-pp-fee-oracle-upgrade`.
- Employer pre-funds vault and contracts with native currency for inbox callbacks.

**Business change:** Fee model is **multi-layer** (portal + cross-chain inbox × legs). UX must show separate quotes.

---

### 5. Events, observability, and UX state

**Sablier (public)**

- `ClaimInstant(index, recipient, amount, to)` — full visibility.
- State: claimed / not claimed per index.

**PoD (private)**

- `PayoutRequested(requestId, runId)` — no amount, no index.
- `PayoutTransferRequested`, `PayoutCompleted` — track nested async.
- State machine:

  ```
  Submitted → VerifyPending → VerifyCompleted → TransferPending → Paid
                            └→ Failed
  ```

**Business change:** “Paid” is a **derived UI state** after callback + balance decrypt, not tx receipt alone.

---

## Side-by-side: one employee claim

| Step | Sablier Instant | PoD private payroll |
|------|-----------------|---------------------|
| 1 | Employee submits `claim(index, self, amount, proof)` | Employee submits `requestPayout(runId, itAmount, proofHandle)` |
| 2 | Contract verifies merkle with plaintext leaf | Inbox delivers verify to COTI |
| 3 | Contract transfers ERC20 in same tx | COTI merkle + `eq256`; responds with `itAmount` |
| 4 | Done | AVAX callback triggers `pToken.transfer` (second async hop) |
| 5 | — | Employee sees encrypted balance; may partial-withdraw |

---

## What does *not* change (conceptually)

- **Employer still defines a roster** — but roster commitments are registered on COTI, not plaintext leaves on AVAX.
- **Merkle still proves inclusion** — but leaves are hash commitments, not `(index, recipient, amount)`.
- **One claim per entitlement** — enforced by `spent[leafHash]` instead of `hasClaimed(index)`.
- **Time bounds** — `startTime` / `expiration` on AVAX run (same idea as campaign window).

---

## Fork decisions (locked for demo)

Documented in `fork-decisions.md`. Summary:

1. **Payout:** pERC20 via Privacy Portal (not public `safeTransfer`).
2. **Merkle:** encrypted-leaf merkle (`leafHash` tree + `eq256` on COTI).
3. **AVAX calldata:** `runId` + `itAmount` + `proofHandle` — **no index**.
4. **Async:** v1 nested (verify + transfer); v2 single-hop COTI credit deferred.

---

## Demo limitations (honest scope)

| Topic | Demo | Production follow-up |
|-------|------|----------------------|
| Employee identity in `registerLeaf` | Public address on COTI | Encrypted identity commitment |
| `msg.sender` on claim tx | Visible on AVAX | Optional relayer |
| Merkle | Public `leafHash` in `proofHandle` | Hides amount; not full private merkle |
| Clawback | Not in v1 | Add after E2E stable |
| Two async hops | Accepted | Combine on COTI in v2 |
| Fuji / mainnet deploy | Hardhat + testnet harness | Separate deploy runbooks |

---

## Validation checklist

Before calling a conversion “done”:

- [ ] `fork-decisions.md` completed
- [ ] `visibility-matrix.md` filled (no TBD)
- [ ] No plaintext salary on AVAX; no `index` in claim
- [ ] No `MpcCore.decrypt` in AVAX callback
- [ ] Contracts compile
- [ ] `payroll-e2e.test.ts` passes or env blocker documented (`BUILD_STATUS.md`)

Full worksheet: `conversion-checklist.md`.

---

## Related documents in this skill

| File | Use when |
|------|----------|
| `SKILL.md` | Agent workflow and phases |
| `fork-decisions.md` | Early product gates |
| `sablier-instant-mapping.md` | Per-function Sablier → PoD map |
| `visibility-matrix.md` | Who sees what |
| `messaging-decisions.md` | One-way vs two-way legs |
| `implementation-patterns.md` | Solidity patterns + build lessons |
| `test-harness.md` | Run E2E |
| `examples.md` | p.USDT walkthrough |
| `BUILD_STATUS.md` | Current build gate status |
| `extensions.md` | LL/LT/VCA vesting (out of demo scope) |

---

## One-sentence summary

**Conversion to PoD turns synchronous public merkle claims into asynchronous cross-chain private payroll: AVAX holds the pToken pool and submits encrypted claims; COTI verifies eligibility and amount without exposing salary; payout is encrypted pToken credit, not a public ERC20 transfer.**
