import type { TestContext } from "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";
import {
  DEFAULT_COTI_MINE_GAS_MPC_256,
  getLatestRequest,
  logStep,
  runCrossChainTwoWayRoundTrip,
} from "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";
import { getDefaultCotiMineGasPodToken } from "../../../../pod-ecosystem-integration/test/tokens/test-token-utils.js";

export type PodAsyncContext = TestContext;

export async function mineAfterPayoutClaim(ctx: PodAsyncContext, label = "payroll-claim"): Promise<void> {
  await runCrossChainTwoWayRoundTrip(ctx, label, { gas: DEFAULT_COTI_MINE_GAS_MPC_256 });
}

/**
 * Mines the pToken transfer round-trip queued by facade.payoutTo in the verify callback.
 * Skips if the Hardhat→COTI tip is already executed (no nested transfer — e.g. claim raised).
 */
export async function mineAfterPayoutTransfer(ctx: PodAsyncContext, label = "payroll-payout"): Promise<void> {
  const inbox = ctx.contracts.inboxSepolia;
  const cotiChainId = ctx.chainIds.coti;
  const len = Number(await inbox.read.getRequestsLen([BigInt(cotiChainId)]));
  if (len === 0) {
    logStep(`${label}: no Hardhat→COTI outbounds — skip`);
    return;
  }
  const latest = await getLatestRequest(inbox, cotiChainId);
  if (latest.executed) {
    logStep(
      `${label}: tip outbound ${latest.requestId} already executed — skip (no nested pToken transfer queued)`
    );
    return;
  }
  await runCrossChainTwoWayRoundTrip(ctx, label, { gas: getDefaultCotiMineGasPodToken() });
}
