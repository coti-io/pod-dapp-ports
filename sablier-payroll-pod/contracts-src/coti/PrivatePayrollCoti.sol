// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import "../../utils/mpc/MpcCore.sol";
import {IInbox} from "../../pod/IInbox.sol";
import {InboxUser} from "../../pod/InboxUser.sol";

/// @title PrivatePayrollCoti
/// @notice COTI server: roster verify + encrypted pool ledger (MPC at real 0x64).
/// @dev Fuji facades must not call MpcCore; pool credit/deduct and amount checks live here.
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

    /// @dev Network-key encrypted pool balance per run (credited via inbox `creditPool`).
    mapping(uint256 => ctUint256) private _poolBalanceCt;

    event RunRegistered(uint256 indexed runId, bytes32 eligibilityRoot);
    event LeafRegistered(uint256 indexed runId, uint256 indexed index, address employee);
    event PoolCredited(uint256 indexed runId, uint256 amount);
    event PayoutVerified(uint256 indexed runId, uint256 indexed index, address claimant, uint256 amount);
    event PoolClawedBack(uint256 indexed runId, uint256 amount);

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

    /// @notice Inbox: credit encrypted pool after public pToken funding on the client chain.
    /// @dev `amount` is already public on the fund transfer wire; MPC stores network-key ct.
    function creditPool(uint256 runId, uint256 amount) external onlyInbox {
        if (!runs[runId].exists || amount == 0) {
            inbox.raise(abi.encode(runId, uint256(0), uint64(10)));
            return;
        }
        gtUint256 credit = MpcCore.setPublic256(amount);
        ctUint256 memory poolCt = _poolBalanceCt[runId];
        if (_isEmpty(poolCt)) {
            _poolBalanceCt[runId] = MpcCore.offBoard(credit);
        } else {
            gtUint256 pool = MpcCore.onBoard(poolCt);
            _poolBalanceCt[runId] = MpcCore.offBoard(MpcCore.add(pool, credit));
        }
        inbox.respond(abi.encode(runId, amount));
        emit PoolCredited(runId, amount);
    }

    /// @notice Inbox: deduct from encrypted pool for admin clawback; respond with authorized plain amount.
    function clawbackPool(uint256 runId, uint256 amount) external onlyInbox {
        if (!runs[runId].exists || amount == 0) {
            inbox.raise(abi.encode(runId, uint256(0), uint64(11)));
            return;
        }
        if (!_deductPool(runId, MpcCore.setPublic256(amount))) {
            inbox.raise(abi.encode(runId, uint256(0), uint64(7)));
            return;
        }
        inbox.respond(abi.encode(runId, amount));
        emit PoolClawedBack(runId, amount);
    }

    /// @notice Inbox-delivered claim verification. proofHandle = abi.encode(merkleProof, index).
    /// @dev Deducts encrypted pool; responds with decrypted plain amount for client-chain public payout.
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

        if (!_deductPool(runId, claimed)) {
            _reject(runId, index, 7);
            return;
        }

        uint256 plainAmount = MpcCore.decrypt(claimed);
        _spent[runId][index] = true;
        inbox.respond(abi.encode(runId, index, claimant, plainAmount));
        emit PayoutVerified(runId, index, claimant, plainAmount);
    }

    function isSpent(uint256 runId, uint256 index) external view returns (bool) {
        return _spent[runId][index];
    }

    function _deductPool(uint256 runId, gtUint256 required) private returns (bool ok) {
        ctUint256 memory poolCt = _poolBalanceCt[runId];
        if (_isEmpty(poolCt)) {
            return false;
        }
        gtUint256 pool = MpcCore.onBoard(poolCt);
        (gtBool underflow, gtUint256 remainder) = MpcCore.checkedSubWithOverflowBit(pool, required);
        if (MpcCore.decrypt(underflow)) {
            return false;
        }
        _poolBalanceCt[runId] = MpcCore.offBoard(remainder);
        return true;
    }

    function _reject(uint256 runId, uint256 index, uint64 code) private {
        inbox.raise(abi.encode(runId, index, code));
    }

    function _isEmpty(ctUint256 memory ct) private pure returns (bool) {
        return ctUint128.unwrap(ct.ciphertextHigh) == 0 && ctUint128.unwrap(ct.ciphertextLow) == 0;
    }
}
