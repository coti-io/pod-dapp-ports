// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";

// Types only (itUint256) — never invoke MpcCore functions (no precompile on PoD client chains).
import "../../utils/mpc/MpcCore.sol";
import {IPodERC20} from "../../pod/token/perc20/IPodERC20.sol";
import {IPayrollCampaignFacade} from "./IPayrollCampaignFacade.sol";
import {PayrollVault} from "./PayrollVault.sol";
import {PodClaimStore} from "./PodClaimStore.sol";

/// @title PayrollCampaignFacade
/// @notice Sablier Merkle Instant-shaped facade over async PoD payroll (vault + COTI).
/// @dev PoD client chain: public checks + inbox via vault. Encrypted pool MPC lives on PrivatePayrollCoti.
///      Inbox / pToken fees are never estimated on-chain: UI quotes via InboxFeeManager (and pToken view
///      until that token is redesigned) and passes wei amounts on every send path.
contract PayrollCampaignFacade is IPayrollCampaignFacade {
    using BitMaps for BitMaps.BitMap;

    error CampaignNotStarted(uint256 blockTimestamp, uint40 campaignStartTime);
    error CampaignExpired(uint256 blockTimestamp, uint40 expiration);
    error IndexClaimed(uint256 index);
    error InvalidProof();
    error InsufficientFeePayment(uint256 feePaid, uint256 minFeeWei);
    error ToZeroAddress();
    error ClawbackNotAllowed(uint256 blockTimestamp, uint40 expiration, uint40 firstClaimTime);
    error FeeTransferFailed(address feeRecipient, uint256 feeAmount);
    error CallerNotAdmin(address caller, address admin);
    error ZeroAmount();

    event ClaimInstant(
        uint256 indexed index,
        address indexed recipient,
        bytes32 amountCommitment,
        address indexed to,
        bool viaSig
    );
    event Clawback(address indexed admin, address indexed to, uint256 amount);
    event PoolCredited(uint256 indexed amount, uint256 totalCredited);

    uint40 public immutable CAMPAIGN_START_TIME;
    uint40 public immutable EXPIRATION;
    bytes32 public immutable MERKLE_ROOT;
    address public immutable TOKEN;
    address public immutable COMPTROLLER;
    address public immutable DEPLOYER;
    address public admin;

    string public campaignName;
    uint40 public firstClaimTime;
    uint256 public minFeeUSD;

    PayrollVault public payrollVault;
    PodClaimStore public claimStore;
    uint256 public runId;

    /// @notice Cumulative public amount credited on COTI (UI poll marker).
    uint256 public poolCreditedTotal;

    BitMaps.BitMap private _claimedBitMap;

    mapping(uint256 => address) public registeredRecipient;
    mapping(uint256 => bytes32) public amountCommitment;

    constructor(
        address admin_,
        address comptroller_,
        bytes32 merkleRoot_,
        address token_,
        uint40 campaignStartTime_,
        uint40 expiration_,
        string memory campaignName_,
        uint256 minFeeUSD_
    ) {
        DEPLOYER = msg.sender;
        admin = admin_;
        COMPTROLLER = comptroller_;
        MERKLE_ROOT = merkleRoot_;
        TOKEN = token_;
        CAMPAIGN_START_TIME = campaignStartTime_;
        EXPIRATION = expiration_;
        campaignName = campaignName_;
        minFeeUSD = minFeeUSD_;
    }

    function wirePayroll(PayrollVault vault_, PodClaimStore claimStore_, uint256 runId_) external {
        require(address(payrollVault) == address(0), "PayrollCampaignFacade: wired");
        require(msg.sender == admin || msg.sender == DEPLOYER, "PayrollCampaignFacade: not admin");
        payrollVault = vault_;
        claimStore = claimStore_;
        runId = runId_;
    }

    function registerLeaf(uint256 index, address recipient, bytes32 commitment) external {
        require(msg.sender == admin, "PayrollCampaignFacade: not admin");
        registeredRecipient[index] = recipient;
        amountCommitment[index] = commitment;
    }

    /// @notice After public `pToken.transfer` to this facade, credit the COTI encrypted pool via inbox.
    /// @param callbackFeeWei UI-quoted callback slice (InboxFeeManager at current gasPrice).
    function requestCreditPool(uint256 amount, uint256 callbackFeeWei) external payable {
        if (msg.sender != admin) revert CallerNotAdmin(msg.sender, admin);
        if (amount == 0) revert ZeroAmount();
        require(msg.value > 0, "PayrollCampaignFacade: inbox fee");
        payrollVault.requestCreditPool{value: msg.value}(runId, amount, callbackFeeWei);
    }

    /// @inheritdoc IPayrollCampaignFacade
    function onPoolCredited(uint256 amount) external {
        require(msg.sender == address(payrollVault), "PayrollCampaignFacade: not vault");
        poolCreditedTotal += amount;
        emit PoolCredited(amount, poolCreditedTotal);
    }

    function hasClaimed(uint256 index) public view returns (bool) {
        return _claimedBitMap.get(index);
    }

    function hasExpired() public view returns (bool) {
        return EXPIRATION > 0 && EXPIRATION <= block.timestamp;
    }

    function calculateMinFeeWei() external view returns (uint256) {
        return MockSablierComptrollerView(COMPTROLLER).convertUSDFeeToWei(minFeeUSD);
    }

    /// @dev Encrypted IT is supplied via PodClaimStore before claim; employee pays Sablier minFee only.
    ///      Employer float covers inbox; UI must pass live inbox + pToken fee quotes.
    function claim(
        uint256 index,
        address recipient,
        bytes32[] calldata merkleProof,
        uint256 inboxTotalFeeWei,
        uint256 inboxCallbackFeeWei,
        uint256 pTokenTotalFeeWei,
        uint256 pTokenCallbackFeeWei
    ) external payable {
        if (recipient != msg.sender) revert InvalidProof();
        bytes32 commitment = _preProcessClaim(index, recipient, merkleProof);
        _submitPayout(
            index,
            recipient,
            recipient,
            commitment,
            inboxTotalFeeWei,
            inboxCallbackFeeWei,
            pTokenTotalFeeWei,
            pTokenCallbackFeeWei
        );
    }

    function claimTo(
        uint256 index,
        address to,
        bytes32[] calldata merkleProof,
        uint256 inboxTotalFeeWei,
        uint256 inboxCallbackFeeWei,
        uint256 pTokenTotalFeeWei,
        uint256 pTokenCallbackFeeWei
    ) external payable {
        if (to == address(0)) revert ToZeroAddress();
        bytes32 commitment = _preProcessClaim(index, msg.sender, merkleProof);
        _submitPayout(
            index,
            msg.sender,
            to,
            commitment,
            inboxTotalFeeWei,
            inboxCallbackFeeWei,
            pTokenTotalFeeWei,
            pTokenCallbackFeeWei
        );
    }

    /// @param callbackFeeWei UI-quoted inbox callback slice.
    /// @param pTokenTotalFeeWei / pTokenCallbackFeeWei reserved for public transfer on clawback callback.
    function clawback(
        address to,
        uint256 amount,
        uint256 callbackFeeWei,
        uint256 pTokenTotalFeeWei,
        uint256 pTokenCallbackFeeWei
    ) external payable {
        if (msg.sender != admin) revert CallerNotAdmin(msg.sender, admin);
        if (to == address(0)) revert ToZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (_hasGracePeriodPassed() && !hasExpired()) {
            revert ClawbackNotAllowed(block.timestamp, EXPIRATION, firstClaimTime);
        }

        require(msg.value > 0, "PayrollCampaignFacade: inbox fee");
        payrollVault.requestClawback{value: msg.value}(
            runId, to, amount, callbackFeeWei, pTokenTotalFeeWei, pTokenCallbackFeeWei
        );
        emit Clawback(admin, to, amount);
    }

    function markClaimed(uint256 index) external {
        require(msg.sender == address(payrollVault), "PayrollCampaignFacade: not vault");
        _claimedBitMap.set(index);
        if (firstClaimTime == 0) {
            firstClaimTime = uint40(block.timestamp);
        }
    }

    /// @inheritdoc IPayrollCampaignFacade
    function payoutTo(address to, uint256 amount, uint256 callbackFeeWei) external payable {
        require(msg.sender == address(payrollVault), "PayrollCampaignFacade: not vault");
        require(msg.value > 0 && callbackFeeWei <= msg.value, "PayrollCampaignFacade: inbox fee");
        IPodERC20(TOKEN).transfer{value: msg.value}(to, amount, callbackFeeWei);
    }

    function _preProcessClaim(
        uint256 index,
        address recipient,
        bytes32[] calldata merkleProof
    ) private view returns (bytes32 commitment) {
        if (CAMPAIGN_START_TIME > block.timestamp) {
            revert CampaignNotStarted(block.timestamp, CAMPAIGN_START_TIME);
        }
        if (hasExpired()) {
            revert CampaignExpired(block.timestamp, EXPIRATION);
        }

        uint256 minFeeWei = MockSablierComptrollerView(COMPTROLLER).convertUSDFeeToWei(minFeeUSD);
        if (msg.value < minFeeWei) {
            revert InsufficientFeePayment(msg.value, minFeeWei);
        }

        if (_claimedBitMap.get(index)) {
            revert IndexClaimed(index);
        }

        if (registeredRecipient[index] != recipient) {
            revert InvalidProof();
        }

        commitment = amountCommitment[index];
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, recipient, commitment))));
        if (!MerkleProof.verify(merkleProof, MERKLE_ROOT, leaf)) {
            revert InvalidProof();
        }
    }

    function _submitPayout(
        uint256 index,
        address recipient,
        address to,
        bytes32 commitment,
        uint256 inboxTotalFeeWei,
        uint256 inboxCallbackFeeWei,
        uint256 pTokenTotalFeeWei,
        uint256 pTokenCallbackFeeWei
    ) private {
        uint256 feePaid = msg.value;
        if (feePaid > 0) {
            (bool success,) = COMPTROLLER.call{value: feePaid}("");
            if (!success) revert FeeTransferFailed(COMPTROLLER, feePaid);
        }

        (itUint256 memory verifyIt, bytes memory proofHandle) =
            claimStore.consumePayload(address(this), index, recipient);

        require(inboxTotalFeeWei > 0 && inboxCallbackFeeWei <= inboxTotalFeeWei, "PayrollCampaignFacade: inbox fee");
        require(address(this).balance >= inboxTotalFeeWei, "PayrollCampaignFacade: inbox fee");
        payrollVault.requestPayout{value: inboxTotalFeeWei}(
            runId,
            index,
            recipient,
            to,
            verifyIt,
            proofHandle,
            inboxCallbackFeeWei,
            pTokenTotalFeeWei,
            pTokenCallbackFeeWei
        );
        emit ClaimInstant(index, recipient, commitment, to, false);
    }

    function _hasGracePeriodPassed() private view returns (bool) {
        return firstClaimTime > 0 && block.timestamp > firstClaimTime + 7 days;
    }

    receive() external payable {}
}

interface MockSablierComptrollerView {
    function convertUSDFeeToWei(uint256 feeUSD) external view returns (uint256);
}
