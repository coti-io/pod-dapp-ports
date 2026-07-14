# Phase 2 stub — Sablier story → PoD mapping

| Story | Sablier (Phase 1) | PoD (Phase 2) |
|-------|-------------------|---------------|
| S03 fund | ERC20 transfer to campaign | PrivacyPortal.deposit → pToken vault |
| S05 claim | `claim(index, recipient, amount, proof)` sync | `requestPayout(runId, itAmount, proofHandle)` + 2 async hops |
| S05 paid | ERC20 balance same tx | pToken balance after callback + decrypt |
| S07 status | `hasClaimed(index)` | `spent[index]` on COTI + `payoutRequestStatus` |
| S13b fee | comptroller minFee | portal fee + 2× inbox fee |
| S14 claimTo | `claimTo` | optional relayer / partial withdraw path |

PoD-only stories to add in Phase 2: async state machine, encrypted amount, partial withdraw.
