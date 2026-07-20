import type { Address, PublicClient } from "viem";

/** Matches PayrollVault fee-estimate calldata / exec gas heuristics. */
export const PAYROLL_FEE_REMOTE_CALL_SIZE = 4096n;
export const PAYROLL_FEE_CALLBACK_CALL_SIZE = 4096n;
export const PAYROLL_FEE_REMOTE_EXEC_GAS = 600_000n;
export const PAYROLL_FEE_CALLBACK_EXEC_GAS = 600_000n;

/** Small pad for mulDiv rounding between estimate and inbox validate. */
export const padPodFeeWei = (x: bigint) => x + x / 20n + 1n;

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

type VaultFeeReader = {
  read: {
    estimateFee: (opts?: { gasPrice?: bigint }) => Promise<readonly [bigint, bigint, bigint]>;
  };
};

/**
 * Quote live payroll two-way inbox fees from the inbox (preferred for eth_call — pass real gasPrice).
 * Fees track oracle token prices and the gasPrice used for the upcoming tx.
 */
export async function quotePayrollInboxFees(
  inbox: InboxFeeReader,
  gasPrice: bigint
): Promise<PayrollInboxFeeQuote> {
  const [targetFeeWeiRaw, callbackFeeWeiRaw] = await inbox.read.calculateTwoWayFeeRequiredInLocalToken([
    PAYROLL_FEE_REMOTE_CALL_SIZE,
    PAYROLL_FEE_CALLBACK_CALL_SIZE,
    PAYROLL_FEE_REMOTE_EXEC_GAS,
    PAYROLL_FEE_CALLBACK_EXEC_GAS,
    gasPrice,
  ]);
  const targetFeeWei = padPodFeeWei(targetFeeWeiRaw);
  const callbackFeeWei = padPodFeeWei(callbackFeeWeiRaw);
  return {
    targetFeeWei,
    callbackFeeWei,
    totalFeeWei: targetFeeWei + callbackFeeWei,
  };
}

/** Quote via vault.estimateFee — set gasPrice on the eth_call so tx.gasprice is non-zero. */
export async function quotePayrollVaultFees(
  vault: VaultFeeReader,
  gasPrice: bigint
): Promise<PayrollInboxFeeQuote> {
  const [totalFeeWeiRaw, targetFeeWeiRaw, callbackFeeWeiRaw] = await vault.read.estimateFee({ gasPrice });
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
  account?: Address
): Promise<PayrollInboxFeeQuote & { gasPrice: bigint }> {
  const gasPrice = await publicClient.getGasPrice({ ...(account ? {} : {}) });
  const quote = await quotePayrollInboxFees(inbox, gasPrice);
  return { ...quote, gasPrice };
}
