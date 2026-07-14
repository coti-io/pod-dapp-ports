// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../../utils/mpc/MpcCore.sol";

/// @title IPayrollCampaignFacade
/// @notice Callback surface from PayrollVault after successful payout.
interface IPayrollCampaignFacade {
    function markClaimed(uint256 index) external;
    /// @dev Encrypted pToken transfer after COTI verified the encrypted amount privately.
    function payoutTo(address to, itUint256 calldata amount) external payable;
}
