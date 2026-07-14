# Iteration 07 — Encrypted pool ledger + sim MPC parity

`npm run test:sablier-payroll-pod` passes **35/35**. On-chain underfund (S22) uses encrypted pool `ge` via `checkedSubWithOverflowBit`; sim AVAX surrogate has full `ValidateCiphertext` / MPC precompile parity with simCOTI.

## Architecture

```
Employer pToken.transfer(facade) + sync
        ▼
ackPoolCredit(itUint256) → validateCiphertext → offBoard → _poolBalanceCt (network-key ct)
        ▼
claim(itUint256) → validateCiphertext → _deductPool(checkedSub) → vault / COTI / payout
clawback(balanceIt, payoutIt) → _deductPool → pToken.transfer(payoutIt)
```

## Contract changes

| Surface | Iteration 6 | Iteration 7 |
|---------|-------------|-------------|
| `ackPoolCredit` | removed / ct snapshot (broken onboard) | `itUint256` → validate + `offBoard` → `_poolBalanceCt` |
| `_poolBalanceCt` | — | encrypted pool ledger; deduct on claim/clawback |
| `claim` / `claimTo` | IT calldata; no sync pool check | `validateCiphertext` + `_deductPool` before vault submit |
| `clawback` | single `itUint256` | `itAmount` (facade deduct) + `payoutItAmount` (pToken transfer) |
| S22 underfund | client pre-check in wrapper | on-chain `InsufficientPoolBalance()` |

## Sim / test lib

| File | Change |
|------|--------|
| `mpc-test-utils.ts` | `injectSimCotiPrecompile` on **both** `cotiViem` and `sepoliaViem` |
| `sim-coti-utils.ts` | `registerUserOnDualSim`; `onboardSimUser` optional `sepoliaViem` |
| `pod-scenario.ts` | `ackPoolCredit` via `buildAckPoolIt`; dual sim registration for facade / cotiOwner |
| `campaign-facade.ts` | removed client S22 balance pre-check; clawback dual-IT args |

## Root cause (S22)

`balanceOf` returns **user-key** ciphertext. Storing it in `_poolBalanceCt` and calling `onBoard` decoded with **network key**, yielding wrong plaintext and never underflowing. Fix: employer signs `ackPoolCredit` IT; facade stores **network-key** ct from `offBoard(validateCiphertext(it))`.

## Remaining production gaps

| Gap | Notes |
|-----|--------|
| Claim-state UX | `ClaimInstant` fires before async payout; UI must poll `hasClaimed` + balance sync |
| Mainnet fee oracles | Sim inbox fees; production needs live `PoDPriceOracle` / portal fee paths |
| `ackPoolCredit` trust | Employer attests funded amount; production may bind to pToken transfer callback |

## Commands

```bash
npm run test:sablier-payroll-pod   # 35/35
bash sablier-payroll-pod/scripts/sync-contracts.sh
```
