// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../../utils/mpc/MpcCore.sol";

/// @title IPrivatePayrollCoti
/// @notice COTI-side interface for private payroll verification and encrypted pool.
interface IPrivatePayrollCoti {
    function registerRun(uint256 runId, bytes32 eligibilityRoot) external;
    function registerLeaf(
        uint256 runId,
        uint256 index,
        address employee,
        bytes32 amountCommitment,
        itUint256 calldata itAmount
    ) external;

    function creditPool(uint256 runId, uint256 amount) external;

    function clawbackPool(uint256 runId, uint256 amount) external;

    function verifyAndCredit(
        uint256 runId,
        address claimant,
        gtUint256 claimed,
        bytes calldata proofHandle
    ) external;
}
