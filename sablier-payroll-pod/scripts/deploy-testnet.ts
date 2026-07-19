/**
 * Deploy Sablier payroll PoD stack for testnet E2E (Hardhat surrogate + live COTI).
 * Writes deployments/testnet-payroll.json for optional contract reuse in tests.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { privateKeyToAccount } from "viem/accounts";
import { connectDualChainForTests } from "../../../pod-ecosystem-integration/test/sim-coti/sim-coti-utils.js";
import {
  estimateGas,
  fundContractForInboxFees,
  normalizePrivateKey,
  setupContext,
} from "../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";
import { setupPayrollPortal } from "../test/lib/portal-setup.js";

const pkgRoot = path.dirname(fileURLToPath(import.meta.url));
const deploymentsPath = path.resolve(pkgRoot, "../deployments/testnet-payroll.json");

const COTI_CHAIN_ID = 7082400;
const SOURCE_CHAIN_ID = Number(process.env.HARDHAT_CHAIN_ID || "31337");

const padFee = (x: bigint) => x + x / 5n + 1n;

const main = async () => {
  process.env.COTI_BACKEND = "testnet";

  const nets = await connectDualChainForTests();
  const podCtx = await setupContext({ sepoliaViem: nets.sepoliaViem, cotiViem: nets.cotiViem });

  const cotiPk = normalizePrivateKey(
    process.env.COTI_TESTNET_PRIVATE_KEY?.trim() ||
      process.env._PRIVATE_KEY?.trim() ||
      process.env.PRIVATE_KEY?.trim() ||
      (() => {
        throw new Error("Missing COTI testnet private key");
      })()
  );
  const cotiOwner = privateKeyToAccount(cotiPk as `0x${string}`).address;

  const portalCtx = await setupPayrollPortal({
    sepoliaViem: nets.sepoliaViem,
    cotiViem: nets.cotiViem,
    podCtx,
    cotiOwnerPk: cotiPk as `0x${string}`,
  });

  const cotiPayroll = await nets.cotiViem.deployContract(
    "contracts/sablier-payroll-pod/coti/PrivatePayrollCoti.sol:PrivatePayrollCoti",
    [podCtx.contracts.inboxCoti.address, cotiOwner],
    { client: { public: podCtx.coti.publicClient, wallet: podCtx.coti.wallet } } as never
  );

  const payrollVault = await nets.sepoliaViem.deployContract(
    "contracts/sablier-payroll-pod/avax/PayrollVault.sol:PayrollVault",
    [podCtx.contracts.inboxSepolia.address, cotiPayroll.address]
  );

  const claimStore = await nets.sepoliaViem.deployContract(
    "contracts/sablier-payroll-pod/avax/PodClaimStore.sol:PodClaimStore",
    []
  );

  const wallets = await nets.sepoliaViem.getWalletClients();
  const adminWallet = wallets[0];
  const publicClient = await nets.sepoliaViem.getPublicClient();

  await fundContractForInboxFees(adminWallet, publicClient, payrollVault.address, 5n * 10n ** 18n);

  const gasPrice = await publicClient.getGasPrice();
  const [payrollTargetWei, payrollCallerWei] = (await podCtx.contracts.inboxSepolia.read.calculateTwoWayFeeRequiredInLocalToken([
    4096n,
    4096n,
    600_000n,
    600_000n,
    gasPrice,
  ])) as [bigint, bigint];
  const callbackFeeWei = padFee(payrollCallerWei);
  const inboxFeeWei = padFee(payrollTargetWei + payrollCallerWei);

  await payrollVault.write.setInboxFees([inboxFeeWei, callbackFeeWei], { account: adminWallet.account.address });
  await payrollVault.write.configure(
    [`0x0000000000000000000000000000000000000000`, podCtx.contracts.mpcExecutor.address, podCtx.chainIds.coti],
    { account: adminWallet.account.address }
  );

  const comptroller = await nets.sepoliaViem.deployContract(
    "contracts/sablier-payroll-pod/mocks/MockSablierComptroller.sol:MockSablierComptroller",
    [0n]
  );

  const pTokenFees = await estimateGas(podCtx.contracts.inboxSepolia);
  const pTokenTransferFeeWei = padFee(pTokenFees.totalValueWei);
  const pTokenCallbackFeeWei = padFee(pTokenFees.callbackFeeWei);

  const campaignFactory = await nets.sepoliaViem.deployContract(
    "contracts/sablier-payroll-pod/avax/PayrollCampaignFactory.sol:PayrollCampaignFactory",
    [
      payrollVault.address,
      claimStore.address,
      comptroller.address,
      callbackFeeWei,
      inboxFeeWei,
      pTokenTransferFeeWei,
      pTokenCallbackFeeWei,
    ]
  );
  await payrollVault.write.setCampaignFactory([campaignFactory.address], {
    account: adminWallet.account.address,
  });

  const payload = {
    updatedAt: new Date().toISOString(),
    mode: "testnet-harness",
    sourceChainId: SOURCE_CHAIN_ID,
    cotiChainId: COTI_CHAIN_ID,
    inboxSepolia: podCtx.contracts.inboxSepolia.address,
    inboxCoti: podCtx.contracts.inboxCoti.address,
    mpcExecutor: podCtx.contracts.mpcExecutor.address,
    privatePayrollCoti: cotiPayroll.address,
    payrollVault: payrollVault.address,
    payrollClaimStore: claimStore.address,
    payrollCampaignFactory: campaignFactory.address,
    mockComptroller: comptroller.address,
    pToken: portalCtx.pod.address,
    portal: portalCtx.portal.address,
    podCotiMother: portalCtx.podCotiMother.address,
    owner: cotiOwner,
    inboxFeeWei: inboxFeeWei.toString(),
    callbackFeeWei: callbackFeeWei.toString(),
  };

  await fs.mkdir(path.dirname(deploymentsPath), { recursive: true });
  await fs.writeFile(deploymentsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log("[deploy-testnet] Payroll stack deployed:");
  console.log(JSON.stringify(payload, null, 2));
  console.log(`[deploy-testnet] Wrote ${deploymentsPath}`);
};

main().catch((err) => {
  console.error("[deploy-testnet] Failed:", err);
  process.exitCode = 1;
});
