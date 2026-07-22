import { encodeAbiParameters, type Address, type Hex } from "viem";
import type { ClaimPackage } from "./merkle.js";
import { encodeLeaf } from "./merkle.js";
import { logStep } from "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";
import type { PodPayrollBackend } from "./pod-backend.js";
import { mineAfterPayoutClaim, mineAfterPayoutTransfer } from "./async.js";
import {
  clampPayrollGasPrice,
  quotePayrollInboxFees,
  quotePTokenTransferFees,
} from "./payroll-fees.js";

export type CampaignContract = {
  address: Address;
  read: Record<string, (...args: unknown[]) => Promise<unknown>>;
  write: Record<string, (...args: unknown[]) => Promise<Hex>>;
};

export function wrapCampaignFacade(
  raw: CampaignContract,
  backend: PodPayrollBackend
): CampaignContract {
  const { podCtx, claimStore } = backend;

  async function preparePayload(pkg: ClaimPackage, claimant: Address): Promise<void> {
    await backend.ensureFacadeTokenIdle?.(raw.address, `preclaim-${pkg.index}`);
    await backend.tokenAdapter.syncAccount(raw.address, `preclaim-facade-${pkg.index}`);
    await backend.tokenAdapter.syncAccount(claimant, `preclaim-claimant-${pkg.index}`);
    const verifyIt = await backend.buildVerifyItAmount(claimant, pkg.amount);
    const proofHandle = encodeAbiParameters(
      [
        { type: "bytes32[]" },
        { type: "uint256" },
      ],
      [pkg.proof, BigInt(pkg.index)]
    );
    await claimStore.write.submitPayload(
      [raw.address, BigInt(pkg.index), verifyIt, proofHandle],
      { account: claimant }
    );
  }

  async function quoteClaimFees(): Promise<{
    gasPrice: bigint;
    inboxTotalFeeWei: bigint;
    inboxCallbackFeeWei: bigint;
    pTokenTotalFeeWei: bigint;
    pTokenCallbackFeeWei: bigint;
  }> {
    const gasPrice = clampPayrollGasPrice(await backend.publicClient.getGasPrice());
    const inboxFees = await quotePayrollInboxFees(podCtx.contracts.inboxSepolia, gasPrice);
    const pTokenFees = await quotePTokenTransferFees(podCtx.contracts.inboxSepolia, gasPrice);
    return {
      gasPrice,
      inboxTotalFeeWei: inboxFees.totalFeeWei,
      inboxCallbackFeeWei: inboxFees.callbackFeeWei,
      pTokenTotalFeeWei: pTokenFees.totalFeeWei,
      pTokenCallbackFeeWei: pTokenFees.callbackFeeWei,
    };
  }

  function claimArgs(
    index: bigint,
    recipientOrTo: Address,
    proof: Hex[],
    fees: Awaited<ReturnType<typeof quoteClaimFees>>
  ) {
    return [
      index,
      recipientOrTo,
      proof,
      fees.inboxTotalFeeWei,
      fees.inboxCallbackFeeWei,
      fees.pTokenTotalFeeWei,
      fees.pTokenCallbackFeeWei,
    ] as const;
  }

  async function claimWithMining(
    fn: () => Promise<Hex>,
    pkg: ClaimPackage,
    claimant: Address,
    payoutTo: Address,
    expectSuccess: boolean
  ): Promise<Hex> {
    if (expectSuccess) {
      await preparePayload(pkg, claimant);
    }
    let hash: Hex;
    try {
      hash = await fn();
    } catch (e) {
      throw e;
    }
    const receipt = await backend.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error("claim transaction reverted");
    }
    if (!expectSuccess) return hash;
    try {
      await mineAfterPayoutClaim(podCtx, `claim-${pkg.index}`);
      await mineAfterPayoutTransfer(podCtx, `payout-${pkg.index}`);
      if (backend.tokenAdapter) {
        await backend.tokenAdapter.syncAccount(payoutTo, `sync-${pkg.index}`);
      }
    } catch (e) {
      logStep(`sablier-payroll-pod: mine failed index=${pkg.index}: ${String(e)}`);
      throw new Error(`claim failed: ${String(e)}`);
    }
    const claimed = (await raw.read.hasClaimed([BigInt(pkg.index)])) as boolean;
    if (!claimed) {
      logStep(
        `sablier-payroll-pod: hasClaimed false after mine index=${pkg.index} (COTI verifyAndCredit likely raised)`
      );
      throw new Error("claim failed: hasClaimed still false (COTI reject / no payout callback)");
    }
    return hash;
  }

  return {
    address: raw.address,
    read: raw.read,
    write: {
      ...raw.write,
      async claim(args: unknown[], opts?: { account?: Address; value?: bigint; gasPrice?: bigint }) {
        const [index, recipient, amount, proof] = args as [bigint, Address, bigint, Hex[]];
        const pkg: ClaimPackage = {
          index: Number(index),
          recipient,
          amount,
          proof,
          leaf: encodeLeaf(Number(index), recipient, amount),
        };
        const claimant = (opts?.account ?? recipient) as Address;
        const fees = await quoteClaimFees();
        return claimWithMining(
          () =>
            raw.write.claim(claimArgs(index, recipient, proof, fees), {
              ...opts,
              gasPrice: opts?.gasPrice ?? fees.gasPrice,
              gas: 8_000_000n,
            }),
          pkg,
          claimant,
          claimant,
          true
        );
      },
      async claimPackage(args: unknown[], opts?: { account?: Address; value?: bigint; gasPrice?: bigint }) {
        const [pkg] = args as [ClaimPackage];
        const claimant = (opts?.account ?? pkg.recipient) as Address;
        const fees = await quoteClaimFees();
        return claimWithMining(
          () =>
            raw.write.claim(
              claimArgs(BigInt(pkg.index), pkg.recipient, pkg.proof, fees),
              { ...opts, gasPrice: opts?.gasPrice ?? fees.gasPrice, gas: 8_000_000n }
            ),
          pkg,
          claimant,
          claimant,
          true
        );
      },
      async claimTo(args: unknown[], opts?: { account?: Address; value?: bigint; gasPrice?: bigint }) {
        const [index, to, amount, proof] = args as [bigint, Address, bigint, Hex[]];
        const claimant = opts?.account as Address;
        const pkg: ClaimPackage = {
          index: Number(index),
          recipient: claimant,
          amount,
          proof,
          leaf: encodeLeaf(Number(index), claimant, amount),
        };
        const fees = await quoteClaimFees();
        return claimWithMining(
          () =>
            raw.write.claimTo(claimArgs(index, to, proof, fees), {
              ...opts,
              gasPrice: opts?.gasPrice ?? fees.gasPrice,
              gas: 8_000_000n,
            }),
          pkg,
          claimant,
          to,
          true
        );
      },
      async claimToPackage(args: unknown[], opts?: { account?: Address; value?: bigint; gasPrice?: bigint }) {
        const [pkg, to] = args as [ClaimPackage, Address];
        const claimant = (opts?.account ?? pkg.recipient) as Address;
        const fees = await quoteClaimFees();
        return claimWithMining(
          () =>
            raw.write.claimTo(claimArgs(BigInt(pkg.index), to, pkg.proof, fees), {
              ...opts,
              account: claimant,
              gasPrice: opts?.gasPrice ?? fees.gasPrice,
              gas: 8_000_000n,
            }),
          pkg,
          claimant,
          to,
          true
        );
      },
      async clawback(args: unknown[], opts?: { account?: Address }) {
        const [to, amount] = args as [Address, bigint];
        const gasPrice = clampPayrollGasPrice(await backend.publicClient.getGasPrice());
        const fees = await quotePayrollInboxFees(backend.podCtx.contracts.inboxSepolia, gasPrice);
        const pTokenFees = await quotePTokenTransferFees(backend.podCtx.contracts.inboxSepolia, gasPrice);
        const hash = await raw.write.clawback(
          [to, amount, fees.callbackFeeWei, pTokenFees.totalFeeWei, pTokenFees.callbackFeeWei],
          {
            ...opts,
            value: fees.totalFeeWei,
            gasPrice,
            gas: 8_000_000n,
          }
        );
        const receipt = await backend.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
          await mineAfterPayoutClaim(podCtx, "clawback-pool");
          await mineAfterPayoutTransfer(podCtx, "clawback");
        }
        return hash;
      },
    },
  };
}

/** Patch viem.deployContract to route Sablier harness deploys to PoD facade. */
export function patchSablierDeploy(
  viem: { deployContract: (...args: unknown[]) => Promise<CampaignContract> },
  backend: PodPayrollBackend,
  deployWrappedFacade: (args: unknown[]) => Promise<CampaignContract>
): void {
  const original = viem.deployContract.bind(viem);
  viem.deployContract = async (name: string, args: unknown[], opts?: unknown) => {
    if (typeof name === "string" && name.includes("SablierMerkleInstantHarness")) {
      return deployWrappedFacade(args);
    }
    return original(name, args, opts);
  };
}
