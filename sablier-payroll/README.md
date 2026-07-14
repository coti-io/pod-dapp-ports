# Sablier Payroll — User-Story Tests (Phase 1)

Phase 1 validates **Sablier Merkle Instant** payroll user journeys on **Hardhat in-memory** (single chain). Phase 2 lives in [`sablier-payroll-pod/`](../sablier-payroll-pod/) — see [pod-dapp-ports README](../README.md) for the dApp catalog and port iteration index.

## Run tests

```bash
cd sablier-payroll
npm install
npm test
```

From monorepo root: `npm run test:sablier-payroll`

## Success gate

All user stories **S01–S31** pass (35 tests) against `SablierMerkleInstantHarness`:

- Leaf: `keccak256(bytes.concat(keccak256(abi.encode(index, recipient, amount))))`
- `claim` / `claimTo` sync ERC20 payout
- `hasClaimed(index)`, campaign time bounds, clawback grace

Reference: [Sablier Merkle Instant](https://github.com/sablier-labs/evm-monorepo/blob/main/airdrops/src/SablierMerkleInstant.sol)

## Layout

```
sablier-payroll/
  contracts/          # Harness + mocks (compiled directly by Hardhat)
  docs/               # SYSTEM.md, USER_STORIES.md
  test/
    lib/              # merkle, scenario, actors, assertions
    stories/          # S01–S31 user-story tests (8 files)
    runner.ts
```

## Stories

| ID | Description |
|----|-------------|
| S01 | Deploy wiring |
| S02 | Employer builds merkle off-chain |
| S03 | Employer funds campaign |
| S04 | Employee views package |
| S05 | Employee claims (sync paid) |
| S06 | Second employee claims |
| S07 | Already-claimed status |
| S08 | Bad proof |
| S09 | Wrong amount |
| S10 | Double claim |
| S11 | Wrong recipient |
| S12 | Before start |
| S13 | After expiration |
| S13b | Insufficient fee |
| S14 | claimTo external wallet |
| S15 | Admin clawback after grace |
| S15b | Clawback when expired |
| S16–S21 | Events, full roster, clawback auth, fees, merkle |
| S22 | Underfunded campaign |
| S23 | Fee quote before pay |
| S24 | Overpaid fee |
| S25 | Wrong employee wallet |
| S26 | claimTo zero address |
| S27 | Same employee, two indices |
| S27b–c | Start/expiry boundaries |
| S28 | Transfer full paycheck |
| S29 | Partial transfer |
| S30 | Approve + transferFrom |
| S31 | claimTo then sweep wallets |

## Phase 2

See `docs/POD_MAPPING.md` (stub) — same story files, `PodPayrollBackend` adapter.
