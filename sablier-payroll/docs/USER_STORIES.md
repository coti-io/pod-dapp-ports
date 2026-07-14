# User stories — Sablier payroll (Phase 1)

| ID | User | UI | Backend |
|----|------|-----|---------|
| S01 | — | Show addresses | Deploy harness + mocks |
| S02 | Employer builds roster | HR exports packages | `buildSablierTree` |
| S03 | Employer funds campaign | "Campaign live" | ERC20 transfer to campaign |
| S04 | Employee opens package | Show salary | Load package |
| S05 | Employee claims | Paid in one tx | `claim` |
| S06 | Second employee claims | Same flow | Independent index |
| S07 | View claimed | Button disabled | `hasClaimed` |
| S08–S11 | Invalid claim | Error toast | Revert |
| S12–S13 | Time bounds | Error toast | start/expiration |
| S13b | Underpay fee | Error toast | `InsufficientFeePayment` |
| S14 | claimTo | Send elsewhere | `claimTo` |
| S15 | Admin clawback | Grace vs active window | Sablier clawback rules |
| S15b | Clawback after expiry | Admin recovery | `clawback` when expired |
| S16 | View activity | ClaimInstant event | Event index/amount public |
| S17 | Full roster paid | Remaining budget | Campaign balance |
| S18 | Clawback no claims | Admin panel | `firstClaimTime==0` |
| S19 | Non-admin clawback | Forbidden | `CallerNotAdmin` |
| S20 | Fee on claim | Fee line item | ETH to comptroller |
| S21 | Middle merkle leaf | — | Multi-leaf proof |
| S22 | Underfunded pool | Payment failed | ERC20 transfer reverts |
| S23 | Fee quote before pay | Confirm fee line | `calculateMinFeeWei` + exact `msg.value` |
| S24 | Overpay fee | — | Excess ETH to comptroller |
| S25 | Wrong employee claims | Not your slot | `recipient != msg.sender` / bad leaf |
| S26 | claimTo zero | Invalid address | `ToZeroAddress` |
| S27 | Two slots, same employee | Two paycheck lines | Two indices, same address |
| S27b | Claim at start boundary | — | `timestamp == start` OK |
| S27c | Claim at expiry boundary | Expired | `timestamp == expiration` fail |
| S28 | Move full paycheck | Send to savings | ERC20 `transfer` |
| S29 | Partial move | Split payment | Partial `transfer` |
| S30 | Approve app to pull | Connected wallet | `approve` + `transferFrom` |
| S31 | claimTo then sweep | Hot → cold wallet | `claimTo` + `transfer` |

**Phase 1 payment coverage:** fund → claim → ERC20 balance → move funds (transfer / approve). PoD async + pToken flows are Phase 2.
