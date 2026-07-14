# Iteration 1 — Gap Report

## Summary: 35/35 passing

All Sablier user-story tests pass under `npm run test:sablier-payroll-pod` with `COTI_BACKEND=sim`.

## Passing stories

S01–S31 (35 tests) — deploy, merkle, fund, claim, failures, clawback, extended coverage, payment edges, move funds.

## Resolved in iteration 1

| Area | Fix |
|------|-----|
| Bootstrap | `sablier-payroll-pod/` tree, verbatim stories, PoD test lib |
| Merkle | `encodeLeaf(index, recipient, amount)` → commitment from sim ciphertext |
| Facade | `PayrollCampaignFacade` Sablier API + `wrapCampaignFacade` mining shim |
| Deploy patch | `viem.deployContract` intercept for `SablierMerkleInstantHarness` (S27) |
| Funding | ERC20 on facade (Sablier-shaped); vault pre-funded for inbox fees |
| Sync claims | `simSyncPayout=true` on facade for sim — local payout after merkle pre-checks |

## Remaining gaps (iteration 2+)

| Gap | Stories | Root cause | Planned fix |
|-----|---------|------------|-------------|
| Full async COTI claim | All success paths (currently sim sync) | COTI `verifyAndCredit` mine fails (`errorCode=2`, selector `0x07044e63`) — likely `itUint256` cross-chain codec / validateCiphertext | Debug MpcAbiCodec payload; separate register vs claim IT signatures; re-enable `simSyncPayout=false` |
| pToken payout | — | Iteration 1 uses ERC20 `SablierPayrollToken` for story compatibility | Portal deposit + `pToken.transfer` on vault callback |
| Privacy portal fund | — | Employer funds facade ERC20 directly | Optional portal deposit path for production parity |

## Facade gaps (closed for stories)

- `MERKLE_ROOT`, `TOKEN`, `COMPTROLLER`, `admin`, `hasClaimed`, `calculateMinFeeWei` — implemented
- `claim` / `claimTo` / `clawback` — implemented (sync sim path)
- `ClaimInstant` event — emitted on sync payout

## Contract gaps (closed for stories)

- `hash(index, recipient, commitment)` merkle — facade + COTI
- `registerLeaf` with encrypted amount on COTI — implemented
- `spent[runId][index]` — COTI + facade bitmap
- Underfund S22 — facade transfer reverts when pool insufficient

## Skill updates for iteration 2

- Document `simSyncPayout` toggle and when to disable
- Document `claimPackage` / `claimToPackage` actor paths (preserve tree `leaf` in proofHandle)
- Add async debugging checklist: vault `configure(cotiChainId)`, inbox fees, IT selector split (register vs verify)
- Link this gap report from `.cursor/skills/pod-sablier-payroll-port/SKILL.md`
