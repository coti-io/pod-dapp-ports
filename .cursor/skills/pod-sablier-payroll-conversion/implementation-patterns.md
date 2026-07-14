# Implementation Patterns

Reference implementation lives at `/tmp/pod-payroll-eval/` (temp build). Copy patterns from here and from `coti-contracts` production contracts.

## AVAX client: PayrollVault

### Inheritance and imports

```solidity
import {PodLibBase} from ".../pod/mpc/PodLibBase.sol";
import {MpcAbiCodec} from ".../pod/mpccodec/MpcAbiCodec.sol";
import "../../../utils/mpc/MpcCore.sol";  // file import for itUint256 struct

contract PayrollVault is PodLibBase {
    using MpcAbiCodec for MpcAbiCodec.MpcMethodCallContext;
    // NOTE: `using MpcAbiCodec` is NOT inherited from PodLibBase — declare locally.
```

### requestPayout (no index)

```solidity
function requestPayout(
    uint256 runId,
    itUint256 calldata itAmount,
    bytes calldata proofHandle,
    uint256 callbackFeeLocalWei
) external payable returns (bytes32 requestId) {
    IInbox.MpcMethodCall memory mpc = MpcAbiCodec.create(
        IPrivatePayrollCoti.verifyAndCredit.selector,
        4
    )
        .addArgument(runId)
        .addArgument(msg.sender)
        .addArgument(itAmount)
        .addArgument(proofHandle)
        .build();

    requestId = _sendTwoWayWithFee(
        msg.value,
        callbackFeeLocalWei,
        cotiChainId,
        cotiPayroll,
        mpc,
        PayrollVault.onPayoutAuthorized.selector,
        PayrollVault.onPayoutRejected.selector
    );
    emit PayoutRequested(requestId, runId);
}
```

### Callback → pToken transfer (v1 nested async)

```solidity
function onPayoutAuthorized(bytes memory data) external onlyInbox {
    (uint256 remoteChainId, address remoteContract) = inbox.inboxMsgSender();
    require(remoteChainId == cotiChainId && remoteContract == cotiPayroll);

    bytes32 requestId = inbox.inboxSourceRequestId();
    (uint256 runId, bytes32 leafHash, address claimant, itUint256 memory itAmount) =
        abi.decode(data, (uint256, bytes32, address, itUint256));

    payoutRequestStatus[requestId] = RequestStatus.VerifyCompleted;

    // Second async hop: private pToken transfer from vault to employee
    bytes32 transferId = pToken.transfer{value: transferFeeWei}(
        claimant,
        itAmount,
        transferCallbackFeeWei
    );
    emit PayoutTransferRequested(requestId, transferId, runId);
}
```

**Do not** call `MpcCore.decrypt` or `safeTransfer` with plaintext amount.

### Peer verification on callback

Mirror `PodERC20.transferCallback`: verify `inbox.inboxMsgSender()` matches configured `cotiPayroll` address (not just `onlyInbox`).

---

## COTI server: PrivatePayrollCoti

### registerLeaf (employer setup)

```solidity
function registerLeaf(
    uint256 runId,
    bytes32 leafHash,
    address employee,
    itUint256 calldata itAmount
) external {
    require(runs[runId].exists, "unknown run");
    gtUint256 gtAmount = MpcCore.validateCiphertext(itAmount);
    _registeredAmountCt[runId][leafHash] = MpcCore.offBoard(gtAmount);
    _registeredEmployee[runId][leafHash] = employee;
}
```

### verifyAndCredit (inbox-delivered)

```solidity
function verifyAndCredit(
    uint256 runId,
    address claimant,
    itUint256 calldata itAmount,
    bytes calldata proofHandle
) external onlyInbox {
    (bytes32[] memory proof, bytes32 leafHash) =
        abi.decode(proofHandle, (bytes32[], bytes32));

    if (!MerkleProof.verify(proof, runs[runId].eligibilityRoot, leafHash)) {
        _reject(runId, leafHash, 1);
        return;
    }
    if (_spent[runId][leafHash]) {
        _reject(runId, leafHash, 2);
        return;
    }
    if (_registeredEmployee[runId][leafHash] != claimant) {
        _reject(runId, leafHash, 3);
        return;
    }

    gtUint256 claimed = MpcCore.validateCiphertext(itAmount);
    gtUint256 registered = MpcCore.onBoard(_registeredAmountCt[runId][leafHash]);
    if (!MpcCore.decrypt(MpcCore.eq(claimed, registered))) {
        _reject(runId, leafHash, 4);
        return;
    }

    _spent[runId][leafHash] = true;
    inbox.respond(abi.encode(runId, leafHash, claimant, itAmount));
}
```

### respond / raise

```solidity
function _reject(uint256 runId, bytes32 leafHash, uint64 code) private {
    inbox.raise(abi.encode(runId, leafHash, code));
}
```

---

## Employer funding (pToken)

Mirror `privacy-portal-system-utils.ts` setup:

1. Deploy `PodErc20Mintable` with `minter = PrivacyPortal`
2. Employer `portal.deposit(recipient=PayrollVault, amount, portalFee, mintCallbackFee)`
3. Vault holds p.USDT garbled balance on COTI after mint callback completes

PayrollVault must be the pToken transfer sender on the second async hop — vault holds the payroll pool balance.

---

## proofHandle wire format

```solidity
proofHandle = abi.encode(bytes32[] merkleProof, bytes32 leafHash)
```

UI builds this off-chain from employer-issued payroll package. AVAX contract forwards opaque bytes to COTI.

---

## Nested async UX state machine

```
Submitted → VerifyPending → VerifyCompleted → TransferPending → Paid
                          └→ Failed
```

UI tracks two request IDs:

1. `PayoutRequested.requestId` — verify leg
2. `PayoutTransferRequested.transferId` — pToken transfer leg

Show "paid" only after pToken transfer callback updates employee balance.

---

## Lessons from temp build

| Issue | Fix |
|-------|-----|
| `using MpcAbiCodec` not inherited | Declare on `PayrollVault` directly |
| `import {MpcCore}` breaks `itUint256` in interfaces | Use `import "../../../utils/mpc/MpcCore.sol"` (file import) |
| `ctUint128 == ctUint128` fails | Use `ctUint128.unwrap(x) == 0` |
| Public payout leaks salary | Use `pToken.transfer(itUint256)` not `safeTransfer` |
| `PrivacyPortal.initialize` reverts `InvalidInitialization` | Deploy implementation + `CloneHelper.clone` before `initialize` |
| `MpcExecutor` artifact missing | Link from `pod-mpc-lib` in `scripts/link-contracts.sh` |
| COTI testnet `PUSH0` on deploy | Add `evmVersion: paris` Hardhat overrides for `Inbox`, `MpcExecutor`, `PriceOracle`, `PodErc20CotiMother`, `PrivatePayrollCoti` |
| `COTI_BACKEND` defaults to `sim` | Set `COTI_BACKEND=testnet` for live COTI RPC harness |
| COTI reuse + fresh Hardhat inbox | Nonce desync on `registerPodToken`; prefer fresh deploy both sides (with paris overrides) |
