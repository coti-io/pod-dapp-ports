# Fork Decisions (Required Early Gate)

Document all four decisions in the conversion deliverable **before** contract design. These are not optional defaults.

## Decision 1 — Payout asset (default: pToken)

| Path | Privacy | When to use |
|------|---------|-------------|
| **pERC20 via PrivacyPortal** (recommended) | Salary stays encrypted on COTI; employee controls partial withdraw | Private payroll demo and production |
| Public ERC20 / WAVAX `safeTransfer` on callback | Amount visible in `Transfer` event | **Do not use** for private payroll |

**Default product model:**

1. Employer funds via `PrivacyPortal.deposit` → underlying USDT locked, p.USDT minted to `PayrollVault`
2. Employee claim credits p.USDT via encrypted `pToken.transfer(to, itUint256)`
3. Employee withdraws only what they need via `requestWithdrawWithPermit` — remainder stays private on COTI

See `pod-privacy-portal` for portal and pToken async lifecycle.

**Anti-pattern:** `MpcCore.decrypt(amount)` in AVAX callback to drive `safeTransfer` — destroys salary privacy at payout.

---

## Decision 2 — Merkle model (default: encrypted-leaf merkle demo)

Sablier uses `leaf = hash(index, recipient, amount)` verified on-chain with plaintext fields. Private payroll uses **hash commitments** built from encrypted data off-chain.

```
Employer off-chain:
  ctAmountCommitment = encrypt(salary) via COTI SDK
  leafHash = keccak256(abi.encode(employeeAddress, ctAmountCommitment))
  merkle tree built from leafHash values only
  eligibilityRoot = tree root

COTI setup (employer):
  registerLeaf(runId, leafHash, itAmount) per employee

Employee claim:
  proofHandle = abi.encode(merkleProof, leafHash)   // opaque on AVAX
  itAmount = encrypted salary from UI

COTI verify:
  MerkleProof.verify(proof, root, leafHash)         // public path on COTI
  eq256(registered[leafHash], itAmount)             // private amount match
  claimant == registeredEmployee[leafHash]
```

**Why this works for demo:** Merkle path verification uses public sibling hashes only. Amount privacy is preserved via `eq256` on registered ciphertext — no MPC keccak required.

**Invalid:** Sablier-style `MerkleProof.verify` on AVAX with plaintext `amount` in calldata.

**Invalid:** `leaf = hash(index, recipient, amount)` with plaintext amount anywhere on AVAX.

Legacy labels (Strategy A/B) in older docs map to this pattern — use **encrypted-leaf merkle** as the primary name.

---

## Decision 3 — AVAX calldata shape (default: no index)

| Field on AVAX | Include? | Notes |
|---------------|----------|-------|
| `runId` | Yes | Public run identifier |
| `itAmount` | Yes | Encrypted salary — opaque to AVAX contract |
| `proofHandle` | Yes | Opaque bytes: `abi.encode(merkleProof, leafHash)` |
| `index` | **No** | Sablier roster index leaks membership; not needed |
| Plaintext `amount` | **No** | Always `itUint256` |
| Plaintext `recipient` | **No** | Use `msg.sender` as claimant |

**Do we need index on AVAX?** No. Eligibility is proven via `leafHash` + merkle proof inside `proofHandle`. Double-spend prevention uses `spent[leafHash]` on COTI.

---

## Decision 4 — Async shape (default: nested two-way v1)

| Version | Flow | Round-trips |
|---------|------|-------------|
| **v1 nested** (build first) | COTI verify → callback → AVAX `pToken.transfer(itAmount)` | 2 two-way |
| **v2 combined** (optimize later) | COTI verify + credit on `PodErc20CotiMother` in one COTI call | 1 two-way |

v1 mirrors existing `PodERC20` patterns and is easier to test. Document both; implement v1 for demo.

---

## Decision log template

```
Fork decisions:
- Payout asset: pERC20 via PrivacyPortal (p.USDT)
- Merkle model: encrypted-leaf merkle (leafHash commitments)
- AVAX calldata: runId + itAmount + proofHandle (no index)
- Async shape: v1 nested (verify + pToken transfer)
- Accepted demo leaks: msg.sender on claim tx; employee address in COTI leaf registration
```
