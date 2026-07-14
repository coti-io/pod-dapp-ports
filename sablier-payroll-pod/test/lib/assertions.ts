import assert from "node:assert/strict";
import type { Address } from "viem";
import type { SablierPayrollScenario } from "./sablier-scenario.js";
import type { Employee } from "./actors.js";

export async function expectPaid(
  emp: Employee,
  expected: bigint,
  message?: string
): Promise<void> {
  const balance = await emp.readTokenBalance();
  assert.equal(balance, expected, message ?? `expected balance ${expected}, got ${balance}`);
}

export async function expectCampaignBalance(
  s: SablierPayrollScenario,
  campaignAddress: Address,
  expected: bigint
): Promise<void> {
  const balance = (await s.token.read.balanceOf([campaignAddress])) as bigint;
  assert.equal(balance, expected, `campaign balance expected ${expected}, got ${balance}`);
}

export async function expectHasClaimed(
  campaign: SablierPayrollScenario["campaign"],
  index: number,
  expected: boolean
): Promise<void> {
  const claimed = (await campaign.read.hasClaimed([BigInt(index)])) as boolean;
  assert.equal(claimed, expected, `hasClaimed(${index}) expected ${expected}`);
}

export async function expectClaimReverts(
  fn: () => Promise<unknown>,
  pattern?: RegExp
): Promise<void> {
  await assert.rejects(fn, pattern);
}
