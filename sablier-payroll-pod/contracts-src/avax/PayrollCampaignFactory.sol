// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayrollCampaignFacade} from "./PayrollCampaignFacade.sol";
import {PayrollVault} from "./PayrollVault.sol";
import {PodClaimStore} from "./PodClaimStore.sol";

/// @title PayrollCampaignFactory
/// @notice UI entrypoint: deploy a configured facade, create vault run, and wire payroll in one tx.
contract PayrollCampaignFactory {
    event CampaignCreated(
        address indexed facade,
        uint256 indexed runId,
        address indexed admin,
        address creator,
        address token,
        bytes32 merkleRoot
    );

    PayrollVault public immutable vault;
    PodClaimStore public immutable claimStore;
    address public immutable comptroller;

    uint256 public callbackFeeWei;
    uint256 public inboxFeeWei;
    uint256 public pTokenTransferFeeWei;
    uint256 public pTokenCallbackFeeWei;

    address[] public campaigns;

    constructor(
        PayrollVault vault_,
        PodClaimStore claimStore_,
        address comptroller_,
        uint256 callbackFeeWei_,
        uint256 inboxFeeWei_,
        uint256 pTokenTransferFeeWei_,
        uint256 pTokenCallbackFeeWei_
    ) {
        vault = vault_;
        claimStore = claimStore_;
        comptroller = comptroller_;
        callbackFeeWei = callbackFeeWei_;
        inboxFeeWei = inboxFeeWei_;
        pTokenTransferFeeWei = pTokenTransferFeeWei_;
        pTokenCallbackFeeWei = pTokenCallbackFeeWei_;
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    /// @notice Deploy a new payroll campaign. `admin` may differ from `msg.sender` (creator).
    function createCampaign(
        address admin,
        bytes32 merkleRoot,
        address token,
        uint40 campaignStartTime,
        uint40 expiration,
        string calldata campaignName,
        uint256 minFeeUSD
    ) external returns (address facade, uint256 runId) {
        require(admin != address(0), "PayrollCampaignFactory: zero admin");
        require(token != address(0), "PayrollCampaignFactory: zero token");

        PayrollCampaignFacade facadeContract = new PayrollCampaignFacade(
            admin,
            comptroller,
            merkleRoot,
            token,
            campaignStartTime,
            expiration,
            campaignName,
            minFeeUSD
        );
        facade = address(facadeContract);

        runId = vault.createRun(merkleRoot, token, facade, campaignStartTime, expiration);

        facadeContract.wirePayroll(
            vault,
            claimStore,
            runId,
            callbackFeeWei,
            inboxFeeWei,
            pTokenTransferFeeWei,
            pTokenCallbackFeeWei
        );

        campaigns.push(facade);
        emit CampaignCreated(facade, runId, admin, msg.sender, token, merkleRoot);
    }
}
