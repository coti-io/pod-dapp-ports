# Reference: Sablier Instant + PoD Primitives

## Source App: Sablier MerkleInstant

Primary reference: [Sablier airdrops/src](https://github.com/sablier-labs/evm-monorepo/tree/main/airdrops/src).

### What Sablier does (public)

- `claim(index, recipient, amount, merkleProof)` — sync verify + ERC20 transfer
- `leaf = hash(index, recipient, amount)` — all plaintext
- `hasClaimed(index)` — public bitmap
- `ClaimInstant` event — leaks index, recipient, amount

### What private payroll does instead

- `requestPayout(runId, itAmount, proofHandle)` — no index, no plaintext amount
- `leafHash = hash(employee, hash(ctAmount))` — amount never in tree preimage
- `spent[leafHash]` on COTI — no public bitmap
- `PayoutRequested(requestId, runId)` — minimal event
- Payout via `pToken.transfer(itUint256)` — encrypted credit on COTI

---

## Encrypted-leaf merkle spec

### Off-chain tree construction

```
ctAmount = SDK.encrypt(salary, employeeKey)
leafHash = keccak256(abi.encode(employeeAddress, keccak256(abi.encode(ctAmount))))
tree = MerkleTree([leafHash_0, leafHash_1, ...])
eligibilityRoot = tree.root
```

### proofHandle wire format

```solidity
proofHandle = abi.encode(bytes32[] merkleProof, bytes32 leafHash)
```

AVAX forwards opaque. COTI decodes and runs `MerkleProof.verify(proof, root, leafHash)`.

### COTI registration

```solidity
registerLeaf(runId, leafHash, employee, itAmount)
// stores: registeredAmountCt[leafHash], registeredEmployee[leafHash]
```

### COTI verify

```solidity
verifyAndCredit(runId, claimant, itAmount, proofHandle)
// 1. MerkleProof.verify (public hashes)
// 2. eq256(registered[leafHash], itAmount)
// 3. claimant == registeredEmployee[leafHash]
// 4. respond with itAmount — no decrypt
```

No MPC keccak required — merkle path uses public sibling hashes; amount privacy via `eq256`.

---

## pToken funding path

### Contracts

| Contract | Role |
|----------|------|
| `PrivacyPortal` | Locks underlying USDT; triggers pToken mint |
| `PodErc20Mintable` | p.USDT on AVAX; minter = portal or vault |
| `PodErc20CotiMother` | COTI garbled balances |
| `PayrollVault` | Holds pToken payroll pool; submits verify + transfer |

### Employer funding flow

```
1. Employer approves USDT to portal
2. portal.deposit(recipient=PayrollVault, amount, portalFee, mintCallbackFee)
3. Async mint → vault has p.USDT garbled balance on COTI
```

### Employee payout flow

```
1. requestPayout → COTI verify (two-way)
2. onPayoutAuthorized → pToken.transfer(employee, itAmount) (two-way)
3. Employee balance encrypted on COTI
4. Optional: portal.requestWithdrawWithPermit(partialAmount)
```

See `PodERC20.mint(to, itUint256)` and `PodERC20.transfer(to, itUint256)` in `coti-contracts/contracts/pod/token/perc20/PodERC20.sol`.

---

## PoD Inbox API

| Method | When |
|--------|------|
| `sendTwoWayMessage` | Verify leg, pToken transfer leg |
| `sendOneWayMessage` | `registerRun`, `registerLeaf` (optional) |

Key fields: `methodCall` with MPC `datatypes`/`datalens`; `callbackSelector`; `errorSelector`.

---

## Proven patterns

| Pattern | File |
|---------|------|
| Two-way send | `PodLibBase._sendTwoWayWithFee` |
| MPC codec | `MpcAbiCodec.create(...).addArgument(itAmount).build()` |
| pToken transfer callback | `PodERC20.transferCallback` |
| Portal deposit | `PrivacyPortal._deposit` |
| Test harness | `pod-ecosystem-integration/test/system/mpc-test-utils.ts` |

### MpcAbiCodec note

`using MpcAbiCodec for MpcAbiCodec.MpcMethodCallContext` must be declared on each contract — **not inherited** from `PodLibBase`.

### Import note

Use `import "../../../utils/mpc/MpcCore.sol"` (file import) for `itUint256` struct in interfaces — not `import {MpcCore}`.

---

## Encryption types

| Type | Where | Role |
|------|-------|------|
| `itUint256` | AVAX calldata | UI-encrypted input |
| `gtUint256` | COTI MPC | Compute type (UDVT) |
| `ctUint256` | COTI storage | `{ ciphertextHigh, ciphertextLow }` |

See `gt-type-upgrade` skill.

---

## AVAX client sketch (current)

```solidity
function requestPayout(
    uint256 runId,
    itUint256 calldata itAmount,
    bytes calldata proofHandle,
    uint256 callbackFeeLocalWei
) external payable returns (bytes32 requestId);

function onPayoutAuthorized(bytes memory data) external onlyInbox;
// → pToken.transfer(claimant, itAmount, ...) — no decrypt
```

## COTI server sketch (current)

```solidity
function verifyAndCredit(
    uint256 runId,
    address claimant,
    itUint256 calldata itAmount,
    bytes calldata proofHandle
) external onlyInbox;
```

---

## Reference implementation

Temp build: `/tmp/pod-payroll-eval/`

Compile via symlink or copy into `coti-contracts/contracts/pod/payroll-eval/` with relative imports.

---

## Terminology

| Sablier | Private payroll |
|---------|-----------------|
| Campaign | Payroll run |
| `claim` | `requestPayout` + pToken transfer |
| `MERKLE_ROOT` | `eligibilityRoot` (leafHash tree) |
| `index` | **Not used on AVAX** — use `leafHash` |
| `TOKEN` transfer | pToken encrypted credit |
| `hasClaimed` | `spent[leafHash]` |
