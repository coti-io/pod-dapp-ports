/**
 * Architecture e2e: create → fund (public transfer + COTI creditPool) → claim,
 * asserting Fuji facade never depends on local MpcCore / ackPoolCredit.
 * Harness must not inject 0x64 on the AVAX surrogate (matches live Fuji).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSablierPayrollScenario } from "../lib/sablier-scenario.js";
import { employee } from "../lib/actors.js";
import { expectPaid, expectHasClaimed } from "../lib/assertions.js";
import { spLog } from "../lib/utils.js";

const run = process.env.SABLIER_PAYROLL_TESTS === "1";
const d = run ? describe : describe.skip;

const facadeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../contracts-src/avax/PayrollCampaignFacade.sol"),
  "utf8"
);

d("PoD architecture: create + fund + distribute (no Fuji MpcCore)", { concurrency: 1 }, () => {
  it("facade source has no MpcCore.* call sites or ackPoolCredit", () => {
    assert.equal(facadeSrc.includes("ackPoolCredit"), false, "ackPoolCredit must be removed");
    // Types-only import of MpcCore.sol is OK for itUint256 ABI; forbid runtime call sites.
    assert.equal(
      /MpcCore\.(validate|offBoard|onBoard|setPublic|add|sub|decrypt|eq|ge|checkedSub)/.test(facadeSrc),
      false,
      "facade must not call MpcCore.* (no 0x64 on PoD client chains)"
    );
    assert.equal(facadeSrc.includes("_poolBalanceCt"), false, "pool ledger must not live on Fuji");
    assert.match(facadeSrc, /requestCreditPool/, "facade must expose requestCreditPool");
    assert.match(
      facadeSrc,
      /payoutTo\(address to, uint256 amount, uint256 callbackFeeWei\)/,
      "payout must be public uint256 with UI-supplied callback fee"
    );
    spLog("architecture — Fuji facade is thin inbox client");
  });

  it("create + public fund + COTI credit + claim; AVAX has no 0x64", async () => {
    const s = await createSablierPayrollScenario();

    // Live Fuji has empty code at 0x64 — sim must match or it false-greens.
    const precompileCode = (await s.publicClient.getCode({
      address: "0x0000000000000000000000000000000000000064",
    })) as string | undefined;
    assert.ok(
      !precompileCode || precompileCode === "0x",
      "AVAX surrogate must not inject SimExtendedOperations at 0x64 (matches live Fuji)"
    );

    const salary = 1_000n;
    const { tree, campaign } = await s.freshCampaign({
      roster: [{ recipient: s.alice.address, amount: salary }],
      fundAmount: 1_000n,
    });

    const facadeCode = (await s.publicClient.getCode({ address: campaign.address })) as string;
    assert.ok(facadeCode && facadeCode !== "0x", "facade must be deployed");
    // MpcCore embeds ExtendedOperations at address(0x64) as a 20-byte word.
    assert.equal(
      facadeCode.toLowerCase().includes("0000000000000000000000000000000000000064"),
      false,
      "deployed facade bytecode must not embed MPC precompile address 0x64"
    );

    const credited = (await campaign.read.poolCreditedTotal()) as bigint;
    assert.equal(credited, 1_000n, "COTI pool credit callback should update facade marker");

    const alice = employee(s, "alice");
    await alice.claim(tree.packageFor(s.alice.address), campaign);
    await expectHasClaimed(campaign, 0, true);
    await expectPaid(alice, salary);
    spLog("architecture e2e — create/fund/claim OK without Fuji 0x64");
  });
});
