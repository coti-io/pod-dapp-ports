/**
 * S28–S31 — Employee moves funds after payroll payment
 *
 * Sablier pays ERC20 to the employee wallet; moving funds is standard token transfer/approve.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSablierPayrollScenario } from "../lib/sablier-scenario.js";
import { employee } from "../lib/actors.js";
import { expectPaid } from "../lib/assertions.js";
import { spLog } from "../lib/utils.js";

const run = process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

d("S28–S31 employee move funds", { concurrency: 1 }, () => {
  it("S28: after claim, employee transfers full salary to savings wallet", async () => {
    const s = await createSablierPayrollScenario();
    const savings = s.carol.address;
    const salary = 3_200n;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: salary }],
    });

    const alice = employee(s, "alice");
    await alice.claim(tree.packageFor(s.alice.address), campaign);
    await expectPaid(alice, salary);

    const savingsBefore = (await s.token.read.balanceOf([savings])) as bigint;
    await alice.transfer(savings, salary);

    assert.equal(await alice.readTokenBalance(), 0n);
    assert.equal((await s.token.read.balanceOf([savings])) as bigint, savingsBefore + salary);
    spLog("S28 — UI: Move full paycheck to savings");
  });

  it("S29: after claim, employee sends partial amount to another wallet", async () => {
    const s = await createSablierPayrollScenario();
    const salary = 4_000n;
    const sendOut = 1_500n;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.bob.address, amount: salary }],
    });

    const bob = employee(s, "bob");
    await bob.claim(tree.packageFor(s.bob.address), campaign);
    const recipientBefore = (await s.token.read.balanceOf([s.alice.address])) as bigint;

    await bob.transfer(s.alice.address, sendOut);

    assert.equal(await bob.readTokenBalance(), salary - sendOut);
    assert.equal(
      (await s.token.read.balanceOf([s.alice.address])) as bigint,
      recipientBefore + sendOut
    );
    spLog("S29 — UI: Partial transfer — rent / split payment");
  });

  it("S30: employee approves spender then spender pulls funds (transferFrom)", async () => {
    const s = await createSablierPayrollScenario();
    const salary = 2_000n;
    const pullAmount = 800n;
    const spender = s.carol.address;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: salary }],
    });

    const alice = employee(s, "alice");
    await alice.claim(tree.packageFor(s.alice.address), campaign);
    await alice.approve(spender, pullAmount);
    assert.equal(await alice.readAllowance(spender), pullAmount);

    const spenderBefore = (await s.token.read.balanceOf([spender])) as bigint;
    await s.token.write.transferFrom([s.alice.address, spender, pullAmount], {
      account: spender,
    });

    assert.equal(await alice.readTokenBalance(), salary - pullAmount);
    assert.equal((await s.token.read.balanceOf([spender])) as bigint, spenderBefore + pullAmount);
    spLog("S30 — UI: Approved app pulls payroll tokens");
  });

  it("S31: claimTo external wallet then employee moves remainder from that wallet", async () => {
    const s = await createSablierPayrollScenario();
    const salary = 2_500n;
    const hotWallet = s.bob.address;
    const coldWallet = s.carol.address;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: salary }],
    });

    await employee(s, "alice").claimTo(tree.packageFor(s.alice.address), hotWallet, campaign);
    assert.equal(await employee(s, "alice").readTokenBalance(), 0n);
    assert.equal((await s.token.read.balanceOf([hotWallet])) as bigint, salary);

    await s.token.write.transfer([coldWallet, salary], { account: hotWallet });
    assert.equal((await s.token.read.balanceOf([hotWallet])) as bigint, 0n);
    assert.equal((await s.token.read.balanceOf([coldWallet])) as bigint, salary);
    spLog("S31 — UI: Direct deposit to hot wallet, sweep to cold storage");
  });
});
