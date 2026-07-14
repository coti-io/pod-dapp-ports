/**
 * S04–S07 — Employee claim happy paths
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSablierPayrollScenario } from "../lib/sablier-scenario.js";
import { employee } from "../lib/actors.js";
import { expectHasClaimed, expectPaid } from "../lib/assertions.js";
import { spLog } from "../lib/utils.js";

const run = process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

d("S04–S07 employee claims", { concurrency: 1 }, () => {
  it("S04: employee views claim package in UI", async () => {
    const s = await createSablierPayrollScenario();
    const { tree } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 2_500n }],
    });
    const alice = employee(s, "alice");
    const preview = alice.viewPackage(tree.packageFor(s.alice.address));
    assert.equal(preview.salary, 2_500n);
    assert.equal(preview.index, 0);
  });

  it("S05: employee claims salary in one transaction (sync paid)", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 2_500n }],
      fundAmount: 5_000n,
    });
    const alice = employee(s, "alice");
    const pkg = tree.packageFor(s.alice.address);
    const fee = await alice.quoteClaimFee(campaign);
    assert.equal(fee, 0n);

    const before = await alice.readTokenBalance();
    const result = await alice.claim(pkg, campaign);
    assert.equal(result.receipt.status, "success");
    await expectPaid(alice, before + 2_500n);
    await expectHasClaimed(campaign, 0, true);
    spLog("S05 done — UI: Paid (single tx)");
  });

  it("S06: second employee claims from same campaign", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [
        { recipient: s.alice.address, amount: 2_500n },
        { recipient: s.bob.address, amount: 3_000n },
      ],
      fundAmount: 10_000n,
    });

    await employee(s, "alice").claim(tree.packageFor(s.alice.address), campaign);
    const bob = employee(s, "bob");
    const before = await bob.readTokenBalance();
    await bob.claim(tree.packageFor(s.bob.address), campaign);
    await expectPaid(bob, before + 3_000n);
    await expectHasClaimed(campaign, 1, true);
  });

  it("S07: UI shows already-claimed status", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
    });
    await employee(s, "alice").claim(tree.packageFor(s.alice.address), campaign);
    const claimed = (await campaign.read.hasClaimed([0n])) as boolean;
    assert.equal(claimed, true);
    spLog("S07 — UI disables claim button: Already claimed");
  });
});
