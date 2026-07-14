/**
 * S02–S03 — Employer setup
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSablierPayrollScenario } from "../lib/sablier-scenario.js";
import { buildSablierTree, encodeLeaf } from "../lib/merkle.js";
import { expectCampaignBalance } from "../lib/assertions.js";
import { spLog } from "../lib/utils.js";

const run = process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

d("S02–S03 employer setup", { concurrency: 1 }, () => {
  it("S02: employer builds 3-employee merkle tree off-chain", async () => {
    const s = await createSablierPayrollScenario();
    const tree = buildSablierTree([
      { index: 0, recipient: s.alice.address, amount: 2_500n },
      { index: 1, recipient: s.bob.address, amount: 3_000n },
      { index: 2, recipient: s.carol.address, amount: 1_500n },
    ]);

    assert.equal(tree.packages.length, 3);
    assert.ok(tree.root);
    for (const pkg of tree.packages) {
      assert.ok(pkg.proof.length >= 0);
      assert.equal(pkg.leaf, encodeLeaf(pkg.index, pkg.recipient, pkg.amount));
      spLog(`HR package index=${pkg.index} recipient=${pkg.recipient} amount=${pkg.amount}`);
    }
  });

  it("S03: employer creates funded campaign with aggregate budget on-chain", async () => {
    const s = await createSablierPayrollScenario();
    const fundAmount = 10_000n;
    const { tree, campaign } = await s.freshCampaign({
      roster: [
        { recipient: s.alice.address, amount: 2_500n },
        { recipient: s.bob.address, amount: 3_000n },
        { recipient: s.carol.address, amount: 1_500n },
      ],
      fundAmount,
    });

    assert.equal((await campaign.read.MERKLE_ROOT()) as string, tree.root);
    assert.equal((await campaign.read.campaignName()) as string, "Q1 Payroll");
    await expectCampaignBalance(s, campaign.address, fundAmount);
    spLog("S03 done — UI: Campaign live, $10k funded");
  });
});
