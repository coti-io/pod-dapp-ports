import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { createWalletClient, custom, bytesToHex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { ONBOARD_CONTRACT_ADDRESS } from "@coti-io/coti-ethers";
import {
  fundContractForInboxFees,
  setupContext,
  normalizePrivateKey,
  onboardUser,
  podTwoWayWriteOptions,
  receiptWaitOptions,
  requireEnv,
  runCrossChainTwoWayRoundTrip,
  DEFAULT_COTI_MINE_GAS_MPC_256,
} from "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";
import { connectDualChainForTests, registerUserOnSim, onboardSimUser, isSimCotiBackend } from "../../../../pod-ecosystem-integration/test/sim-coti/sim-coti-utils.js";
import {
  completePodOpRoundTrip,
  getDefaultCotiMineGasPodToken,
  syncPodBalancesRoundTrip,
} from "../../../../pod-ecosystem-integration/test/tokens/test-token-utils.js";
import { buildSablierTree, setPodMerkleContext, takeTreeByRoot, type ClaimPackage, type SablierMerkleTree } from "./merkle.js";
import { spLog } from "./utils.js";
import { PodPayrollBackendImpl } from "./pod-backend.js";
import { patchSablierDeploy, wrapCampaignFacade, type CampaignContract } from "./campaign-facade.js";
import { setupPayrollPortal, seedCorporateTreasury, portalDepositTo, type PayrollPortalContext } from "./portal-setup.js";
import { createPayrollTokenAdapter, type StoryToken } from "./pod-token-adapter.js";
import { prepareE2eReuseEnv, readE2eCache, writeE2eCache } from "./e2e-cache.js";
import { clampPayrollGasPrice, quotePayrollInboxFees } from "./payroll-fees.js";

export type Account = {
  address: Address;
  wallet: WalletClient;
  label: string;
};

/** Shared inbox + PP + pToken + payroll stack (PEI `setupContext` + portal + app contracts). */
export type PayrollInfra = {
  backend: "sim" | "testnet";
  sourceChainId: number;
  cotiChainId: number;
  inboxSource: Address;
  inboxCoti: Address;
  mpcExecutor: Address;
  portal: Address;
  underlying: Address;
  pToken: Address;
  payrollVault: Address;
  claimStore: Address;
  campaignFactory: Address;
  privatePayrollCoti: Address;
  portalCtx: PayrollPortalContext;
};

export type SablierPayrollScenario = {
  viem: Awaited<ReturnType<typeof connectDualChainForTests>>["sepoliaViem"];
  publicClient: PublicClient;
  employer: Account;
  employees: Account[];
  alice: Account;
  bob: Account;
  carol: Account;
  admin: Account;
  token: StoryToken;
  comptroller: { address: Address; read: Record<string, (...args: unknown[]) => Promise<unknown>>; write: Record<string, (...args: unknown[]) => Promise<Hex>> };
  campaign: CampaignContract;
  merkle: typeof buildSablierTree;
  freshCampaign: (opts: FreshCampaignOpts) => Promise<{
    tree: SablierMerkleTree;
    campaign: SablierPayrollScenario["campaign"];
    fundAmount: bigint;
  }>;
  podBackend: PodPayrollBackendImpl;
  /** Full dual-chain stack — use in system e2e assertions. */
  infra: PayrollInfra;
  /** Extra portal deposit into any recipient (employer treasury already seeded). */
  portalDeposit: (recipient: Address, amount: bigint, label?: string) => Promise<void>;
};

export type FreshCampaignOpts = {
  roster: { recipient: Address; amount: bigint }[];
  fundAmount?: bigint;
  campaignStartTime?: number;
  expiration?: number;
  minFeeUSD?: bigint;
};

const FACADE_PATH =
  "contracts/sablier-payroll-pod/avax/PayrollCampaignFacade.sol:PayrollCampaignFacade";

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";

function collectHardhatPrivateKeys(): Hex[] {
  const raw = [
    process.env.PRIVATE_KEY?.trim(),
    process.env.COTI_TESTNET_PRIVATE_KEY?.trim(),
    process.env._PRIVATE_KEY?.trim(),
    process.env.PRIVATE_KEY_ACCOUNT_2?.trim(),
    process.env.SEPOLIA_PRIVATE_KEY?.trim(),
  ].filter((k): k is string => !!k);
  const seen = new Set<string>();
  const out: Hex[] = [];
  for (const key of raw) {
    const normalized = (key.startsWith("0x") ? key : `0x${key}`).toLowerCase() as Hex;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  if (out.length > 0) return out;
  return Array.from({ length: 20 }, (_, i) => {
    const account = mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: i });
    return bytesToHex(account.getHdKey().privateKey!) as Hex;
  });
}

function mnemonicPrivateKey(index: number): Hex {
  const account = mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index });
  return bytesToHex(account.getHdKey().privateKey!) as Hex;
}

function privateKeyForAddress(address: Address): Hex {
  const fromEnv = collectHardhatPrivateKeys().find(
    (k) => privateKeyToAccount(k).address.toLowerCase() === address.toLowerCase()
  );
  if (fromEnv) return fromEnv;
  for (let i = 0; i < 20; i++) {
    const pk = mnemonicPrivateKey(i);
    if (privateKeyToAccount(pk).address.toLowerCase() === address.toLowerCase()) {
      return pk;
    }
  }
  throw new Error(`no private key for ${address}`);
}

async function walletForMnemonicIndex(
  publicClient: PublicClient,
  funder: WalletClient,
  index: number
): Promise<WalletClient> {
  const account = mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index });
  await funder.sendTransaction({ to: account.address, value: 2n * 10n ** 18n });
  return createWalletClient({
    account,
    chain: publicClient.chain,
    transport: custom({ request: (args) => publicClient.request(args) }),
  });
}

async function onboardByAddress(
  sepoliaViem: Awaited<ReturnType<typeof connectDualChainForTests>>["sepoliaViem"],
  cotiViem: Awaited<ReturnType<typeof connectDualChainForTests>>["cotiViem"],
  address: Address,
  userKeys: Map<string, string>,
  cotiFunderWallet: WalletClient
): Promise<void> {
  const lower = address.toLowerCase();
  const pk = privateKeyForAddress(address);
  if (!userKeys.has(lower)) {
    const inEnv = collectHardhatPrivateKeys().some(
      (k) => privateKeyToAccount(k).address.toLowerCase() === lower
    );
    if (!inEnv) {
      // Live COTI: only need a small gas stipend for AccountOnboard (2 COTI drained the faucet key).
      const topUp = isSimCotiBackend() ? 2n * 10n ** 18n : 5n * 10n ** 16n; // 0.05 COTI on testnet
      await cotiFunderWallet.sendTransaction({ to: address, value: topUp });
    }
    if (isSimCotiBackend()) {
      // COTI-only registration — AVAX surrogate must stay without 0x64 (matches live Fuji).
      const { userKey } = await onboardSimUser(cotiViem, pk);
      userKeys.set(lower, userKey);
    } else {
      const rpcUrl = requireEnv("COTI_TESTNET_RPC_URL");
      const onboardAddress = process.env.COTI_ONBOARD_CONTRACT_ADDRESS || ONBOARD_CONTRACT_ADDRESS;
      const keyEnv = `COTI_AES_KEY_${lower.slice(2, 10).toUpperCase()}`;
      const userKey = await onboardUser(pk, rpcUrl, onboardAddress, keyEnv);
      userKeys.set(lower, userKey);
    }
  } else if (isSimCotiBackend()) {
    await registerUserOnSim(cotiViem, address, userKeys.get(lower)!);
  }
}

export async function createSablierPayrollScenario(): Promise<SablierPayrollScenario> {
  const nets = await connectDualChainForTests();
  const { sepoliaViem, cotiViem } = nets;

  // Prefer dedicated COTI key (funded) over Hardhat PRIVATE_KEY when both are set.
  // On sim, never use COTI_TESTNET_PRIVATE_KEY from PEI .env — mother Ownable must match Hardhat #0.
  const cotiPk = normalizePrivateKey(
    isSimCotiBackend()
      ? process.env.PRIVATE_KEY?.trim() ||
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
      : process.env.COTI_TESTNET_PRIVATE_KEY?.trim() ||
          process.env._PRIVATE_KEY?.trim() ||
          process.env.PRIVATE_KEY?.trim() ||
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  ) as Hex;
  const cotiOwner = privateKeyToAccount(cotiPk).address;

  if (!isSimCotiBackend()) {
    await prepareE2eReuseEnv({
      cotiRpcUrl: requireEnv("COTI_TESTNET_RPC_URL"),
      cotiOwner,
    });
  }

  // Never inject 0x64 on the AVAX/Fuji surrogate — that masked the live fund/claim bug.
  // simCoti precompile lives only on the COTI network (connectDualChainForTests / initSimCoti).
  const publicClient = await sepoliaViem.getPublicClient();
  const podCtx = await setupContext({ sepoliaViem, cotiViem });

  setPodMerkleContext({ userKey: podCtx.crypto.userKey });

  const wallets = await sepoliaViem.getWalletClients();
  const employerWallet = wallets[0];
  const aliceWallet = wallets[1] ?? wallets[0];
  const bobWallet = wallets[2] ?? wallets[0];
  const carolWallet =
    wallets[3] ?? (await walletForMnemonicIndex(publicClient, employerWallet, 3));
  if (!wallets[3]) {
    await publicClient.request({
      method: "hardhat_impersonateAccount",
      params: [carolWallet.account.address],
    } as never);
  }
  const adminWallet = wallets[0];

  const employer: Account = { address: employerWallet.account.address, wallet: employerWallet, label: "employer" };
  const alice: Account = { address: aliceWallet.account.address, wallet: aliceWallet, label: "alice" };
  const bob: Account = { address: bobWallet.account.address, wallet: bobWallet, label: "bob" };
  const carol: Account = { address: carolWallet.account.address, wallet: carolWallet, label: "carol" };
  const admin: Account = { address: adminWallet.account.address, wallet: adminWallet, label: "admin" };

  const comptroller = await sepoliaViem.deployContract(
    "contracts/sablier-payroll-pod/mocks/MockSablierComptroller.sol:MockSablierComptroller",
    [0n]
  );

  const motherReuse = !isSimCotiBackend() ? readE2eCache()?.podCotiMother : undefined;

  const portalCtx = await setupPayrollPortal({
    sepoliaViem,
    cotiViem: cotiViem as never,
    podCtx,
    cotiOwnerPk: cotiPk,
    reuseMotherAddress: motherReuse,
  });

  if (!isSimCotiBackend()) {
    writeE2eCache({
      cotiOwner,
      inboxCoti: podCtx.contracts.inboxCoti.address as Address,
      mpcExecutor: podCtx.contracts.mpcExecutor.address as Address,
      podCotiMother: portalCtx.podCotiMother.address as Address,
    });
  }
  const userKeys = new Map<string, string>();
  userKeys.set(cotiOwner.toLowerCase(), podCtx.crypto.userKey);
  if (isSimCotiBackend()) {
    await registerUserOnSim(cotiViem, cotiOwner, podCtx.crypto.userKey);
  }

  const cotiPayroll = await cotiViem.deployContract(
    "contracts/sablier-payroll-pod/coti/PrivatePayrollCoti.sol:PrivatePayrollCoti",
    [podCtx.contracts.inboxCoti.address, cotiOwner],
    {
      client: { public: podCtx.coti.publicClient, wallet: podCtx.coti.wallet },
    } as never
  );
  // Live COTI: wait for deploy inclusion before registerRun/leaf.
  if (!isSimCotiBackend() && typeof cotiPayroll === "object" && cotiPayroll && "address" in cotiPayroll) {
    // hardhat-viem deployContract already waits; keep an explicit code check for flaky RPCs.
    const code = await podCtx.coti.publicClient.getCode({ address: cotiPayroll.address as Address });
    if (!code || code === "0x") {
      throw new Error(`PrivatePayrollCoti deploy missing code at ${cotiPayroll.address}`);
    }
  }

  const payrollVault = await sepoliaViem.deployContract(
    "contracts/sablier-payroll-pod/avax/PayrollVault.sol:PayrollVault",
    [podCtx.contracts.inboxSepolia.address, cotiPayroll.address]
  );

  const claimStore = await sepoliaViem.deployContract(
    "contracts/sablier-payroll-pod/avax/PodClaimStore.sol:PodClaimStore",
    []
  );

  await fundContractForInboxFees(adminWallet, publicClient, payrollVault.address as Address, 5n * 10n ** 18n);

  await payrollVault.write.configure(
    ["0x0000000000000000000000000000000000000000", podCtx.contracts.mpcExecutor.address, podCtx.chainIds.coti],
    { account: admin.address }
  );

  const campaignFactory = await sepoliaViem.deployContract(
    "contracts/sablier-payroll-pod/avax/PayrollCampaignFactory.sol:PayrollCampaignFactory",
    [payrollVault.address, claimStore.address, comptroller.address]
  );
  await payrollVault.write.setCampaignFactory([campaignFactory.address], { account: admin.address });

  await onboardByAddress(sepoliaViem, cotiViem, employer.address, userKeys, podCtx.coti.wallet);
  for (const acct of [alice, bob, carol]) {
    await onboardByAddress(sepoliaViem, cotiViem, acct.address, userKeys, podCtx.coti.wallet);
  }

  await employerWallet.sendTransaction({
    to: employer.address,
    value: 10n * 10n ** 18n,
  });

  await seedCorporateTreasury(portalCtx, employer.address);

  const payrollFacades = new Set<string>();

  async function ensureFacadeTokenIdle(facade: Address, label: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const status = (await portalCtx.pod.read.balanceOfWithStatus([facade])) as readonly [
        unknown,
        boolean,
      ];
      if (!status[1]) return;
      await runCrossChainTwoWayRoundTrip(podCtx, `${label}-idle-${attempt}`, {
        gas: getDefaultCotiMineGasPodToken(),
      });
    }
  }

  let tokenAdapterRef!: ReturnType<typeof createPayrollTokenAdapter>;
  let podBackendRef!: PodPayrollBackendImpl;

  async function fundCampaignOnFacade(
    facade: Address,
    amount: bigint,
    account: Address
  ): Promise<Hex> {
    await ensureFacadeTokenIdle(facade, `prefund-${facade.slice(0, 10)}`);
    const fees = portalCtx.base.podTwoWayFees;
    // Public amount transfer — live Fuji PoD path; encrypted IT settle is unreliable.
    const hash = await portalCtx.pod.write.transfer(
      [facade, amount, fees.callbackFeeWei],
      { account, ...podTwoWayWriteOptions(fees) }
    );
    await publicClient.waitForTransactionReceipt({ hash, ...receiptWaitOptions });
    await completePodOpRoundTrip(portalCtx, `fund-${facade.slice(0, 10)}`, async () => hash);
    await syncPodBalancesRoundTrip(portalCtx, [facade, account], `fund-sync-${facade.slice(0, 10)}`);

    const facadeContract = await sepoliaViem.getContractAt(FACADE_PATH, facade);
    const gasPrice = clampPayrollGasPrice(await publicClient.getGasPrice());
    const inboxFees = await quotePayrollInboxFees(podCtx.contracts.inboxSepolia, gasPrice);
    const creditHash = await facadeContract.write.requestCreditPool(
      [amount, inboxFees.callbackFeeWei],
      {
        account: admin.address,
        value: inboxFees.totalFeeWei,
        gasPrice,
        // Hardhat eth_estimateGas under-estimates PoD two-way sends (same as podTwoWayWriteOptions).
        gas: 8_000_000n,
      }
    );
    await publicClient.waitForTransactionReceipt({ hash: creditHash, ...receiptWaitOptions });
    await runCrossChainTwoWayRoundTrip(podCtx, `credit-pool-${facade.slice(0, 10)}`, {
      gas: DEFAULT_COTI_MINE_GAS_MPC_256,
    });

    await employerWallet.sendTransaction({
      to: facade,
      value: 5n * 10n ** 18n,
    });
    return hash;
  }

  const tokenAdapter = createPayrollTokenAdapter({
    portalCtx,
    publicClient,
    userKeys,
    defaultUserKey: podCtx.crypto.userKey,
    topUpTreasury: (treasury, amount, label) => portalDepositTo(portalCtx, treasury, amount, label),
    isPayrollFacade: (facade) => payrollFacades.has(facade.toLowerCase()),
    fundCampaign: (facade, amount, account) => fundCampaignOnFacade(facade, amount, account),
  });
  tokenAdapterRef = tokenAdapter;

  const podBackend = new PodPayrollBackendImpl(
    podCtx,
    portalCtx,
    publicClient,
    cotiPayroll,
    payrollVault,
    claimStore,
    adminWallet,
    cotiPk,
    tokenAdapter,
    ensureFacadeTokenIdle
  );
  podBackendRef = podBackend;

  async function registerPodCampaign(
    facade: CampaignContract,
    tree: SablierMerkleTree,
    runId: number
  ): Promise<void> {
    // Live COTI: hardhat-viem may return before inclusion — wait explicitly or registerLeaf
    // sees "unknown run". `validateCiphertext` needs multi-million gas; eth_estimateGas often
    // underestimates and the tx OOGs with no LeafRegistered (claim then raises errorCode=4).
    const cotiWriteGas = isSimCotiBackend()
      ? undefined
      : BigInt(process.env.COTI_REGISTER_LEAF_GAS?.trim() || "8000000");
    const cotiGasOpts = cotiWriteGas !== undefined ? { gas: cotiWriteGas } : {};

    const runHash = await cotiPayroll.write.registerRun([BigInt(runId), tree.root], {
      account: cotiOwner,
      ...cotiGasOpts,
      client: { public: podCtx.coti.publicClient, wallet: podCtx.coti.wallet },
    } as never);
    const runReceipt = await podCtx.coti.publicClient.waitForTransactionReceipt({
      hash: runHash as Hex,
      ...receiptWaitOptions,
    });
    if (runReceipt.status !== "success") {
      throw new Error(`registerRun reverted runId=${runId} tx=${runHash}`);
    }

    for (const pkg of tree.packages) {
      const itAmount = await podBackend.buildItAmount(pkg.amount, "register");
      const leafHash = await cotiPayroll.write.registerLeaf(
        [BigInt(runId), BigInt(pkg.index), pkg.recipient, pkg.amountCommitment!, itAmount],
        {
          account: cotiOwner,
          ...cotiGasOpts,
          client: { public: podCtx.coti.publicClient, wallet: podCtx.coti.wallet },
        } as never
      );
      const leafReceipt = await podCtx.coti.publicClient.waitForTransactionReceipt({
        hash: leafHash as Hex,
        ...receiptWaitOptions,
      });
      if (leafReceipt.status !== "success") {
        throw new Error(
          `registerLeaf reverted runId=${runId} index=${pkg.index} employee=${pkg.recipient} tx=${leafHash}`
        );
      }
      await facade.write.registerLeaf(
        [BigInt(pkg.index), pkg.recipient, pkg.amountCommitment!],
        { account: admin.address }
      );
    }
  }

  async function registerFacadeOnChains(facadeAddress: Address, userKey: string): Promise<void> {
    // Thin facade: no local MpcCore. Keep AES key map for balance decrypt only; do not
    // register on AVAX sim (live Fuji has no 0x64).
    if (isSimCotiBackend()) {
      await registerUserOnSim(cotiViem, facadeAddress, userKey);
    }
    userKeys.set(facadeAddress.toLowerCase(), userKey);
  }

  async function fundFacade(facade: CampaignContract, amount: bigint): Promise<void> {
    await registerFacadeOnChains(facade.address, podCtx.crypto.userKey);
    payrollFacades.add(facade.address.toLowerCase());
    await tokenAdapter.token.write.transfer([facade.address, amount], {
      account: employer.address,
    });
  }

  async function deployFacadeHarness(args: unknown[]): Promise<CampaignContract> {
    const [
      adminAddr,
      _comptrollerAddr,
      merkleRoot,
      tokenAddr,
      campaignStartTime,
      expiration,
      campaignName,
      minFeeUSD,
    ] = args as [Address, Address, Hex, Address, number, number, string, bigint];

    const runIdBefore = Number(await payrollVault.read.nextRunId());
    const countBefore = Number(await campaignFactory.read.campaignCount());

    await campaignFactory.write.createCampaign(
      [
        adminAddr,
        merkleRoot,
        tokenAddr,
        campaignStartTime,
        expiration,
        campaignName,
        minFeeUSD,
      ],
      { account: admin.address }
    );

    const facadeAddr = (await campaignFactory.read.campaigns([BigInt(countBefore)])) as Address;
    const actualRunId = runIdBefore;
    const facade = await sepoliaViem.getContractAt(FACADE_PATH, facadeAddr);

    const tree = takeTreeByRoot(merkleRoot);
    if (tree) {
      await registerPodCampaign(facade as CampaignContract, tree, actualRunId);
    }

    await registerFacadeOnChains(facade.address, podCtx.crypto.userKey);
    payrollFacades.add(facade.address.toLowerCase());

    return facade as CampaignContract;
  }

  patchSablierDeploy(sepoliaViem, podBackend, async (args) => {
    const raw = await deployFacadeHarness(args);
    return wrapCampaignFacade(raw, podBackend);
  });

  async function freshCampaign(opts: FreshCampaignOpts) {
    const rosterEntries = opts.roster.map((r, i) => ({
      index: i,
      recipient: r.recipient,
      amount: r.amount,
    }));
    const tree = buildSablierTree(rosterEntries);
    const now = Number((await publicClient.getBlock()).timestamp);
    const campaignStartTime = opts.campaignStartTime ?? now - 60;
    const expiration = opts.expiration ?? 0;
    const minFeeUSD = opts.minFeeUSD ?? 0n;
    const fundAmount = opts.fundAmount ?? rosterEntries.reduce((s, e) => s + e.amount, 0n);

    const rawFacade = await deployFacadeHarness([
      admin.address,
      comptroller.address,
      tree.root,
      tokenAdapter.token.address,
      campaignStartTime,
      expiration,
      "Q1 Payroll",
      minFeeUSD,
    ]);

    const campaign = wrapCampaignFacade(rawFacade, podBackend);

    await fundFacade(campaign, fundAmount);

    spLog(`campaign=${campaign.address} root=${tree.root} funded=${fundAmount} from treasury`);
    return { tree, campaign, fundAmount };
  }

  const placeholderRaw = await deployFacadeHarness([
    admin.address,
    comptroller.address,
    `0x${"00".repeat(32)}` as Hex,
    tokenAdapter.token.address,
    0,
    0,
    "placeholder",
    0n,
  ]);
  const placeholder = wrapCampaignFacade(placeholderRaw, podBackend);

  const backend = isSimCotiBackend() ? "sim" : "testnet";
  spLog(
    `deployed backend=${backend} pToken=${tokenAdapter.token.address} portal=${portalCtx.portal.address} vault=${payrollVault.address}`
  );

  const infra: PayrollInfra = {
    backend,
    sourceChainId: Number(podCtx.chainIds.sepolia),
    cotiChainId: Number(podCtx.chainIds.coti),
    inboxSource: podCtx.contracts.inboxSepolia.address as Address,
    inboxCoti: podCtx.contracts.inboxCoti.address as Address,
    mpcExecutor: podCtx.contracts.mpcExecutor.address as Address,
    portal: portalCtx.portal.address,
    underlying: portalCtx.underlying.address,
    pToken: portalCtx.pod.address as Address,
    payrollVault: payrollVault.address as Address,
    claimStore: claimStore.address as Address,
    campaignFactory: campaignFactory.address as Address,
    privatePayrollCoti: cotiPayroll.address as Address,
    portalCtx,
  };

  return {
    viem: sepoliaViem,
    publicClient,
    employer,
    employees: [alice, bob, carol],
    alice,
    bob,
    carol,
    admin,
    token: tokenAdapter.token,
    comptroller,
    campaign: placeholder,
    merkle: buildSablierTree,
    freshCampaign,
    podBackend,
    infra,
    portalDeposit: (recipient, amount, label = `portal-topup-${recipient.slice(0, 10)}`) =>
      portalDepositTo(portalCtx, recipient, amount, label),
  };
}

export type { ClaimPackage, SablierMerkleTree };
