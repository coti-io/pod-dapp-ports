/**
 * S14–S15 — claimTo and admin clawback
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSablierPayrollScenario } from "../lib/sablier-scenario.js";
import { admin, employee } from "../lib/actors.js";
import { expectClaimReverts, expectPaid } from "../lib/assertions.js";
import { increaseTime, spLog } from "../lib/utils.js";

const run = process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

d("S14–S15 claimTo and clawback", { concurrency: 1 }, () => {
  it("S14: employee claimTo sends payout to different wallet", async () => {
    const s = await createSablierPayrollScenario();
    const payoutWallet = s.carol.address;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 2_500n }],
      fundAmount: 5_000n,
    });
    const alice = employee(s, "alice");
    const before = (await s.token.read.balanceOf([payoutWallet])) as bigint;
    await alice.claimTo(tree.packageFor(s.alice.address), payoutWallet, campaign);
    const after = (await s.token.read.balanceOf([payoutWallet])) as bigint;
    assert.equal(after, before + 2_500n);
    const aliceBal = await alice.readTokenBalance();
    assert.equal(aliceBal, 0n);
    spLog("S14 — UI: Sent salary to external wallet");
  });

  it("S15: admin clawback allowed during grace, blocked after grace while campaign active", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [
        { recipient: s.alice.address, amount: 2_500n },
        { recipient: s.bob.address, amount: 3_000n },
      ],
      fundAmount: 10_000n,
      expiration: 0,
    });

    await employee(s, "alice").claim(tree.packageFor(s.alice.address), campaign);
    assert.ok((await campaign.read.firstClaimTime()) > 0n);

    // During 7-day grace window after first claim, Sablier allows clawback
    const employerBeforeGrace = (await s.token.read.balanceOf([s.employer.address])) as bigint;
    await admin(s).clawback(campaign, s.employer.address, 1_000n);
    const employerAfterGrace = (await s.token.read.balanceOf([s.employer.address])) as bigint;
    assert.equal(employerAfterGrace, employerBeforeGrace + 1_000n);

    await increaseTime(s.publicClient, 7 * 24 * 60 * 60 + 1);

    // After grace, while campaign has not expired, clawback is blocked
    await expectClaimReverts(() =>
      admin(s).clawback(campaign, s.employer.address, 1_000n)
    );
    spLog("S15 — UI: Admin cannot clawback during active campaign window after grace");
  });

  it("S15b: admin clawback allowed after campaign expires", async () => {
    const s = await createSablierPayrollScenario();
    const now = Number((await s.publicClient.getBlock()).timestamp);
    const { campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
      fundAmount: 5_000n,
      expiration: now + 50,
    });
    await increaseTime(s.publicClient, 100);
    assert.equal(await campaign.read.hasExpired(), true);
    // Expired campaigns allow clawback (grace check skipped when expired)
    const before = (await s.token.read.balanceOf([s.employer.address])) as bigint;
    await admin(s).clawback(campaign, s.employer.address, 1_000n);
    const after = (await s.token.read.balanceOf([s.employer.address])) as bigint;
    assert.equal(after, before + 1_000n);
  });
});
