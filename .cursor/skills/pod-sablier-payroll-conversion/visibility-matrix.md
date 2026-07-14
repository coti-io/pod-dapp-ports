# Visibility Matrix

Fill this matrix **before** choosing contract boundaries. See `fork-decisions.md` for default decisions.

## Roles

| Role | Description |
|------|-------------|
| **Employer** | Creates run, funds pToken pool, registers leaves on COTI |
| **Employee** | Claims own payout; decrypts own balance in UI |
| **Admin** | Protocol operator; fee config, pause |
| **Chain observer (AVAX)** | Reads AVAX txs without keys |
| **Chain observer (COTI)** | Reads COTI txs without keys |
| **COTI MPC** | Executes MPC ops on ciphertext |
| **UI (employee)** | Client with employee decryption key |

## Data classes

### Template matrix

Fill every cell: **Public**, **Encrypted-UI**, **MPC-only**, **Hashed**, **Forbidden**.

| Data class | Employer | Employee | Admin | AVAX observer | COTI observer | COTI MPC |
|------------|----------|----------|-------|---------------|---------------|----------|
| Salary amount | Forbidden on-chain | Encrypted-UI (own) | Forbidden | Forbidden | Ciphertext shape | MPC-only |
| Total payroll budget | Public aggregate | Forbidden | Public | Public (portal deposit) | N/A | N/A |
| Employee eligibility | Knows off-chain | Own leaf only | Forbidden | Forbidden | leafHash visible | MPC-only verify |
| Employee wallet | May know roster | Self | Public | Public msg.sender | Public in registerLeaf | Hashed |
| leafHash | Knows off-chain | Own only | Forbidden | Inside proofHandle opaque | Public in proof | Public hash OK |
| proofHandle | N/A | Submits opaque | N/A | Opaque bytes | N/A | Decoded on COTI |
| Merkle sibling hashes | Knows off-chain | In proofHandle | Forbidden | Opaque | Public in verify | Public |
| Spent / claim status | Aggregate | Own via UI | Metadata | requestId status | spent leafHash | MPC-only |
| Claim request id | Forbidden | Own tx | Public | Public | Public | N/A |
| Run schedule / name | Public | Public | Public | Public | N/A | N/A |
| pToken vault balance | Public aggregate | Forbidden | Public | Public | Garbled on COTI | MPC-only |
| p.USDT employee balance | Forbidden | Encrypted-UI | Forbidden | Forbidden | Ciphertext | MPC-only |
| Public USDT withdraw | N/A | Own partial only | N/A | Public if withdrawn | N/A | N/A |

### Recommended defaults (pToken payroll)

| Data class | Employee | AVAX observer | After pToken credit |
|------------|----------|---------------|---------------------|
| Salary amount | Encrypted-UI decrypt | Forbidden | Stays encrypted on COTI |
| leafHash | Knows own | Opaque in calldata | N/A |
| index | **Not used** | N/A | N/A |
| Public USDT | Only if partial withdraw | Visible only withdrawn portion | Remainder private |

---

## Removed: AVAX index

Sablier `index` correlated employees to roster positions. **Private payroll does not use AVAX index.**

Eligibility is proven via:

- `leafHash` inside opaque `proofHandle`
- `msg.sender` as claimant
- COTI `registeredEmployee[leafHash] == claimant`

---

## Leak vectors

### 1. Plaintext amount on AVAX

**Mitigation:** `itUint256` only; pToken `transfer(itAmount)` not `safeTransfer(plaintext)`.

### 2. Sablier-style leaf on AVAX

**Mitigation:** `leafHash` commitment only; verify on COTI.

### 3. Public ERC20 payout

**Mitigation:** Default pToken credit; partial withdraw optional.

### 4. `ClaimInstant` events

**Mitigation:** `PayoutRequested(requestId, runId)` only.

### 5. msg.sender on claim tx

Still visible on AVAX. Optional relayer for production.

### 6. employeeAddress in COTI registerLeaf

Public on COTI in demo. Production: encrypted identity commitment.

---

## Decision log template

```
Visibility decisions:
- Payout: p.USDT encrypted credit (default)
- AVAX claim fields: runId + itAmount + proofHandle (no index)
- Merkle: leafHash commitments; verify on COTI
- Salary after payout: encrypted on COTI until partial withdraw
- Accepted demo leaks: msg.sender; employee address in COTI registerLeaf
```

## Blocking gate

Do not proceed until matrix is filled and leak vectors addressed or accepted.
