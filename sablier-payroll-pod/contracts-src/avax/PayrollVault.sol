// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {PodLibBase} from "../../pod/mpc/PodLibBase.sol";
import {IInbox} from "../../pod/IInbox.sol";
import {MpcAbiCodec} from "../../pod/mpccodec/MpcAbiCodec.sol";
import "../../utils/mpc/MpcCore.sol";

import {IPrivatePayrollCoti} from "./IPrivatePayrollCoti.sol";
import {IPayrollCampaignFacade} from "./IPayrollCampaignFacade.sol";

/// @title PayrollVault
/// @notice AVAX/Fuji client: inbox I/O to COTI verify/pool; public pToken payout via facade.
/// @dev No MpcCore usage — all MPC runs on PrivatePayrollCoti.
///      PoD fees are never estimated on-chain: UI quotes via InboxFeeManager and passes
///      `msg.value` + `callbackFeeLocalWei` (+ reserved pToken fee wei for payout/clawback callbacks).
contract PayrollVault is PodLibBase {
    using MpcAbiCodec for MpcAbiCodec.MpcMethodCallContext;

    enum RequestStatus {
        None,
        Pending,
        Completed,
        Failed
    }

    struct PayrollRun {
        bytes32 eligibilityRoot;
        address payoutToken;
        address facade;
        uint40 startTime;
        uint40 expiration;
        bool exists;
    }

    struct PTokenFeeReserve {
        uint256 totalFeeWei;
        uint256 callbackFeeWei;
    }

    event RunCreated(uint256 indexed runId, bytes32 eligibilityRoot, address payoutToken);
    event PayoutRequested(bytes32 indexed requestId, uint256 indexed runId, uint256 index);
    event PayoutCompleted(bytes32 indexed requestId, uint256 indexed runId, uint256 index, address to, uint256 amount);
    event PayoutFailed(bytes32 indexed requestId, uint256 indexed runId, uint256 index, uint64 errorCode);
    event PoolCreditRequested(bytes32 indexed requestId, uint256 indexed runId, uint256 amount);
    event PoolCreditCompleted(bytes32 indexed requestId, uint256 indexed runId, uint256 amount);
    event PoolCreditFailed(bytes32 indexed requestId, uint256 indexed runId, uint64 errorCode);
    event ClawbackRequested(bytes32 indexed requestId, uint256 indexed runId, uint256 amount);
    event ClawbackCompleted(bytes32 indexed requestId, uint256 indexed runId, address to, uint256 amount);
    event ClawbackFailed(bytes32 indexed requestId, uint256 indexed runId, uint64 errorCode);

    uint256 public nextRunId = 1;
    address public cotiPayroll;
    address public campaignFactory;

    mapping(uint256 => PayrollRun) public runs;
    mapping(bytes32 => RequestStatus) public payoutRequestStatus;
    mapping(bytes32 => uint256) private _requestIndex;
    mapping(bytes32 => address) private _requestPayoutTo;
    mapping(bytes32 => PTokenFeeReserve) private _payoutPTokenFees;

    mapping(bytes32 => RequestStatus) public poolCreditStatus;
    mapping(bytes32 => uint256) private _creditRunId;

    mapping(bytes32 => RequestStatus) public clawbackStatus;
    mapping(bytes32 => uint256) private _clawbackRunId;
    mapping(bytes32 => address) private _clawbackTo;
    mapping(bytes32 => PTokenFeeReserve) private _clawbackPTokenFees;

    constructor(address inbox_, address cotiPayroll_) PodLibBase(msg.sender) {
        setInbox(inbox_);
        cotiPayroll = cotiPayroll_;
    }

    function setCotiPayroll(address cotiPayroll_) external onlyOwner {
        cotiPayroll = cotiPayroll_;
    }

    function setCampaignFactory(address campaignFactory_) external onlyOwner {
        campaignFactory = campaignFactory_;
    }

    function createRun(
        bytes32 eligibilityRoot,
        address payoutToken,
        address facade,
        uint40 startTime,
        uint40 expiration
    ) external returns (uint256 runId) {
        require(msg.sender == owner() || msg.sender == campaignFactory, "PayrollVault: not authorized");
        runId = nextRunId++;
        runs[runId] = PayrollRun({
            eligibilityRoot: eligibilityRoot,
            payoutToken: payoutToken,
            facade: facade,
            startTime: startTime,
            expiration: expiration,
            exists: true
        });
        emit RunCreated(runId, eligibilityRoot, payoutToken);
    }

    /// @notice Facade: credit COTI encrypted pool after public pToken funding.
    /// @param callbackFeeLocalWei UI-quoted callback slice (InboxFeeManager at current gasPrice).
    function requestCreditPool(uint256 runId, uint256 amount, uint256 callbackFeeLocalWei)
        external
        payable
        returns (bytes32 requestId)
    {
        PayrollRun storage run = _activeRun(runId);
        require(msg.sender == run.facade, "PayrollVault: not facade");
        require(amount > 0, "PayrollVault: zero credit");

        IInbox.MpcMethodCall memory mpc = MpcAbiCodec.create(IPrivatePayrollCoti.creditPool.selector, 2)
            .addArgument(runId)
            .addArgument(amount)
            .build();

        requestId = _sendTwoWayWithFee(
            msg.value,
            callbackFeeLocalWei,
            cotiChainId,
            cotiPayroll,
            mpc,
            PayrollVault.onPoolCredited.selector,
            PayrollVault.onPoolCreditRejected.selector
        );

        poolCreditStatus[requestId] = RequestStatus.Pending;
        _creditRunId[requestId] = runId;
        emit PoolCreditRequested(requestId, runId, amount);
    }

    function onPoolCredited(bytes memory data) external onlyInbox {
        (uint256 remoteChainId, address remoteContract) = inbox.inboxMsgSender();
        require(remoteChainId == cotiChainId && remoteContract == cotiPayroll, "PayrollVault: bad sender");

        bytes32 requestId = inbox.inboxSourceRequestId();
        require(poolCreditStatus[requestId] == RequestStatus.Pending, "PayrollVault: not pending");

        (uint256 runId, uint256 amount) = abi.decode(data, (uint256, uint256));
        PayrollRun storage run = runs[runId];
        require(run.exists, "PayrollVault: unknown run");

        IPayrollCampaignFacade(run.facade).onPoolCredited(amount);
        poolCreditStatus[requestId] = RequestStatus.Completed;
        emit PoolCreditCompleted(requestId, runId, amount);
    }

    function onPoolCreditRejected(bytes memory data) external onlyInbox {
        bytes32 requestId = inbox.inboxSourceRequestId();
        (uint256 runId,, uint64 errorCode) = abi.decode(data, (uint256, uint256, uint64));
        poolCreditStatus[requestId] = RequestStatus.Failed;
        emit PoolCreditFailed(requestId, runId, errorCode);
    }

    /// @notice Facade: claw back from COTI pool then public-transfer on callback.
    /// @param pTokenTotalFeeWei / pTokenCallbackFeeWei UI-quoted fees reserved for the callback pToken transfer.
    function requestClawback(
        uint256 runId,
        address to,
        uint256 amount,
        uint256 callbackFeeLocalWei,
        uint256 pTokenTotalFeeWei,
        uint256 pTokenCallbackFeeWei
    ) external payable returns (bytes32 requestId) {
        PayrollRun storage run = _activeRun(runId);
        require(msg.sender == run.facade, "PayrollVault: not facade");
        require(to != address(0) && amount > 0, "PayrollVault: bad clawback");
        require(pTokenTotalFeeWei > 0 && pTokenCallbackFeeWei <= pTokenTotalFeeWei, "PayrollVault: bad pToken fee");

        IInbox.MpcMethodCall memory mpc = MpcAbiCodec.create(IPrivatePayrollCoti.clawbackPool.selector, 2)
            .addArgument(runId)
            .addArgument(amount)
            .build();

        requestId = _sendTwoWayWithFee(
            msg.value,
            callbackFeeLocalWei,
            cotiChainId,
            cotiPayroll,
            mpc,
            PayrollVault.onClawbackAuthorized.selector,
            PayrollVault.onClawbackRejected.selector
        );

        clawbackStatus[requestId] = RequestStatus.Pending;
        _clawbackRunId[requestId] = runId;
        _clawbackTo[requestId] = to;
        _clawbackPTokenFees[requestId] =
            PTokenFeeReserve({totalFeeWei: pTokenTotalFeeWei, callbackFeeWei: pTokenCallbackFeeWei});
        emit ClawbackRequested(requestId, runId, amount);
    }

    function onClawbackAuthorized(bytes memory data) external onlyInbox {
        (uint256 remoteChainId, address remoteContract) = inbox.inboxMsgSender();
        require(remoteChainId == cotiChainId && remoteContract == cotiPayroll, "PayrollVault: bad sender");

        bytes32 requestId = inbox.inboxSourceRequestId();
        require(clawbackStatus[requestId] == RequestStatus.Pending, "PayrollVault: not pending");

        (uint256 runId, uint256 amount) = abi.decode(data, (uint256, uint256));
        PayrollRun storage run = runs[runId];
        address to = _clawbackTo[requestId];
        PTokenFeeReserve memory fees = _clawbackPTokenFees[requestId];
        delete _clawbackTo[requestId];
        delete _clawbackPTokenFees[requestId];

        IPayrollCampaignFacade(run.facade).payoutTo{value: fees.totalFeeWei}(to, amount, fees.callbackFeeWei);

        clawbackStatus[requestId] = RequestStatus.Completed;
        emit ClawbackCompleted(requestId, runId, to, amount);
    }

    function onClawbackRejected(bytes memory data) external onlyInbox {
        bytes32 requestId = inbox.inboxSourceRequestId();
        (uint256 runId,, uint64 errorCode) = abi.decode(data, (uint256, uint256, uint64));
        clawbackStatus[requestId] = RequestStatus.Failed;
        delete _clawbackTo[requestId];
        delete _clawbackPTokenFees[requestId];
        emit ClawbackFailed(requestId, runId, errorCode);
    }

    /// @param callbackFeeLocalWei UI-quoted inbox callback slice.
    /// @param pTokenTotalFeeWei / pTokenCallbackFeeWei reserved for public transfer on authorization callback.
    function requestPayout(
        uint256 runId,
        uint256 index,
        address recipient,
        address payoutTo,
        itUint256 calldata itAmount,
        bytes calldata proofHandle,
        uint256 callbackFeeLocalWei,
        uint256 pTokenTotalFeeWei,
        uint256 pTokenCallbackFeeWei
    ) external payable returns (bytes32 requestId) {
        PayrollRun storage run = _activeRun(runId);
        require(msg.sender == run.facade, "PayrollVault: not facade");
        require(pTokenTotalFeeWei > 0 && pTokenCallbackFeeWei <= pTokenTotalFeeWei, "PayrollVault: bad pToken fee");

        IInbox.MpcMethodCall memory mpc = MpcAbiCodec.create(IPrivatePayrollCoti.verifyAndCredit.selector, 4)
            .addArgument(runId)
            .addArgument(recipient)
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

        payoutRequestStatus[requestId] = RequestStatus.Pending;
        _requestIndex[requestId] = index;
        _requestPayoutTo[requestId] = payoutTo;
        _payoutPTokenFees[requestId] =
            PTokenFeeReserve({totalFeeWei: pTokenTotalFeeWei, callbackFeeWei: pTokenCallbackFeeWei});
        emit PayoutRequested(requestId, runId, index);

        run;
    }

    function onPayoutAuthorized(bytes memory data) external onlyInbox {
        (uint256 remoteChainId, address remoteContract) = inbox.inboxMsgSender();
        require(remoteChainId == cotiChainId && remoteContract == cotiPayroll, "PayrollVault: bad sender");

        bytes32 requestId = inbox.inboxSourceRequestId();
        require(payoutRequestStatus[requestId] == RequestStatus.Pending, "PayrollVault: not pending");

        (uint256 runId, uint256 index, address claimant, uint256 amount) =
            abi.decode(data, (uint256, uint256, address, uint256));

        PayrollRun storage run = runs[runId];
        require(run.exists, "PayrollVault: unknown run");

        address to = _requestPayoutTo[requestId];
        if (to == address(0)) {
            to = claimant;
        }
        PTokenFeeReserve memory fees = _payoutPTokenFees[requestId];
        delete _requestPayoutTo[requestId];
        delete _payoutPTokenFees[requestId];

        IPayrollCampaignFacade(run.facade).payoutTo{value: fees.totalFeeWei}(to, amount, fees.callbackFeeWei);
        IPayrollCampaignFacade(run.facade).markClaimed(index);

        payoutRequestStatus[requestId] = RequestStatus.Completed;
        emit PayoutCompleted(requestId, runId, index, to, amount);
    }

    function onPayoutRejected(bytes memory data) external onlyInbox {
        bytes32 requestId = inbox.inboxSourceRequestId();
        (uint256 runId, uint256 index, uint64 errorCode) = abi.decode(data, (uint256, uint256, uint64));

        payoutRequestStatus[requestId] = RequestStatus.Failed;
        delete _requestPayoutTo[requestId];
        delete _payoutPTokenFees[requestId];
        emit PayoutFailed(requestId, runId, index, errorCode);
    }

    function _activeRun(uint256 runId) private view returns (PayrollRun storage run) {
        run = runs[runId];
        require(run.exists, "PayrollVault: unknown run");
    }
}
