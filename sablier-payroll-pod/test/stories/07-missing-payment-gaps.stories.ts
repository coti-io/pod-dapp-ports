/**
 * S22–S27 — Missing payment edge cases
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";
import { createSablierPayrollScenario } from "../lib/sablier-scenario.js";
import { buildSablierTree } from "../lib/merkle.js";
import { employee } from "../lib/actors.js";
import { expectClaimReverts, expectPaid } from "../lib/assertions.js";
import { increaseTime, setNextBlockTimestamp, spLog } from "../lib/utils.js";

const run = process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

d("S22–S27 payment edge cases", { concurrency: 1 }, () => {
  it("S22: underfunded campaign — claim reverts, employee not paid", async () => {
    const s = await createSablierPayrollScenario();
    const salary = 5_000n;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: salary }],
      fundAmount: 2_000n,
    });
    const alice = employee(s, "alice");
    await expectClaimReverts(() => alice.claim(tree.packageFor(s.alice.address), campaign));
    assert.equal(await alice.readTokenBalance(), 0n);
    spLog("S22 — UI: Payment failed — employer pool insufficient");
  });

  it("S23: UI quotes fee before submit and claim succeeds with exact msg.value", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
      minFeeUSD: 3n,
    });
    const alice = employee(s, "alice");
    const quoted = await alice.quoteClaimFee(campaign);
    assert.equal(quoted, 3n);

    const pkg = tree.packageFor(s.alice.address);
    const hash = await campaign.write.claim(
      [BigInt(pkg.index), pkg.recipient, pkg.amount, pkg.proof],
      { account: s.alice.address, value: quoted }
    );
    const receipt = await s.publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    await expectPaid(alice, 1_000n);
    spLog("S23 — UI: Fee quote matches successful payment tx");
  });

  it("S24: overpaid claim fee — full msg.value forwarded to comptroller", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
      minFeeUSD: 2n,
    });
    const overpay = 10n;
    const comptrollerBefore = await s.publicClient.getBalance({ address: s.comptroller.address });
    const pkg = tree.packageFor(s.alice.address);
    await campaign.write.claim(
      [BigInt(pkg.index), pkg.recipient, pkg.amount, pkg.proof],
      { account: s.alice.address, value: overpay }
    );
    const comptrollerAfter = await s.publicClient.getBalance({ address: s.comptroller.address });
    assert.equal(comptrollerAfter, comptrollerBefore + overpay);
    spLog("S24 — UI: User overpaid protocol fee; excess sent to comptroller");
  });

  it("S25: wrong employee wallet cannot claim another employee's slot", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [
        { recipient: s.alice.address, amount: 1_000n },
        { recipient: s.bob.address, amount: 2_000n },
      ],
    });
    const alicePkg = tree.packageFor(s.alice.address);
    await expectClaimReverts(() => employee(s, "bob").claim(alicePkg, campaign));
    assert.equal(await employee(s, "bob").readTokenBalance(), 0n);
    spLog("S25 — UI: Not your payroll slot");
  });

  it("S26: claimTo zero address reverts", async () => {
    const s = await createSablierPayrollScenario();
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
    });
    await expectClaimReverts(() =>
      employee(s, "alice").claimTo(tree.packageFor(s.alice.address), zeroAddress, campaign)
    );
    spLog("S26 — UI: Invalid payout address");
  });

  it("S27: same employee with two roster indices claims both payments", async () => {
    const s = await createSablierPayrollScenario();
    const tree = buildSablierTree([
      { index: 0, recipient: s.alice.address, amount: 1_000n },
      { index: 1, recipient: s.alice.address, amount: 1_500n },
    ]);
    const now = Number((await s.publicClient.getBlock()).timestamp);
    const campaign = await s.viem.deployContract(
      "contracts/sablier-payroll/SablierMerkleInstantHarness.sol:SablierMerkleInstantHarness",
      [
        s.admin.address,
        s.comptroller.address,
        tree.root,
        s.token.address,
        now - 60,
        0,
        "Dual slot payroll",
        0n,
      ]
    );
    await s.token.write.mint([s.employer.address, 5_000n], { account: s.employer.address });
    await s.token.write.transfer([campaign.address, 5_000n], { account: s.employer.address });

    const alice = employee(s, "alice");
    await alice.claim(tree.packageAt(0), campaign);
    await alice.claim(tree.packageAt(1), campaign);
    assert.equal(await alice.readTokenBalance(), 2_500n);
    spLog("S27 — UI: Two payroll lines paid to same employee");
  });

  it("S27b: claim allowed exactly at campaign start time", async () => {
    const s = await createSablierPayrollScenario();
    const now = Number((await s.publicClient.getBlock()).timestamp);
    const start = now + 100;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
      campaignStartTime: start,
    });
    await setNextBlockTimestamp(s.publicClient, BigInt(start));
    await employee(s, "alice").claim(tree.packageFor(s.alice.address), campaign);
    await expectPaid(employee(s, "alice"), 1_000n);
  });

  it("S27c: claim rejected exactly at expiration timestamp", async () => {
    const s = await createSablierPayrollScenario();
    const now = Number((await s.publicClient.getBlock()).timestamp);
    const expiration = now + 200;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: 1_000n }],
      expiration,
    });
    await setNextBlockTimestamp(s.publicClient, BigInt(expiration));
    await expectClaimReverts(() =>
      employee(s, "alice").claim(tree.packageFor(s.alice.address), campaign)
    );
  });
});
