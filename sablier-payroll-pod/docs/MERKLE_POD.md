# Merkle — PoD payroll port

Sablier-shaped tree with private amount commitments.

## Leaf

```
amountCommitment = keccak256(abi.encode(ctUint256))
inner            = keccak256(abi.encode(index, recipient, amountCommitment))
leaf             = keccak256(bytes.concat(inner))
```

Tree pairing uses commutative `keccak256` (same as Phase 1 `pod-dapp-ports/sablier-payroll/test/lib/merkle.ts`).

## Story contract (S02)

`encodeLeaf(index, recipient, amount)` accepts plaintext `amount` and derives `amountCommitment` from sim ciphertext — stories need not change.

## Registration

- **Facade**: `registerLeaf(index, recipient, amount, commitment)`
- **COTI**: `registerLeaf(runId, index, employee, commitment, itAmount)`

## Claim proofHandle (async path)

`abi.encode(bytes32[] proof, uint256 index)` — COTI rebuilds leaf from stored `_amountCommitment[runId][index]`.
