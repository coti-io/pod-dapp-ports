# Sablier Merkle leaf (matches upstream SablierMerkleBase)

```
inner = keccak256(abi.encode(index, recipient, amount))
leaf  = keccak256(bytes.concat(inner))
```

- `index`: uint256 roster slot
- `recipient`: address employee
- `amount`: uint128 salary in token smallest units

Tree pairing uses OpenZeppelin `Hashes.commutativeKeccak256` (sort pair before hash).

Implemented in [`test/lib/merkle.ts`](../test/lib/merkle.ts).
