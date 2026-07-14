// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../utils/mpc/MpcCore.sol";

/// @title PodClaimStore
/// @notice Holds encrypted claim + payout payloads submitted by the claimant before `claim`.
contract PodClaimStore {
    struct Payload {
        itUint256 itAmount;
        bytes proofHandle;
        itUint256 payoutItAmount;
        bool set;
    }

    mapping(address => mapping(uint256 => mapping(address => Payload))) private _payloads;

    /// @notice Claimant submits encrypted verify IT and encrypted payout IT (production-shaped client flow).
    function submitPayload(
        address facade,
        uint256 index,
        itUint256 calldata itAmount,
        bytes calldata proofHandle,
        itUint256 calldata payoutItAmount
    ) external {
        Payload storage p = _payloads[facade][index][msg.sender];
        require(!p.set, "PodClaimStore: exists");
        p.itAmount = itAmount;
        p.proofHandle = proofHandle;
        p.payoutItAmount = payoutItAmount;
        p.set = true;
    }

    function consumePayload(
        address facade,
        uint256 index,
        address claimant
    ) external returns (itUint256 memory itAmount, bytes memory proofHandle, itUint256 memory payoutItAmount) {
        Payload storage p = _payloads[facade][index][claimant];
        require(p.set, "PodClaimStore: missing payload");
        itAmount = p.itAmount;
        proofHandle = p.proofHandle;
        payoutItAmount = p.payoutItAmount;
        delete _payloads[facade][index][claimant];
    }
}
