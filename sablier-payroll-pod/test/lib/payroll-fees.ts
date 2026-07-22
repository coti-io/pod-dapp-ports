import type { Address, PublicClient } from "viem";

/**
 * Off-chain payroll two-way fee heuristics for InboxFeeManager.
 * Tunable in the UI/SDK only — never baked into PayrollVault.
 * Remote exec gas is elevated vs pToken defaults (MPC verifyAndCredit / creditPool).
 */
export const PAYROLL_FEE_REMOTE_CALL_SIZE = 4096n;
export const PAYROLL_FEE_CALLBACK_CALL_SIZE = 4096n;
export const PAYROLL_FEE_REMOTE_EXEC_GAS = 6_000_000n;
export const PAYROLL_FEE_CALLBACK_EXEC_GAS = 600_000n;

/** Matches PodERC20 on-chain estimateFee heuristics (until that token is redesigned). */
export const PTOKEN_FEE_REMOTE_CALL_SIZE = 512n;
export const PTOKEN_FEE_CALLBACK_CALL_SIZE = 512n;
export const PTOKEN_FEE_REMOTE_EXEC_GAS = 300_000n;
export const PTOKEN_FEE_CALLBACK_EXEC_GAS = 300_000n;

/**
 * Inbox FeeManager `_referenceGasPrice` / Fuji bounds often sit at ≥ 2 gwei.
 * Quoting below that underpays gas-unit budgets (`TargetFeeTooLow` / `CallbackFeeTooLow`).
 */
export const PAYROLL_FEE_MIN_GAS_PRICE_WEI = 2_000_000_000n;

/** Small pad for mulDiv rounding between estimate and inbox validate. */
export const padPodFeeWei = (x: bigint) => x + x / 20n + 1n;

/** Clamp RPC gasPrice to the inbox minimum before quoting or sending. */
export const clampPayrollGasPrice = (gasPrice: bigint): bigint =>
  gasPrice > PAYROLL_FEE_MIN_GAS_PRICE_WEI ? gasPrice : PAYROLL_FEE_MIN_GAS_PRICE_WEI;

export type PayrollInboxFeeQuote = {
  totalFeeWei: bigint;
  targetFeeWei: bigint;
  callbackFeeWei: bigint;
};

type InboxFeeReader = {
  read: {
    calculateTwoWayFeeRequiredInLocalToken: (args: readonly [bigint, bigint, bigint, bigint, bigint]) => Promise<
      readonly [bigint, bigint]
    >;
  };
};

type PTokenFeeReader = {
  read: {
    estimateFee: (opts?: { gasPrice?: bigint }) => Promise<readonly [bigint, bigint, bigint]>;
  };
};

/**
 * Quote live payroll two-way inbox fees from the inbox (UI source of truth).
 * Pass a real gasPrice (≥ inbox min, often 2 gwei on Fuji) for the upcoming tx.
 */
export async function quotePayrollInboxFees(
  inbox: InboxFeeReader,
  gasPrice: bigint
): Promise<PayrollInboxFeeQuote> {
  const gp = clampPayrollGasPrice(gasPrice);
  const [targetFeeWeiRaw, callbackFeeWeiRaw] = await inbox.read.calculateTwoWayFeeRequiredInLocalToken([
    PAYROLL_FEE_REMOTE_CALL_SIZE,
    PAYROLL_FEE_CALLBACK_CALL_SIZE,
    PAYROLL_FEE_REMOTE_EXEC_GAS,
    PAYROLL_FEE_CALLBACK_EXEC_GAS,
    gp,
  ]);
  const targetFeeWei = padPodFeeWei(targetFeeWeiRaw);
  const callbackFeeWei = padPodFeeWei(callbackFeeWeiRaw);
  return {
    targetFeeWei,
    callbackFeeWei,
    totalFeeWei: targetFeeWei + callbackFeeWei,
  };
}

/**
 * Quote pToken public-transfer fees via InboxFeeManager using PodERC20-sized heuristics.
 * Prefer this over relying on StoryToken wrappers that omit estimateFee.
 */
export async function quotePTokenTransferFees(
  inbox: InboxFeeReader,
  gasPrice: bigint
): Promise<PayrollInboxFeeQuote> {
  const gp = clampPayrollGasPrice(gasPrice);
  const [targetFeeWeiRaw, callbackFeeWeiRaw] = await inbox.read.calculateTwoWayFeeRequiredInLocalToken([
    PTOKEN_FEE_REMOTE_CALL_SIZE,
    PTOKEN_FEE_CALLBACK_CALL_SIZE,
    PTOKEN_FEE_REMOTE_EXEC_GAS,
    PTOKEN_FEE_CALLBACK_EXEC_GAS,
    gp,
  ]);
  const targetFeeWei = padPodFeeWei(targetFeeWeiRaw);
  const callbackFeeWei = padPodFeeWei(callbackFeeWeiRaw);
  return {
    totalFeeWei: targetFeeWei + callbackFeeWei,
    targetFeeWei,
    callbackFeeWei,
  };
}

/** @deprecated Prefer quotePTokenTransferFees(inbox, gasPrice). Kept for live eth_call against pToken.estimateFee. */
export async function quotePTokenEstimateFeeView(
  pToken: PTokenFeeReader,
  gasPrice: bigint
): Promise<PayrollInboxFeeQuote> {
  const gp = clampPayrollGasPrice(gasPrice);
  const [totalFeeWeiRaw, targetFeeWeiRaw, callbackFeeWeiRaw] = await pToken.read.estimateFee({ gasPrice: gp });
  const targetFeeWei = padPodFeeWei(targetFeeWeiRaw);
  const callbackFeeWei = padPodFeeWei(callbackFeeWeiRaw);
  return {
    totalFeeWei: targetFeeWei + callbackFeeWei,
    targetFeeWei,
    callbackFeeWei,
  };
}

export async function quotePayrollInboxFeesFromClient(
  publicClient: PublicClient,
  inbox: InboxFeeReader,
  _account?: Address
): Promise<PayrollInboxFeeQuote & { gasPrice: bigint }> {
  const gasPrice = clampPayrollGasPrice(await publicClient.getGasPrice());
  const quote = await quotePayrollInboxFees(inbox, gasPrice);
  return { ...quote, gasPrice };
}
