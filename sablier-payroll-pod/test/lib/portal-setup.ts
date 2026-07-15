/**
 * Privacy Portal + PodErc20Mintable wiring for payroll port tests.
 * Portal is test infra for corporate treasury only — payroll contracts use pToken only.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, WalletClient } from "viem";
import { oracleTokensForChain } from "../../../../pod-ecosystem-integration/scripts/oracle-tokens.js";
import {
  fundContractForInboxFees,
  estimateGas,
  isSimCotiBackend,
  podTwoWayWriteOptions,
  receiptWaitOptions,
  runCrossChainTwoWayRoundTrip,
  type TestContext,
} from "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";
import {
  getDefaultCotiMineGasPodToken,
  registerPodTokenOnMother,
  type PodTokenTestContext,
} from "../../../../pod-ecosystem-integration/test/tokens/test-token-utils.js";
import { registerUserOnSim } from "../../../../pod-ecosystem-integration/test/sim-coti/sim-coti-utils.js";
import { keccak256, encodePacked } from "viem";

export type PayrollPortalContext = PodTokenTestContext & {
  portal: { address: Address; write: Record<string, (...args: unknown[]) => Promise<Hex>> };
  underlying: {
    address: Address;
    write: Record<string, (...args: unknown[]) => Promise<Hex>>;
    read: Record<string, (...args: unknown[]) => Promise<unknown>>;
  };
  employerWallet: WalletClient;
};

function simAesKeyForAddress(address: Address): string {
  return keccak256(encodePacked(["string", "address"], ["sim-coti-system-aes", address])).slice(2, 34);
}

/** Deploy portal + pToken (minter = portal) on top of an existing dual-chain test context. */
export async function setupPayrollPortal(params: {
  sepoliaViem: {
    deployContract: (...args: unknown[]) => Promise<unknown>;
    getContractAt: (...args: unknown[]) => Promise<unknown>;
    getWalletClient: (address: Address) => Promise<WalletClient>;
  };
  cotiViem: { deployContract: (...args: unknown[]) => Promise<unknown> };
  podCtx: TestContext;
  cotiOwnerPk: Hex;
}): Promise<PayrollPortalContext> {
  const { sepoliaViem, cotiViem, podCtx, cotiOwnerPk } = params;
  const cotiAccount = privateKeyToAccount(cotiOwnerPk);
  const owner = cotiAccount.address;
  const employerWallet = await sepoliaViem.getWalletClient(owner);

  const podCotiMother = await cotiViem.deployContract(
    "PodErc20CotiMother",
    [podCtx.contracts.inboxCoti.address, owner],
    { client: { public: podCtx.coti.publicClient, wallet: podCtx.coti.wallet } } as never
  );

  const underlying = (await sepoliaViem.deployContract("MockERC20Decimals", [
    "Payroll USD",
    "PUSD",
    6,
  ])) as PayrollPortalContext["underlying"];

  const { portalNative } = oracleTokensForChain(Number(podCtx.chainIds.sepolia));
  const mockFactory = await sepoliaViem.deployContract("MockPrivacyPortalFactory", [owner, portalNative]);
  const cloneHelper = await sepoliaViem.deployContract("CloneHelper", []);
  const portalImpl = await sepoliaViem.deployContract("PrivacyPortal", []);
  await (cloneHelper as { write: { clone: (...args: unknown[]) => Promise<Hex> } }).write.clone(
    [(portalImpl as { address: Address }).address],
    { account: owner }
  );
  const portalAddress = await (cloneHelper as { read: { lastClone: () => Promise<Address> } }).read.lastClone();
  const portal = (await sepoliaViem.getContractAt("PrivacyPortal", portalAddress)) as PayrollPortalContext["portal"];

  const pod = (await sepoliaViem.deployContract("PodErc20Mintable", [
    portalAddress,
    podCtx.chainIds.coti,
    podCtx.contracts.inboxSepolia.address,
    (podCotiMother as { address: Address }).address,
    "Private Payroll USD",
    "pPUSD",
  ])) as PayrollPortalContext["pod"];

  await portal.write.initialize([owner, underlying.address, pod.address, 6, false], { account: owner });
  await portal.write.setPauseController([(mockFactory as { address: Address }).address], { account: owner });

  await fundContractForInboxFees(employerWallet, podCtx.sepolia.publicClient, pod.address as Address, 5n * 10n ** 18n);
  await fundContractForInboxFees(employerWallet, podCtx.sepolia.publicClient, portalAddress, 3n * 10n ** 18n);

  await registerPodTokenOnMother({
    base: podCtx,
    mother: podCotiMother,
    pTokenAddress: pod.address as Address,
    registrar: owner,
    name: "Private Payroll USD",
    symbol: "pPUSD",
    decimals: 6,
  });

  const podAsCoti = await sepoliaViem.getContractAt("PodErc20Mintable", pod.address, {
    client: { public: podCtx.sepolia.publicClient, wallet: employerWallet },
  });

  podCtx.podTwoWayFees = await estimateGas(podCtx.contracts.inboxSepolia);

  if (isSimCotiBackend()) {
    await registerUserOnSim(cotiViem as never, portalAddress, simAesKeyForAddress(portalAddress));
  } else {
    await registerUserOnSim(sepoliaViem as never, portalAddress, simAesKeyForAddress(portalAddress));
  }

  return {
    base: podCtx,
    pod,
    podAsCoti,
    podAsBob: podAsCoti,
    podCotiMother,
    owner,
    bob: { address: owner, userKey: podCtx.crypto.userKey, wallet: podCtx.crypto.cotiEncryptWallet as never },
    portal,
    underlying,
    employerWallet,
  };
}

/** One-time corporate treasury seed (portal → employer pToken balance). */
export const CORPORATE_TREASURY_SEED = 50_000_000n;

/** Fund corporate treasury via Privacy Portal (test infra only — payroll contracts never touch portal). */
export async function seedCorporateTreasury(
  ctx: PayrollPortalContext,
  treasury: Address,
  amount: bigint = CORPORATE_TREASURY_SEED
): Promise<void> {
  await portalDepositTo(ctx, treasury, amount, `treasury-seed-${treasury.slice(0, 10)}`);
}
/** Portal deposit underlying → mint pToken for `recipient`, with full inbox round-trip. */
export async function portalDepositTo(
  ctx: PayrollPortalContext,
  recipient: Address,
  amount: bigint,
  label: string
): Promise<void> {
  const fees = ctx.base.podTwoWayFees;
  await ctx.underlying.write.mint([ctx.owner, amount], { account: ctx.owner });
  await ctx.underlying.write.approve([ctx.portal.address, amount], { account: ctx.owner });
  const hash = await ctx.portal.write.deposit(
    [recipient, amount, 0n, fees.callbackFeeWei],
    { account: ctx.owner, ...podTwoWayWriteOptions(fees) }
  );
  await ctx.base.sepolia.publicClient.waitForTransactionReceipt({ hash, ...receiptWaitOptions });
  await runCrossChainTwoWayRoundTrip(ctx.base, label, { gas: getDefaultCotiMineGasPodToken() });
}
