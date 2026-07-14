# Conversion Checklist

Copy this worksheet into every conversion deliverable. Check every item before handing off.

## Phase 1 — Inventory

- [ ] All source contracts listed (factory, base, variant)
- [ ] Every `external`/`public` function documented with inputs, outputs, caller
- [ ] Every event documented with indexed fields and leak assessment
- [ ] Every storage slot / immutable documented with visibility
- [ ] Sync vs async behavior noted per function
- [ ] Fee paths identified (who pays, who receives)

## Phase 2 — Fork decisions

- [ ] `fork-decisions.md` completed (pToken, encrypted-leaf merkle, no AVAX index, async shape)
- [ ] Payout asset = pERC20 via PrivacyPortal (not public safeTransfer)
- [ ] Merkle = encrypted-leaf commitments (leafHash tree)
- [ ] AVAX claim has no `index`

## Phase 3 — Visibility

- [ ] `visibility-matrix.md` template fully filled (no TBD cells)
- [ ] Leak vectors reviewed (amount, leafHash, events, msg.sender)
- [ ] Decision log written with accepted tradeoffs
- [ ] Salary stays encrypted on COTI after payout until partial withdraw

## Phase 4 — Client-server split

- [ ] AVAX `PayrollVault` responsibilities listed
- [ ] COTI `PrivatePayroll` responsibilities listed
- [ ] No plaintext salary logic on AVAX
- [ ] No `MpcCore.decrypt` in AVAX callback
- [ ] Custody: portal deposit → pToken pool on vault

## Phase 5 — Messaging

- [ ] Employer `registerLeaf` documented (one-way or direct COTI)
- [ ] Verify leg: two-way with `onPayoutAuthorized` / `onPayoutRejected`
- [ ] Transfer leg: two-way `pToken.transfer(itAmount)` documented
- [ ] Fee model: portal + PoD inbox × 2 legs
- [ ] Callback failure paths defined

## Phase 6 — Sablier-specific

- [ ] Encrypted-leaf merkle documented (not Sablier plaintext leaf)
- [ ] Invalid: `MerkleProof.verify` on AVAX with private amounts
- [ ] Invalid: `index` in AVAX claim calldata
- [ ] `hasClaimed(index)` replaced with `spent[leafHash]` on COTI
- [ ] `ClaimInstant`-style events replaced
- [ ] pToken payout path chosen (default)

## Phase 7 — UI

- [ ] Dual async hops modeled (verify + transfer)
- [ ] Two request IDs tracked from events
- [ ] "Paid" only after pToken transfer callback
- [ ] Employee decrypt path documented
- [ ] Portal + PoD fees quoted separately

## Phase 8 — Types and SDK

- [ ] `gtUint*` as UDVTs per `gt-type-upgrade`
- [ ] `itUint256` for AVAX/UI inputs
- [ ] `proofHandle = abi.encode(merkleProof, leafHash)`
- [ ] SDK encrypt/decrypt helpers identified

## Phase 9 — Build validation

- [ ] Contracts compile
- [ ] `payroll-e2e.test.ts` passes (see `test-harness.md`)
- [ ] No plaintext `amount` on AVAX
- [ ] No AVAX `index` in claim
- [ ] Sequence diagram includes nested async
- [ ] `BUILD_STATUS.md` shows zero demo blockers

---

## Red flags (automatic fail)

| Red flag | Correct approach |
|----------|------------------|
| `amount` plaintext in AVAX calldata | `itUint256` only |
| `index` in AVAX claim calldata | Use `proofHandle` with `leafHash` |
| `MerkleProof.verify` on AVAX | COTI verify on `leafHash` |
| `safeTransfer` for salary payout | `pToken.transfer(itUint256)` |
| `MpcCore.decrypt` in AVAX callback | Forward `itAmount` to pToken |
| Sablier `leaf = hash(index, recipient, amount)` on-chain | `leafHash` commitment tree |
| Mined tx = "paid" | Wait for transfer callback |
| Single fee estimate | Portal + PoD × 2 legs |
