// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import "../../utils/mpc/MpcCore.sol";
import {IInbox} from "../../pod/IInbox.sol";
import {InboxUser} from "../../pod/InboxUser.sol";

/// @title PrivatePayrollCoti
/// @notice COTI server: Sablier-shaped leaf `hash(index, recipient, hash(ct))` + private eq256 amount match.
contract PrivatePayrollCoti is InboxUser, Ownable {
    struct RunState {
        bytes32 eligibilityRoot;
        bool exists;
    }

    mapping(uint256 => RunState) public runs;
    mapping(uint256 => mapping(uint256 => ctUint256)) private _registeredAmountCt;
    mapping(uint256 => mapping(uint256 => address)) private _registeredEmployee;
    mapping(uint256 => mapping(uint256 => bool)) private _spent;

    mapping(uint256 => mapping(uint256 => bytes32)) private _amountCommitment;

    event RunRegistered(uint256 indexed runId, bytes32 eligibilityRoot);
    event LeafRegistered(uint256 indexed runId, uint256 indexed index, address employee);
    event PayoutVerified(uint256 indexed runId, uint256 indexed index, address claimant);

    constructor(address inbox_, address initialOwner) Ownable(initialOwner) {
        setInbox(inbox_);
    }

    function registerRun(uint256 runId, bytes32 eligibilityRoot) external onlyOwner {
        runs[runId] = RunState({eligibilityRoot: eligibilityRoot, exists: true});
        emit RunRegistered(runId, eligibilityRoot);
    }

    function registerLeaf(
        uint256 runId,
        uint256 index,
        address employee,
        bytes32 amountCommitment,
        itUint256 calldata itAmount
    ) external onlyOwner {
        require(runs[runId].exists, "PrivatePayrollCoti: unknown run");
        require(!_spent[runId][index], "PrivatePayrollCoti: spent");
        gtUint256 gtAmount = MpcCore.validateCiphertext(itAmount);
        _registeredAmountCt[runId][index] = MpcCore.offBoard(gtAmount);
        _registeredEmployee[runId][index] = employee;
        _amountCommitment[runId][index] = amountCommitment;
        emit LeafRegistered(runId, index, employee);
    }

    /// @notice Inbox-delivered claim verification. proofHandle = abi.encode(merkleProof, index).
    /// @dev `claimed` is gtUint256 because {MpcAbiCodec} validates itUint256 on the inbox leg.
    function verifyAndCredit(
        uint256 runId,
        address claimant,
        gtUint256 claimed,
        bytes calldata proofHandle
    ) external onlyInbox {
        if (!runs[runId].exists) {
            _reject(runId, 0, 1);
            return;
        }

        (bytes32[] memory proof, uint256 index) = abi.decode(proofHandle, (bytes32[], uint256));

        if (_spent[runId][index]) {
            _reject(runId, index, 3);
            return;
        }
        if (_registeredEmployee[runId][index] != claimant) {
            _reject(runId, index, 4);
            return;
        }

        ctUint256 memory registeredCt = _registeredAmountCt[runId][index];
        if (_isEmpty(registeredCt)) {
            _reject(runId, index, 5);
            return;
        }

        bytes32 commitment = _amountCommitment[runId][index];
        bytes32 leafHash =
            keccak256(bytes.concat(keccak256(abi.encode(index, claimant, commitment))));

        if (!MerkleProof.verify(proof, runs[runId].eligibilityRoot, leafHash)) {
            _reject(runId, index, 2);
            return;
        }

        gtUint256 registered = MpcCore.onBoard(registeredCt);

        if (!MpcCore.decrypt(MpcCore.eq(claimed, registered))) {
            _reject(runId, index, 6);
            return;
        }

        _spent[runId][index] = true;
        inbox.respond(abi.encode(runId, index, claimant));
        emit PayoutVerified(runId, index, claimant);
    }

    function isSpent(uint256 runId, uint256 index) external view returns (bool) {
        return _spent[runId][index];
    }

    function _reject(uint256 runId, uint256 index, uint64 code) private {
        inbox.raise(abi.encode(runId, index, code));
    }

    function _isEmpty(ctUint256 memory ct) private pure returns (bool) {
        return ctUint128.unwrap(ct.ciphertextHigh) == 0 && ctUint128.unwrap(ct.ciphertextLow) == 0;
    }
}
