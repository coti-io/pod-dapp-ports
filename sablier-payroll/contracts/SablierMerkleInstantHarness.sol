// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";

/// @title SablierMerkleInstantHarness
/// @notice Faithful in-repo harness for Sablier Merkle Instant DEFAULT claim semantics.
/// @dev Leaf, merkle verify, claim bitmap, time bounds, clawback grace, and events match upstream:
/// https://github.com/sablier-labs/evm-monorepo/blob/main/airdrops/src/SablierMerkleInstant.sol
/// https://github.com/sablier-labs/evm-monorepo/blob/main/airdrops/src/abstracts/SablierMerkleBase.sol
contract SablierMerkleInstantHarness {
    using BitMaps for BitMaps.BitMap;
    using SafeERC20 for IERC20;

    error CampaignNotStarted(uint256 blockTimestamp, uint40 campaignStartTime);
    error CampaignExpired(uint256 blockTimestamp, uint40 expiration);
    error IndexClaimed(uint256 index);
    error InvalidProof();
    error InsufficientFeePayment(uint256 feePaid, uint256 minFeeWei);
    error ToZeroAddress();
    error ClawbackNotAllowed(uint256 blockTimestamp, uint40 expiration, uint40 firstClaimTime);
    error FeeTransferFailed(address feeRecipient, uint256 feeAmount);
    error CallerNotAdmin(address caller, address admin);

    event ClaimInstant(
        uint256 indexed index,
        address indexed recipient,
        uint128 amount,
        address indexed to,
        bool viaSig
    );
    event Clawback(address indexed admin, address indexed to, uint128 amount);

    uint40 public immutable CAMPAIGN_START_TIME;
    uint40 public immutable EXPIRATION;
    bytes32 public immutable MERKLE_ROOT;
    IERC20 public immutable TOKEN;
    address public immutable COMPTROLLER;
    address public admin;

    string public campaignName;
    uint40 public firstClaimTime;
    uint256 public minFeeUSD;

    BitMaps.BitMap private _claimedBitMap;

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
        admin = admin_;
        COMPTROLLER = comptroller_;
        MERKLE_ROOT = merkleRoot_;
        TOKEN = IERC20(token_);
        CAMPAIGN_START_TIME = campaignStartTime_;
        EXPIRATION = expiration_;
        campaignName = campaignName_;
        minFeeUSD = minFeeUSD_;
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

    /// @notice Sablier Merkle Instant — claim on behalf of recipient (recipient must be msg.sender)
    function claim(uint256 index, address recipient, uint128 amount, bytes32[] calldata merkleProof) external payable {
        if (recipient != msg.sender) revert InvalidProof();
        _preProcessClaim(index, recipient, amount, merkleProof);
        _postProcessClaim(index, recipient, recipient, amount, false);
    }

    /// @notice Sablier Merkle Instant — claim to a different payout address
    function claimTo(uint256 index, address to, uint128 amount, bytes32[] calldata merkleProof) external payable {
        if (to == address(0)) revert ToZeroAddress();
        _preProcessClaim(index, msg.sender, amount, merkleProof);
        _postProcessClaim(index, msg.sender, to, amount, false);
    }

    function clawback(address to, uint128 amount) external {
        if (msg.sender != admin) revert CallerNotAdmin(msg.sender, admin);
        if (_hasGracePeriodPassed() && !hasExpired()) {
            revert ClawbackNotAllowed(block.timestamp, EXPIRATION, firstClaimTime);
        }
        TOKEN.safeTransfer(to, amount);
        emit Clawback(admin, to, amount);
    }

    function _preProcessClaim(
        uint256 index,
        address recipient,
        uint128 amount,
        bytes32[] calldata merkleProof
    ) private {
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

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, recipient, amount))));
        if (!MerkleProof.verify(merkleProof, MERKLE_ROOT, leaf)) {
            revert InvalidProof();
        }

        if (firstClaimTime == 0) {
            firstClaimTime = uint40(block.timestamp);
        }
        _claimedBitMap.set(index);

        uint256 feePaid = msg.value;
        if (feePaid > 0) {
            (bool success,) = COMPTROLLER.call{value: feePaid}("");
            if (!success) revert FeeTransferFailed(COMPTROLLER, feePaid);
        }
    }

    function _postProcessClaim(
        uint256 index,
        address recipient,
        address to,
        uint128 amount,
        bool viaSig
    ) private {
        TOKEN.safeTransfer(to, amount);
        emit ClaimInstant(index, recipient, amount, to, viaSig);
    }

    function _hasGracePeriodPassed() private view returns (bool) {
        return firstClaimTime > 0 && block.timestamp > firstClaimTime + 7 days;
    }
}

interface MockSablierComptrollerView {
    function convertUSDFeeToWei(uint256 feeUSD) external view returns (uint256);
}
