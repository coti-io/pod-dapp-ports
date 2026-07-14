import type { TestContext } from "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";
import {
  DEFAULT_COTI_MINE_GAS_MPC_256,
  runCrossChainTwoWayRoundTrip,
} from "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";
import { getDefaultCotiMineGasPodToken } from "../../../../pod-ecosystem-integration/test/tokens/test-token-utils.js";

export type PodAsyncContext = TestContext;

export async function mineAfterPayoutClaim(ctx: PodAsyncContext, label = "payroll-claim"): Promise<void> {
  await runCrossChainTwoWayRoundTrip(ctx, label, { gas: DEFAULT_COTI_MINE_GAS_MPC_256 });
}

/** Mines the pToken transfer round-trip queued by facade.payoutTo in the verify callback. */
export async function mineAfterPayoutTransfer(ctx: PodAsyncContext, label = "payroll-payout"): Promise<void> {
  await runCrossChainTwoWayRoundTrip(ctx, label, { gas: getDefaultCotiMineGasPodToken() });
}
