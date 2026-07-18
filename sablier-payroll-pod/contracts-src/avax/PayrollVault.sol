// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {PodLibBase} from "../../pod/mpc/PodLibBase.sol";
import {IInbox} from "../../pod/IInbox.sol";
import {MpcAbiCodec} from "../../pod/mpccodec/MpcAbiCodec.sol";
import "../../utils/mpc/MpcCore.sol";

import {IPrivatePayrollCoti} from "./IPrivatePayrollCoti.sol";
import {IPayrollCampaignFacade} from "./IPayrollCampaignFacade.sol";
import {IPodERC20} from "../../pod/token/perc20/IPodERC20.sol";

/// @title PayrollVault
/// @notice AVAX client: async COTI verify, encrypted pToken payout via facade.
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

    event RunCreated(uint256 indexed runId, bytes32 eligibilityRoot, address payoutToken);
    event PayoutRequested(bytes32 indexed requestId, uint256 indexed runId, uint256 index);
    event PayoutCompleted(bytes32 indexed requestId, uint256 indexed runId, uint256 index, address to);
    event PayoutFailed(bytes32 indexed requestId, uint256 indexed runId, uint256 index, uint64 errorCode);

    uint256 public nextRunId = 1;
    address public cotiPayroll;
    /// @dev Authorized to call `createRun` (set once by owner after factory deploy).
    address public campaignFactory;

    uint256 public inboxFeeWei;
    uint256 public payoutCallbackFeeWei;

    mapping(uint256 => PayrollRun) public runs;
    mapping(bytes32 => RequestStatus) public payoutRequestStatus;
    mapping(bytes32 => uint256) private _requestIndex;
    mapping(bytes32 => address) private _requestPayoutTo;
    mapping(bytes32 => itUint256) private _requestPayoutIt;

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

    function setInboxFees(uint256 totalFeeWei, uint256 callbackFeeWei_) external onlyOwner {
        inboxFeeWei = totalFeeWei;
        payoutCallbackFeeWei = callbackFeeWei_;
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

    function requestPayout(
        uint256 runId,
        uint256 index,
        address recipient,
        address payoutTo,
        itUint256 calldata itAmount,
        bytes calldata proofHandle,
        itUint256 calldata payoutItAmount,
        uint256 callbackFeeLocalWei
    ) external payable returns (bytes32 requestId) {
        PayrollRun storage run = _activeRun(runId);
        require(msg.sender == run.facade, "PayrollVault: not facade");

        uint256 totalFee = inboxFeeWei > 0 ? inboxFeeWei : msg.value;
        uint256 callbackFee = callbackFeeLocalWei > 0 ? callbackFeeLocalWei : payoutCallbackFeeWei;

        IInbox.MpcMethodCall memory mpc = MpcAbiCodec.create(IPrivatePayrollCoti.verifyAndCredit.selector, 4)
            .addArgument(runId)
            .addArgument(recipient)
            .addArgument(itAmount)
            .addArgument(proofHandle)
            .build();

        requestId = _sendTwoWayWithFee(
            totalFee,
            callbackFee,
            cotiChainId,
            cotiPayroll,
            mpc,
            PayrollVault.onPayoutAuthorized.selector,
            PayrollVault.onPayoutRejected.selector
        );

        payoutRequestStatus[requestId] = RequestStatus.Pending;
        _requestIndex[requestId] = index;
        _requestPayoutTo[requestId] = payoutTo;
        _requestPayoutIt[requestId] = payoutItAmount;
        emit PayoutRequested(requestId, runId, index);

        run;
    }

    function onPayoutAuthorized(bytes memory data) external onlyInbox {
        (uint256 remoteChainId, address remoteContract) = inbox.inboxMsgSender();
        require(remoteChainId == cotiChainId && remoteContract == cotiPayroll, "PayrollVault: bad sender");

        bytes32 requestId = inbox.inboxSourceRequestId();
        require(payoutRequestStatus[requestId] == RequestStatus.Pending, "PayrollVault: not pending");

        (uint256 runId, uint256 index, address claimant) =
            abi.decode(data, (uint256, uint256, address));

        PayrollRun storage run = runs[runId];
        require(run.exists, "PayrollVault: unknown run");

        address to = _requestPayoutTo[requestId];
        if (to == address(0)) {
            to = claimant;
        }

        itUint256 memory payoutIt = _requestPayoutIt[requestId];
        delete _requestPayoutIt[requestId];

        (uint256 totalFee,,) = IPodERC20(run.payoutToken).estimateFee();
        IPayrollCampaignFacade(run.facade).payoutTo{value: totalFee}(to, payoutIt);
        IPayrollCampaignFacade(run.facade).markClaimed(index);

        payoutRequestStatus[requestId] = RequestStatus.Completed;
        emit PayoutCompleted(requestId, runId, index, to);
    }

    function onPayoutRejected(bytes memory data) external onlyInbox {
        bytes32 requestId = inbox.inboxSourceRequestId();
        (uint256 runId, uint256 index, uint64 errorCode) = abi.decode(data, (uint256, uint256, uint64));

        payoutRequestStatus[requestId] = RequestStatus.Failed;
        delete _requestPayoutIt[requestId];
        emit PayoutFailed(requestId, runId, index, errorCode);
    }

    function _activeRun(uint256 runId) private view returns (PayrollRun storage run) {
        run = runs[runId];
        require(run.exists, "PayrollVault: unknown run");
    }
}
