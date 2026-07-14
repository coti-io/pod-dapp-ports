# Test Harness

E2E validation for private payroll uses the same dual-chain Hardhat harness as Privacy Portal and PodERC20 tests.

Reference impl: [`pod-ecosystem-integration/test/payroll/payroll-e2e.test.ts`](../../../test/payroll/payroll-e2e.test.ts) (mirror: `/tmp/pod-payroll-eval/test/payroll-e2e.test.ts`)

## Prerequisites

- `npm run link:contracts` in `pod-ecosystem-integration` (includes `MpcExecutor` from `pod-mpc-lib`)
- `npx hardhat compile` (Paris overrides for COTI-deployed contracts — see `hardhat.config.ts`)
- COTI SDK for encryption: `@coti-io/coti-sdk-typescript`
- Env: `COTI_TESTNET_RPC_URL`, `COTI_TESTNET_PRIVATE_KEY` (or `PRIVATE_KEY`)
- **`COTI_BACKEND=testnet`** (default is `sim`, which requires `SimExtendedOperations`)

## Run command

```bash
cd /workspaces/pod-ecosystem-integration
npm run test:payroll-e2e
```

Equivalent:

```bash
PAYROLL_E2E_TESTS=1 COTI_BACKEND=testnet npx hardhat test test/payroll/payroll-e2e.test.ts
```

## Harness imports

From [`pod-ecosystem-integration/test/system/mpc-test-utils.ts`](../../../test/system/mpc-test-utils.ts):

- `setupContext` — dual Sepolia/COTI inboxes
- `runCrossChainTwoWayRoundTrip` — mine outbound + return callback
- `fundContractForInboxFees` — pre-fund vault/pToken with native inbox fees
- `podTwoWayWriteOptions` — `msg.value` split for two-way calls

From [`pod-ecosystem-integration/test/privacy/privacy-portal-system-utils.ts`](../../../test/privacy/privacy-portal-system-utils.ts):

- `setupPrivacyPortalSystemContext` — portal + `PodErc20Mintable` + `PodErc20CotiMother`
- Portal deposit round-trip pattern

From [`pod-ecosystem-integration/test/tokens/test-token-utils.ts`](../../../test/tokens/test-token-utils.ts):

- `registerPodTokenOnMother`
- `completePodOpRoundTrip`
- `buildEncryptedInput256` / encryption helpers

## Test steps

### 1. Setup dual-chain context

```ts
const base = await setupContext({ sepoliaViem, cotiViem });
const ppCtx = await setupPrivacyPortalSystemContext({ sepoliaViem, cotiViem });
```

### 2. Deploy payroll contracts

- COTI: `PrivatePayrollCoti(inboxCoti)`
- AVAX: `PayrollVault(inboxSepolia, cotiPayroll, pToken)`

Configure `PayrollVault` with `configure(inbox, cotiPayroll, cotiChainId)` and fund with inbox fees.

### 3. Employer fund via portal

```ts
// portal.deposit(PayrollVault, amount, portalFee, mintCallbackFee)
await completePodOpRoundTrip(ctx, "fund-vault", { ... });
```

### 4. Build encrypted merkle off-chain

```ts
const salary = 1000n * 10n ** 18n;
const itAmount = await buildEncryptedInput256(ctx, salary, employeeAddress);
const leafHash = keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "bytes32" }],
  [employeeAddress, keccak256(encodeAbiParameters([{ type: "bytes" }], [itAmount.ciphertext]))]
));
const { root, proof } = buildMerkleTree([leafHash]);
const proofHandle = encodeAbiParameters(
  [{ type: "bytes32[]" }, { type: "bytes32" }],
  [proof, leafHash]
);
```

### 5. Employer register on COTI

Direct COTI tx (demo — not one-way from AVAX):

```ts
await cotiPayroll.write.registerRun([runId, root]);
await cotiPayroll.write.registerLeaf([runId, leafHash, employeeAddress, itAmount]);
```

### 6. Employee claim — verify leg

```ts
const tx = await payrollVault.write.requestPayout(
  [runId, itAmount, proofHandle, callbackFeeWei],
  { value: totalFeeWei, account: employee }
);
const requestId = extractFromEvent(receipt, "PayoutRequested");

await runCrossChainTwoWayRoundTrip(base, "payroll-verify", {
  outboundRequestId: requestId,
  ...
});
```

### 7. Employee claim — transfer leg

```ts
const transferId = extractFromEvent(callbackReceipt, "PayoutTransferRequested");
await runCrossChainTwoWayRoundTrip(base, "payroll-transfer", {
  outboundRequestId: transferId,
  ...
});
```

### 8. Assert

```ts
const [balance, pending] = await pToken.read.balanceOfWithStatus([employee]);
assert.equal(pending, false);
// Decrypt balance with SDK — non-zero
const decrypted = await decryptUint256(balance, userKey);
assert.equal(decrypted, salary);
```

## Run command

From `pod-ecosystem-integration` (recommended — shares harness):

```bash
cd /workspaces/pod-ecosystem-integration
npx hardhat test /tmp/pod-payroll-eval/test/payroll-e2e.test.ts --network hardhat
```

Or symlink payroll contracts into `coti-contracts/contracts/pod/payroll-eval/` for compile only.

## Failure debugging

| Symptom | Check |
|---------|-------|
| Callback never arrives | Mine COTI outbound request; check `getResponseRequestBySource` |
| `eq256` fails | `itAmount` in claim must match `registerLeaf` ciphertext |
| Merkle verify fails | `leafHash` must be leaf in tree; proof order correct |
| Transfer reverts | Vault has pToken balance; vault funded via portal deposit |
| `tx.gasprice` zero fees | Quote PoD inbox fee with live gas price per `pod-pp-fee-oracle-upgrade` |
| `PUSH0` on COTI testnet deploy | Paris `evmVersion` overrides in `hardhat.config.ts` for inbox/oracle/mother/payroll COTI contracts |
| `SimExtendedOperations` not found | Set `COTI_BACKEND=testnet` (not `sim`) |
| COTI RPC `replacement transaction underpriced` / tx not found | Retry; transient testnet RPC flakiness |

## Build gate

Conversion is **not complete** until:

- [x] Contracts compile
- [ ] `payroll-e2e.test.ts` passes on Hardhat dual-chain (blocked by COTI testnet RPC flakiness when stable)
- [x] No `decrypt` in AVAX callback
- [x] No AVAX `index` in claim calldata

Reference build status: `/tmp/pod-payroll-eval/BUILD_STATUS.md`
