# pod-dapp-ports

Monorepo of dApp ports to PoD. Each dApp may have a **Phase 1** native reference harness and a **Phase 2** PoD port that reuses the same user-story tests against async cross-chain contracts.

**Process guide:** [Generic algorithm to make any dApp confidential](GENERIC_ALGORITHM_TO_MAKE_ANY_DAPP_CONFIDENTIAL.md) — four-phase workflow, agentic iteration loop, and verbatim prompts from the Sablier payroll port.

## dApps

### Sablier Payroll

[Sablier Merkle Instant](https://docs.sablier.com/reference/airdrops/contracts/contract.SablierMerkleInstant) airdrop / payroll — merkle-funded instant claims, clawback, and employee payout flows.

| Phase | Folder | What is ported | Tests |
|-------|--------|----------------|-------|
| **1 — Native** | [sablier-payroll/](sablier-payroll/) | Single-chain Hardhat harness (`SablierMerkleInstantHarness`). Plaintext merkle leaves, sync ERC20 payout. Frozen reference — do not edit for PoD work. | S01–S31 (35) · `npm run test:sablier-payroll` |
| **2 — PoD** | [sablier-payroll-pod/](sablier-payroll-pod/) | Same stories on dual-chain simCOTI + AVAX surrogate: `PayrollCampaignFacade`, `PayrollVault`, `PrivatePayrollCoti`, encrypted pToken, Privacy Portal treasury seeding, async inbox mining. | S01–S31 (35) · `npm run test:sablier-payroll-pod` |

**Phase 1 docs:** [USER_STORIES](sablier-payroll/docs/USER_STORIES.md) · [SABLIER_SYSTEM](sablier-payroll/docs/SABLIER_SYSTEM.md) · [POD_MAPPING](sablier-payroll/docs/POD_MAPPING.md)

**Phase 2 docs:** [ARCHITECTURE](sablier-payroll-pod/docs/ARCHITECTURE.md) · [USER_STORIES_EVALUATION](sablier-payroll-pod/docs/USER_STORIES_EVALUATION.md) · [TESTNET](sablier-payroll-pod/docs/TESTNET.md) · [PRODUCTION_DEPLOY](sablier-payroll-pod/docs/PRODUCTION_DEPLOY.md)

#### What the PoD port adds (vs Phase 1)

| Area | Native (Phase 1) | PoD port (Phase 2) |
|------|------------------|---------------------|
| Chains | Hardhat in-memory | Hardhat (AVAX surrogate) + simCOTI |
| Token | Plain ERC20 | `PodErc20Mintable` pToken |
| Merkle leaf | `hash(index, recipient, amount)` | `hash(index, recipient, amountCommitment)` |
| Claim | Sync `transfer` | Async verify on COTI + encrypted payout |
| Amounts | Public in calldata/events | `itUint256` / encrypted pool ledger |
| Funding | Employer ERC20 transfer | Portal treasury seed → encrypted pToken transfer + `ackPoolCredit` |

Story files under `sablier-payroll-pod/test/stories/` are verbatim copies of Phase 1 — evolve contracts and `test/lib` only.

### Port iterations (Sablier Payroll PoD)

Gap reports for each PoD port iteration — what was broken, what changed, and test status at that milestone.

| Iter | Summary | Report |
|------|---------|--------|
| 1 | Bootstrap: port tree, verbatim stories, PoD test lib, basic dual-chain wiring | [ITERATION_01_GAPS.md](sablier-payroll-pod/docs/iterations/ITERATION_01_GAPS.md) |
| 2 | Full async cross-chain — real `runCrossChainTwoWayRoundTrip`, fix COTI `gtUint256` / IT signing | [ITERATION_02_GAPS.md](sablier-payroll-pod/docs/iterations/ITERATION_02_GAPS.md) |
| 3 | Real pToken + Privacy Portal employer funding, double mining (verify + transfer) | [ITERATION_03_GAPS.md](sablier-payroll-pod/docs/iterations/ITERATION_03_GAPS.md) |
| 4 | Portal confined to corporate treasury; campaign funding via employer pToken only | [ITERATION_04_GAPS.md](sablier-payroll-pod/docs/iterations/ITERATION_04_GAPS.md) |
| 5 | Encrypted ops end-to-end; claimant payloads; employer `ackPoolCredit` | [ITERATION_05_GAPS.md](sablier-payroll-pod/docs/iterations/ITERATION_05_GAPS.md) |
| 6 | Private amounts — encrypted calldata, events, registration (no public leak) | [ITERATION_06_GAPS.md](sablier-payroll-pod/docs/iterations/ITERATION_06_GAPS.md) |
| 7 | Encrypted pool ledger + sim MPC parity on AVAX; on-chain S22 underfund | [ITERATION_07_GAPS.md](sablier-payroll-pod/docs/iterations/ITERATION_07_GAPS.md) |

## Quick start

```bash
npm run test:sablier-payroll      # Phase 1 (native)
npm run test:sablier-payroll-pod  # Phase 2 (PoD)
```

Or from a port directory:

```bash
cd sablier-payroll && npm install && npm test
cd sablier-payroll-pod && npm install && npm test
```

Phase 2 requires sibling repos (`coti-pod-inbox-contracts`, `coti-contracts`, `pod-mpc-lib`, `sim-coti-node`, `pod-ecosystem-integration` for the test harness).

## Consumer repos

[`pod-ecosystem-integration`](../pod-ecosystem-integration/) delegates tests here:

- `npm run test:sablier-payroll` → Phase 1
- `npm run test:pod-payroll-port` → Phase 2 (`sablier-payroll-pod`)
