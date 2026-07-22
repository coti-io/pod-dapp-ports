// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/// @title IPayrollCampaignFacade
/// @notice Callback surface from PayrollVault after COTI-authorized payout / pool credit.
interface IPayrollCampaignFacade {
    function markClaimed(uint256 index) external;

    /// @dev Public pToken transfer after COTI verified the amount (no local MpcCore on Fuji).
    ///      `callbackFeeWei` is UI-quoted at request time and reserved by the vault.
    function payoutTo(address to, uint256 amount, uint256 callbackFeeWei) external payable;

    /// @dev Vault inbox callback after COTI `creditPool` succeeds.
    function onPoolCredited(uint256 amount) external;
}
