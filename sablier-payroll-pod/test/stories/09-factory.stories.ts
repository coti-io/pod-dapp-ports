/**
 * S32 — Factory createCampaign (simCOTI): creator may differ from admin; run is wired.
 * Does not fund (pToken fund path is covered by other stories).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSablierPayrollScenario } from "../lib/sablier-scenario.js";
import { spLog } from "../lib/utils.js";

const run = process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

d("S32 factory createCampaign", { concurrency: 1 }, () => {
  it("S32: factory deploys campaign, wires vault run, DEPLOYER is factory", async () => {
    const s = await createSablierPayrollScenario();
    const now = Number((await s.publicClient.getBlock()).timestamp);
    const tree = s.merkle([{ index: 0, recipient: s.alice.address, amount: 2_000n }]);

    const probeDeployer = (await s.campaign.read.DEPLOYER()) as `0x${string}`;
    const factory = await s.viem.getContractAt(
      "contracts/sablier-payroll-pod/avax/PayrollCampaignFactory.sol:PayrollCampaignFactory",
      probeDeployer
    );

    const countBefore = Number(await factory.read.campaignCount());
    const runIdBefore = Number(
      await (
        await s.viem.getContractAt(
          "contracts/sablier-payroll-pod/avax/PayrollVault.sol:PayrollVault",
          (await s.campaign.read.payrollVault()) as `0x${string}`
        )
      ).read.nextRunId()
    );

    await factory.write.createCampaign(
      [
        s.admin.address,
        tree.root,
        s.token.address,
        now - 60,
        0,
        "Factory payroll",
        0n,
      ],
      { account: s.admin.address }
    );

    const facadeAddr = (await factory.read.campaigns([BigInt(countBefore)])) as `0x${string}`;
    const facade = await s.viem.getContractAt(
      "contracts/sablier-payroll-pod/avax/PayrollCampaignFacade.sol:PayrollCampaignFacade",
      facadeAddr
    );

    assert.equal((await facade.read.admin() as string).toLowerCase(), s.admin.address.toLowerCase());
    assert.equal((await facade.read.MERKLE_ROOT()) as string, tree.root);
    assert.equal((await facade.read.TOKEN() as string).toLowerCase(), s.token.address.toLowerCase());
    assert.equal((await facade.read.DEPLOYER() as string).toLowerCase(), probeDeployer.toLowerCase());

    const vault = (await facade.read.payrollVault()) as string;
    const runId = (await facade.read.runId()) as bigint;
    assert.ok(vault && vault !== "0x0000000000000000000000000000000000000000");
    assert.equal(Number(runId), runIdBefore);
    spLog(`S32 factory path OK facade=${facadeAddr} runId=${runId} deployer=${probeDeployer}`);
  });

  it("S32b: createCampaign allows creator != admin (employer as admin)", async () => {
    const s = await createSablierPayrollScenario();
    const now = Number((await s.publicClient.getBlock()).timestamp);
    const tree = s.merkle([{ index: 0, recipient: s.alice.address, amount: 500n }]);

    const factoryAddr = (await s.campaign.read.DEPLOYER()) as `0x${string}`;
    const factory = await s.viem.getContractAt(
      "contracts/sablier-payroll-pod/avax/PayrollCampaignFactory.sol:PayrollCampaignFactory",
      factoryAddr
    );

    const countBefore = Number(await factory.read.campaignCount());
    await factory.write.createCampaign(
      [
        s.employer.address,
        tree.root,
        s.token.address,
        now - 60,
        0,
        "Employer-admin payroll",
        0n,
      ],
      { account: s.admin.address }
    );

    const facadeAddr = (await factory.read.campaigns([BigInt(countBefore)])) as `0x${string}`;
    const facade = await s.viem.getContractAt(
      "contracts/sablier-payroll-pod/avax/PayrollCampaignFacade.sol:PayrollCampaignFacade",
      facadeAddr
    );

    assert.equal((await facade.read.admin() as string).toLowerCase(), s.employer.address.toLowerCase());
    assert.equal((await facade.read.DEPLOYER() as string).toLowerCase(), factoryAddr.toLowerCase());
    assert.equal((await facade.read.MERKLE_ROOT()) as string, tree.root);
    assert.ok(((await facade.read.runId()) as bigint) > 0n);
    spLog(`S32b creator=admin wallet admin=employer facade=${facadeAddr}`);
  });
});
