/**
 * S01 — Deploy wiring
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSablierPayrollScenario } from "../lib/sablier-scenario.js";
import { spLog } from "../lib/utils.js";

const run = process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

d("S01 deploy wiring", { concurrency: 1 }, () => {
  it("S01: system deploys token, comptroller, and Sablier campaign harness", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
      fundAmount: 5_000n,
    });

    assert.ok(s.token.address);
    assert.ok(s.comptroller.address);
    assert.ok(campaign.address);
    assert.equal((await campaign.read.MERKLE_ROOT()) as string, tree.root);
    assert.equal((await campaign.read.TOKEN() as string).toLowerCase(), s.token.address.toLowerCase());
    assert.equal((await campaign.read.COMPTROLLER() as string).toLowerCase(), s.comptroller.address.toLowerCase());
    assert.equal((await campaign.read.admin() as string).toLowerCase(), s.admin.address.toLowerCase());
    spLog("S01 done — UI would show campaign addresses to employer");
  });
});
