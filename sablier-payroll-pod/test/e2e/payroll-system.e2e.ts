/**
 * System e2e: full Inbox + Privacy Portal + pToken + payroll stack.
 *
 * Same shape as PEI `privacy-portal-system.ts` + payroll fund/claim/clawback.
 * Source leg is Hardhat (Fuji/Sepolia surrogate — no 0x64); COTI is sim or live testnet.
 *
 *   COTI_BACKEND=sim     npm run test:e2e
 *   COTI_BACKEND=testnet npm run test:e2e:testnet
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createSablierPayrollScenario, type SablierPayrollScenario } from "../lib/sablier-scenario.js";
import { admin, employee } from "../lib/actors.js";
import { expectHasClaimed, expectPaid } from "../lib/assertions.js";
import { spLog } from "../lib/utils.js";
import { isSimCotiBackend } from "../../../../pod-ecosystem-integration/test/sim-coti/sim-coti-utils.js";

const run = process.env.PAYROLL_SYSTEM_E2E === "1" || process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

if (!run) {
  spLog('payroll-system-e2e skipped — set PAYROLL_SYSTEM_E2E=1 or SABLIER_PAYROLL_TESTS=1');
}

d("Payroll system e2e (Inbox + PP + pToken ↔ COTI)", { concurrency: 1 }, () => {
  let s: SablierPayrollScenario;

  before(async () => {
    spLog(
      `system-e2e before: backend=${isSimCotiBackend() ? "sim" : "testnet"} — deploy inbox/PP/pToken/payroll`
    );
    s = await createSablierPayrollScenario();
    spLog(
      `system-e2e ready portal=${s.infra.portal} pToken=${s.infra.pToken} vault=${s.infra.payrollVault} coti=${s.infra.privatePayrollCoti}`
    );
  });

  it("wiring: inbox, portal, pToken, vault, and COTI payroll are deployed", async () => {
    const { infra, publicClient } = s;
    assert.ok(infra.inboxSource && infra.inboxCoti, "dual inboxes");
    assert.ok(infra.portal && infra.pToken && infra.underlying, "PP + pToken + underlying");
    assert.ok(infra.payrollVault && infra.privatePayrollCoti && infra.campaignFactory, "payroll stack");

    const portalMinter = (await infra.portalCtx.pod.read.minter()) as string;
    assert.equal(portalMinter.toLowerCase(), infra.portal.toLowerCase(), "portal is pToken minter");

    const precompile = (await publicClient.getCode({
      address: "0x0000000000000000000000000000000000000064",
    })) as string | undefined;
    assert.ok(
      !precompile || precompile === "0x",
      "source chain must not inject 0x64 (Fuji/Sepolia-shaped PoD client)"
    );

    assert.equal(infra.backend, isSimCotiBackend() ? "sim" : "testnet");
    spLog(`wiring ok backend=${infra.backend} sourceChain=${infra.sourceChainId} coti=${infra.cotiChainId}`);
  });

  it("portal: deposit tops up employer pToken treasury via inbox round-trip", async () => {
    const topUp = 5_000n;
    const before = (await s.token.read.balanceOf([s.employer.address])) as bigint;
    await s.portalDeposit(s.employer.address, topUp, "e2e-portal-topup");
    const after = (await s.token.read.balanceOf([s.employer.address])) as bigint;
    assert.equal(after, before + topUp, "portal deposit must mint pToken to employer");
    spLog(`portal deposit ok +${topUp}`);
  });

  it("create + fund: public transfer + requestCreditPool updates poolCreditedTotal", async () => {
    const salary = 2_000n;
    const { campaign, fundAmount } = await s.freshCampaign({
      roster: [
        { recipient: s.alice.address, amount: salary },
        { recipient: s.bob.address, amount: salary },
      ],
      fundAmount: salary * 2n,
    });

    const credited = (await campaign.read.poolCreditedTotal()) as bigint;
    assert.equal(credited, fundAmount, "COTI creditPool callback must bump poolCreditedTotal");
    // Facade pToken balance is encrypted; decrypt keying for contracts is brittle on live COTI.
    // poolCreditedTotal is the canonical fund success marker (matches Fuji UI polling).
    spLog(`fund ok credited=${credited}`);
  });

  it("claim: employee receives public pToken after COTI verifyAndCredit + payout callback", async () => {
    const salary = 1_500n;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: salary }],
      fundAmount: salary,
    });

    const alice = employee(s, "alice");
    const before = await alice.readTokenBalance();
    await alice.claim(tree.packageFor(s.alice.address), campaign);
    await expectHasClaimed(campaign, 0, true);
    await expectPaid(alice, before + salary);
    spLog(`claim ok alice +${salary}`);
  });

  it("clawback: admin recovers remaining pool via COTI clawbackPool + public payout", async () => {
    const salary = 1_000n;
    const leftover = 500n;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: salary }],
      fundAmount: salary + leftover,
    });

    const alice = employee(s, "alice");
    await alice.claim(tree.packageFor(s.alice.address), campaign);

    const adminActor = admin(s);
    const bobBefore = (await s.token.read.balanceOf([s.bob.address])) as bigint;
    await adminActor.clawback(campaign, s.bob.address, leftover);
    const bobAfter = (await s.token.read.balanceOf([s.bob.address])) as bigint;
    assert.equal(bobAfter, bobBefore + leftover, "clawback payout must land on bob");
    spLog(`clawback ok bob +${leftover}`);
  });
});
