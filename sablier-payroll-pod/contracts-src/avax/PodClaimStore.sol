// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../utils/mpc/MpcCore.sol";

/// @title PodClaimStore
/// @notice Holds encrypted verify IT + proof submitted by the claimant before `claim`.
/// @dev Payout amount is authorized on COTI and returned in the vault callback (public transfer).
contract PodClaimStore {
    struct Payload {
        itUint256 itAmount;
        bytes proofHandle;
        bool set;
    }

    mapping(address => mapping(uint256 => mapping(address => Payload))) private _payloads;

    /// @notice Claimant submits encrypted verify IT bound for COTI `verifyAndCredit`.
    function submitPayload(
        address facade,
        uint256 index,
        itUint256 calldata itAmount,
        bytes calldata proofHandle
    ) external {
        Payload storage p = _payloads[facade][index][msg.sender];
        require(!p.set, "PodClaimStore: exists");
        p.itAmount = itAmount;
        p.proofHandle = proofHandle;
        p.set = true;
    }

    function consumePayload(
        address facade,
        uint256 index,
        address claimant
    ) external returns (itUint256 memory itAmount, bytes memory proofHandle) {
        Payload storage p = _payloads[facade][index][claimant];
        require(p.set, "PodClaimStore: missing payload");
        itAmount = p.itAmount;
        proofHandle = p.proofHandle;
        delete _payloads[facade][index][claimant];
    }
}
