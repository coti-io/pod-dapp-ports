# Sablier Instant → Private Payroll Mapping

Primary reference: [SablierMerkleInstant](https://github.com/sablier-labs/evm-monorepo/blob/main/airdrops/src/SablierMerkleInstant.sol).

**Default fork decisions:** pToken payout, encrypted-leaf merkle, no AVAX index. See `fork-decisions.md`.

## Summary table

| Sablier (public) | Private payroll target | Messaging | Owner chain |
|------------------|------------------------|-----------|-------------|
| `createMerkleInstant(...)` | `createRun(eligibilityRoot)` + COTI `registerRun` | One-way registration | AVAX + COTI |
| Fund campaign | `PrivacyPortal.deposit` → p.USDT to `PayrollVault` | Sync + mint async | AVAX portal → pToken |
| `claim(index, recipient, amount, proof)` | `requestPayout(runId, itAmount, proofHandle)` | **Two-way** verify | AVAX → COTI → AVAX callback |
| `_postProcessClaim` ERC20 transfer | `pToken.transfer(employee, itAmount)` | **Two-way** transfer | AVAX → COTI credit |
| `_preProcessClaim` merkle verify | COTI `verifyAndCredit` on `leafHash` | Part of verify two-way | COTI |
| `hasClaimed(index)` | `spent[leafHash]` on COTI + `payoutRequestStatus` on AVAX | Read | COTI + AVAX |
| `clawback` | `requestClawback` (v2 — not in v1 temp) | Two-way | TBD |
| `MERKLE_ROOT` | `eligibilityRoot` from encrypted-leaf tree | Public commitment | AVAX + COTI |
| `ClaimInstant` event | `PayoutRequested(requestId, runId)` | Event | AVAX — no amount, no index |

---

## Encrypted-leaf merkle (primary pattern)

Replaces legacy Strategy A/B labels.

### Employer off-chain

```
ctAmount = encrypt(salary) via COTI SDK
leafHash = keccak256(abi.encode(employeeAddress, keccak256(ctAmount)))
merkle tree from [leafHash_0, leafHash_1, ...]
eligibilityRoot = tree.root()
```

Amount is **never** in the merkle leaf preimage on-chain. Tree contains hash commitments only.

### Employer on-chain setup

| Step | Chain | Function |
|------|-------|----------|
| Create run | AVAX | `PayrollVault.createRun(eligibilityRoot, pToken, start, expiration)` |
| Register run | COTI | `PrivatePayroll.registerRun(runId, eligibilityRoot)` |
| Register employees | COTI | `PrivatePayroll.registerLeaf(runId, leafHash, employee, itAmount)` per employee |
| Fund payroll pool | AVAX | `PrivacyPortal.deposit(PayrollVault, amount, ...)` |

### Employee claim

| Field | AVAX calldata | Notes |
|-------|---------------|-------|
| `runId` | Yes | Public |
| `itAmount` | Yes | Encrypted salary |
| `proofHandle` | Yes | `abi.encode(merkleProof, leafHash)` — opaque to AVAX |
| `index` | **No** | Not needed |
| `amount` plaintext | **No** | Invalid |

### COTI verify

1. `MerkleProof.verify(proof, eligibilityRoot, leafHash)` — public hashes on COTI
2. `eq256(registered[leafHash], itAmount)` — private amount match
3. `claimant == registeredEmployee[leafHash]`
4. `!spent[leafHash]`
5. `inbox.respond(abi.encode(runId, leafHash, claimant, itAmount))` — no decrypt

### AVAX payout (v1 nested)

Callback `onPayoutAuthorized` → `pToken.transfer(claimant, itAmount)` — second two-way to credit COTI garbled balance.

---

## Payout asset

| Path | Use |
|------|-----|
| **pERC20 via PrivacyPortal** (default) | Private payroll — p.USDT credit |
| Public ERC20 `safeTransfer` | **Do not use** — leaks amount in Transfer event |

Employer funds: underlying USDT → portal → p.USDT minted to vault.
Employee receives: encrypted pToken balance on COTI.
Employee withdraws: optional partial `requestWithdrawWithPermit` — remainder stays private.

---

## Per-function detail

### `claim` → `requestPayout`

**Sablier:** sync verify + transfer in one tx with public `index`, `recipient`, `amount`.

**Private:**

```solidity
// AVAX — no index
function requestPayout(
    uint256 runId,
    itUint256 calldata itAmount,
    bytes calldata proofHandle,
    uint256 callbackFeeLocalWei
) external payable returns (bytes32 requestId);
```

```solidity
// COTI
function verifyAndCredit(
    uint256 runId,
    address claimant,
    itUint256 calldata itAmount,
    bytes calldata proofHandle
) external; // inbox-delivered
```

**Invalid:** `claim(index, recipient, amount, proof)` unchanged with encrypted amount wrapper.

### `hasClaimed(index)` → spent flag

| Sablier | Private |
|---------|---------|
| Public bitmap keyed by `index` | `spent[runId][leafHash]` on COTI |
| Anyone queries any index | AVAX exposes `payoutRequestStatus(requestId)` only |

### Events

| Sablier | Private |
|---------|---------|
| `ClaimInstant(index, recipient, amount, to)` | `PayoutRequested(requestId, runId)` |
| — | `PayoutTransferRequested(requestId, transferId, runId)` |
| — | `PayoutCompleted(requestId, runId)` |

---

## Legacy Strategy A/B (deprecated labels)

| Old label | Maps to |
|-----------|---------|
| Strategy A (private verify on COTI) | Encrypted-leaf merkle with proofHandle |
| Strategy B (pre-registered roster) | `registerLeaf` on COTI — same as demo setup |

Use **encrypted-leaf merkle** as the single primary pattern name.
