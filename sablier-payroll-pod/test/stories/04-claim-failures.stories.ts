/**
 * S08–S13 — Claim failure branches
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSablierPayrollScenario } from "../lib/sablier-scenario.js";
import { employee } from "../lib/actors.js";
import { expectClaimReverts } from "../lib/assertions.js";
import { increaseTime, setNextBlockTimestamp, spLog } from "../lib/utils.js";

const run = process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

d("S08–S13 claim failures", { concurrency: 1 }, () => {
  it("S08: bad merkle proof reverts", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
    });
    const pkg = { ...tree.packageFor(s.alice.address), proof: [`0x${"ab".repeat(32)}`] };
    await expectClaimReverts(() => employee(s, "alice").claim(pkg, campaign));
    spLog("S08 — UI: Invalid proof error");
  });

  it("S09: wrong amount in claim reverts", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
    });
    const pkg = { ...tree.packageFor(s.alice.address), amount: 2_000n };
    await expectClaimReverts(() => employee(s, "alice").claim(pkg, campaign));
    spLog("S09 — UI: Amount does not match roster");
  });

  it("S10: double claim same index reverts", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
    });
    const alice = employee(s, "alice");
    const pkg = tree.packageFor(s.alice.address);
    await alice.claim(pkg, campaign);
    await expectClaimReverts(() => alice.claim(pkg, campaign));
    spLog("S10 — UI: Already claimed");
  });

  it("S11: wrong recipient address in claim reverts", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
    });
    const pkg = { ...tree.packageFor(s.alice.address), recipient: s.bob.address };
    await expectClaimReverts(() => employee(s, "alice").claim(pkg, campaign));
    spLog("S11 — UI: Not your allocation");
  });

  it("S12: claim before campaign start reverts", async () => {
    const s = await createSablierPayrollScenario();
    const now = Number((await s.publicClient.getBlock()).timestamp);
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
      campaignStartTime: now + 3600,
    });
    await expectClaimReverts(() =>
      employee(s, "alice").claim(tree.packageFor(s.alice.address), campaign)
    );
    spLog("S12 — UI: Campaign not started");
  });

  it("S13: claim after expiration reverts", async () => {
    const s = await createSablierPayrollScenario();
    const now = Number((await s.publicClient.getBlock()).timestamp);
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
      expiration: now + 100,
    });
    await increaseTime(s.publicClient, 200);
    await expectClaimReverts(() =>
      employee(s, "alice").claim(tree.packageFor(s.alice.address), campaign)
    );
    spLog("S13 — UI: Campaign expired");
  });

  it("S13b: insufficient protocol fee reverts when min fee configured", async () => {
    const s = await createSablierPayrollScenario();
    await s.comptroller.write.setMinFeeUSD([1n], { account: s.employer.address });
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
      minFeeUSD: 1n,
    });
    const pkg = tree.packageFor(s.alice.address);
    await expectClaimReverts(async () => {
      await campaign.write.claim([BigInt(pkg.index), pkg.recipient, pkg.amount, pkg.proof], {
        account: s.alice.address,
        value: 0n,
      });
    });
    spLog("S13b — UI: Insufficient fee");
  });
});
