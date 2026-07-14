// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal comptroller stub for Sablier payroll harness tests.
contract MockSablierComptroller {
    uint256 public minFeeUSD;
    address public attestor;

    constructor(uint256 minFeeUSD_) {
        minFeeUSD = minFeeUSD_;
    }

    function getMinFeeUSDFor(bytes4, address) external view returns (uint256) {
        return minFeeUSD;
    }

    function convertUSDFeeToWei(uint256 feeUSD) external pure returns (uint256) {
        return feeUSD;
    }

    function setMinFeeUSD(uint256 newFee) external {
        minFeeUSD = newFee;
    }

    receive() external payable {}
}
