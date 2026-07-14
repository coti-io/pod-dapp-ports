# Sablier Merkle Instant — System (Phase 1)

Reference: [SablierMerkleInstant](https://github.com/sablier-labs/evm-monorepo/blob/main/airdrops/src/SablierMerkleInstant.sol)

## Actors

| Actor | Role |
|-------|------|
| Employer | Builds merkle roster off-chain, deploys/funds campaign |
| Employee | Claims with `{index, recipient, amount, proof}` |
| Admin | Clawback unclaimed tokens |

## Claim flow (sync)

1. Employer funds campaign ERC20 balance
2. Employee calls `claim(index, recipient, amount, merkleProof)` with `msg.value >= minFee`
3. Contract verifies merkle leaf, marks `hasClaimed(index)`, transfers tokens
4. UI shows **Paid** when tx mines (single step)

## Harness

[`SablierMerkleInstantHarness.sol`](../contracts/SablierMerkleInstantHarness.sol) implements upstream DEFAULT claim semantics for Hardhat tests.
