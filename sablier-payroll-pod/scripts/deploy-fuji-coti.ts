/**
 * Deploy the full PoD payroll stack on **Avalanche Fuji + COTI testnet**,
 * wired to the **live canonical Inbox** pair from `pod-ecosystem-integration/deployConfig.json`.
 *
 * Architecture (iteration 08 — thin Fuji facade, encrypted pool on COTI):
 *   Fuji:  PayrollVault + PodClaimStore + PayrollCampaignFactory (+ optional template facade)
 *   COTI:  PrivatePayrollCoti (creditPool / verifyAndCredit / clawbackPool)
 *   Inbox: live Fuji inbox ↔ live COTI inbox (does NOT deploy Inbox / MpcExecutor / Portal)
 *
 * Usage:
 *   npm run deploy:fuji-coti                 # compile + deploy
 *   PREFLIGHT_ONLY=1 npm run deploy:fuji-coti  # validate RPCs / inboxes / balances only
 *   SKIP_TEMPLATE_CAMPAIGN=1 ...             # factory only (no empty merkle facade)
 *   FORCE_REDEPLOY_PAYROLL=0 ...             # allow reuse of PRIVATE_PAYROLL_COTI / vault env addrs
 *
 * Env (PEI `.env` or port `.env`):
 *   AVALANCHE_FUJI_PRIVATE_KEY (or PRIVATE_KEY), COTI_TESTNET_PRIVATE_KEY
 *   AVALANCHE_FUJI_RPC_URL (optional), COTI_TESTNET_RPC_URL
 *   Optional: SOURCE_INBOX, COTI_INBOX, COTI_MPC_EXECUTOR_ADDRESS, PAYROLL_PTOKEN_ADDRESS
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  asAddress,
  getChainConfig,
  getViemClients,
} from "../../../pod-ecosystem-integration/scripts/deploy-utils.js";
import {
  estimateGas,
  fundContractForInboxFees,
  normalizePrivateKey,
} from "../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";

const pkgRoot = path.dirname(fileURLToPath(import.meta.url));
const portRoot = path.resolve(pkgRoot, "..");
const peiRoot = path.resolve(portRoot, "../../pod-ecosystem-integration");
const deployConfigPath = path.resolve(peiRoot, "deployConfig.json");
const deploymentsDir = path.resolve(portRoot, "deployments");
const productionPath = path.resolve(deploymentsDir, "production-payroll-avalancheFuji.json");

const SOURCE_NETWORK = "avalancheFuji";
const COTI_NETWORK = process.env.COTI_NETWORK ?? "cotiTestnet";
const FUJI_CHAIN_ID = 43113;
const COTI_CHAIN_ID = Number(process.env.COTI_TESTNET_CHAIN_ID || "7082400");

const PREFLIGHT_ONLY = process.env.PREFLIGHT_ONLY === "1";
const SKIP_TEMPLATE_CAMPAIGN = process.env.SKIP_TEMPLATE_CAMPAIGN === "1";
/** Default: always fresh-deploy payroll contracts (old Fuji facades call 0x64; old COTI lacks creditPool). */
const FORCE_REDEPLOY = process.env.FORCE_REDEPLOY_PAYROLL !== "0";

const ARCHITECTURE = "iter08-thin-fuji-facade";

const padFee = (x: bigint) => x + x / 5n + 1n;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const envAddress = (key: string): Address | undefined => {
  const v = process.env[key]?.trim();
  return v ? (asAddress(v, key) as Address) : undefined;
};

const readPeiDeployConfig = async () => {
  const raw = await fs.readFile(deployConfigPath, "utf8");
  return JSON.parse(raw) as { chains?: Record<string, Record<string, any>> };
};

/** Fund vault/facade with available balance, keeping a gas reserve. */
async function fundAffordable(
  wallet: {
    account: { address: Address };
    sendTransaction: (...args: any[]) => Promise<Hex>;
  },
  publicClient: {
    getBalance: (args: { address: Address }) => Promise<bigint>;
    waitForTransactionReceipt: (...args: any[]) => Promise<unknown>;
  },
  to: Address,
  preferredWei: bigint,
  label: string
): Promise<bigint> {
  const bal = await publicClient.getBalance({ address: wallet.account.address });
  const gasReserve = 50n * 10n ** 15n; // 0.05 AVAX
  const maxAffordable = bal > gasReserve ? bal - gasReserve : 0n;
  const amount = preferredWei < maxAffordable ? preferredWei : maxAffordable;
  if (amount === 0n) {
    console.log(`[deploy-fuji-coti] skip fund ${label}: balance too low (${bal} wei)`);
    return 0n;
  }
  console.log(`[deploy-fuji-coti] fund ${label} with ${amount} wei (preferred ${preferredWei})`);
  await fundContractForInboxFees(wallet, publicClient, to, amount);
  return amount;
}

async function requireContractCode(
  label: string,
  rpcUrl: string,
  address: Address
): Promise<void> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    throw new Error(`[preflight] ${label} has no code at ${address} (rpc=${rpcUrl})`);
  }
  console.log(`[preflight] ${label} OK (${address}, code=${code.length} chars)`);
}

async function preflight(params: {
  fujiRpc: string;
  cotiRpc: string;
  inboxFuji: Address;
  inboxCoti: Address;
  mpcExecutor: Address;
  pToken: Address;
  fujiDeployer: Address;
  cotiDeployer: Address;
}): Promise<void> {
  console.log("[preflight] Checking live Fuji + COTI inboxes and balances…");
  await requireContractCode("Fuji Inbox", params.fujiRpc, params.inboxFuji);
  await requireContractCode("COTI Inbox", params.cotiRpc, params.inboxCoti);
  await requireContractCode("MpcExecutor", params.cotiRpc, params.mpcExecutor);
  await requireContractCode("pToken (Fuji)", params.fujiRpc, params.pToken);

  const fuji = createPublicClient({ transport: http(params.fujiRpc) });
  const coti = createPublicClient({ transport: http(params.cotiRpc) });
  const fujiBal = await fuji.getBalance({ address: params.fujiDeployer });
  const cotiBal = await coti.getBalance({ address: params.cotiDeployer });
  console.log(`[preflight] Fuji deployer ${params.fujiDeployer} balance=${fujiBal} wei`);
  console.log(`[preflight] COTI deployer ${params.cotiDeployer} balance=${cotiBal} wei`);
  if (fujiBal < 10n ** 16n) {
    console.warn("[preflight] WARNING: Fuji deployer < 0.01 AVAX — fund before deploy");
  }
  if (cotiBal < 10n ** 16n) {
    console.warn("[preflight] WARNING: COTI deployer < 0.01 COTI — use Discord faucet");
  }
  console.log("[preflight] Live inbox pair ready for payroll wiring");
}

const main = async () => {
  const deployConfig = await readPeiDeployConfig();
  const sourceCfg = getChainConfig(deployConfig as any, FUJI_CHAIN_ID, SOURCE_NETWORK);
  const cotiCfg = getChainConfig(deployConfig as any, COTI_CHAIN_ID, COTI_NETWORK);

  const fujiRpc =
    process.env.AVALANCHE_FUJI_RPC_URL?.trim() ||
    "https://avalanche-fuji-c-chain-rpc.publicnode.com";
  const cotiRpc = process.env.COTI_TESTNET_RPC_URL?.trim();
  if (!cotiRpc) {
    throw new Error("Missing COTI_TESTNET_RPC_URL");
  }

  const inboxFuji = asAddress(
    process.env.SOURCE_INBOX?.trim() || sourceCfg.inbox?.trim() || "",
    "SOURCE_INBOX / deployConfig[43113].inbox"
  ) as Address;
  const inboxCoti = asAddress(
    process.env.COTI_INBOX?.trim() || process.env.INBOX?.trim() || cotiCfg.inbox?.trim() || "",
    "COTI_INBOX / deployConfig[7082400].inbox"
  ) as Address;
  const mpcExecutor = asAddress(
    process.env.COTI_MPC_EXECUTOR_ADDRESS?.trim() || cotiCfg.cotiExecutor?.trim() || "",
    "COTI_MPC_EXECUTOR_ADDRESS / deployConfig cotiExecutor"
  ) as Address;

  const pTokenFromEnv = process.env.PAYROLL_PTOKEN_ADDRESS?.trim();
  const portalTokens = sourceCfg.privacyPortalTokens ?? {};
  const preferredKey = (process.env.PAYROLL_PTOKEN_KEY?.trim() || "pMTT") as string;
  const tokenKeys = [preferredKey, "pMTT", "pUSDC", "pWAVAX", ...Object.keys(portalTokens)];
  let pTokenKey = preferredKey;
  let pTokenFromConfig = "";
  for (const key of tokenKeys) {
    const addr = portalTokens[key]?.pToken?.trim();
    if (addr) {
      pTokenKey = key;
      pTokenFromConfig = addr;
      break;
    }
  }
  const pTokenAddress = asAddress(
    pTokenFromEnv || pTokenFromConfig,
    "PAYROLL_PTOKEN_ADDRESS / privacyPortalTokens.pMTT"
  ) as Address;

  const fujiPk = normalizePrivateKey(
    process.env.AVALANCHE_FUJI_PRIVATE_KEY?.trim() ||
      process.env.PRIVATE_KEY?.trim() ||
      (() => {
        throw new Error("Missing AVALANCHE_FUJI_PRIVATE_KEY or PRIVATE_KEY");
      })()
  );
  const cotiPk = normalizePrivateKey(
    process.env.COTI_TESTNET_PRIVATE_KEY?.trim() ||
      process.env._PRIVATE_KEY?.trim() ||
      process.env.PRIVATE_KEY?.trim() ||
      (() => {
        throw new Error("Missing COTI_TESTNET_PRIVATE_KEY");
      })()
  );
  const fujiDeployer = privateKeyToAccount(fujiPk as Hex).address;
  const cotiOwner = privateKeyToAccount(cotiPk as Hex).address;

  console.log(`[deploy-fuji-coti] architecture=${ARCHITECTURE}`);
  console.log(`[deploy-fuji-coti] Fuji=${FUJI_CHAIN_ID} COTI=${COTI_CHAIN_ID}`);
  console.log(`[deploy-fuji-coti] inbox Fuji=${inboxFuji} COTI=${inboxCoti}`);
  console.log(`[deploy-fuji-coti] MpcExecutor=${mpcExecutor}`);
  console.log(`[deploy-fuji-coti] pToken key=${pTokenFromEnv ? "env" : pTokenKey} ${pTokenAddress}`);
  console.log(`[deploy-fuji-coti] FORCE_REDEPLOY=${FORCE_REDEPLOY} SKIP_TEMPLATE=${SKIP_TEMPLATE_CAMPAIGN}`);

  await preflight({
    fujiRpc,
    cotiRpc,
    inboxFuji,
    inboxCoti,
    mpcExecutor,
    pToken: pTokenAddress,
    fujiDeployer,
    cotiDeployer: cotiOwner,
  });

  if (PREFLIGHT_ONLY) {
    console.log("[deploy-fuji-coti] PREFLIGHT_ONLY=1 — exiting before deploy");
    return;
  }

  const sourceConn = await network.connect({ network: SOURCE_NETWORK });
  const { viem: sourceViem, provider: sourceProvider, networkName: sourceLabel } = sourceConn;
  const sourceClients = await getViemClients(sourceViem, sourceProvider, sourceLabel);

  const cotiConn = await network.connect({ network: COTI_NETWORK });
  const { viem: cotiViem, provider: cotiProvider, networkName: cotiLabel } = cotiConn;
  const cotiClients = await getViemClients(cotiViem, cotiProvider, cotiLabel);

  const reuseCoti = !FORCE_REDEPLOY ? envAddress("PRIVATE_PAYROLL_COTI") : undefined;
  const cotiPayroll = reuseCoti
    ? await cotiViem.getContractAt(
        "contracts/sablier-payroll-pod/coti/PrivatePayrollCoti.sol:PrivatePayrollCoti",
        reuseCoti,
        { client: { public: cotiClients.publicClient, wallet: cotiClients.walletClient } } as never
      )
    : await cotiViem.deployContract(
        "contracts/sablier-payroll-pod/coti/PrivatePayrollCoti.sol:PrivatePayrollCoti",
        [inboxCoti, cotiOwner],
        { client: { public: cotiClients.publicClient, wallet: cotiClients.walletClient } } as never
      );
  console.log(
    `[deploy-fuji-coti] PrivatePayrollCoti: ${cotiPayroll.address}${reuseCoti ? " (reused)" : " (fresh)"}`
  );

  const reuseVault = !FORCE_REDEPLOY ? envAddress("PAYROLL_VAULT") : undefined;
  const payrollVault = reuseVault
    ? await sourceViem.getContractAt(
        "contracts/sablier-payroll-pod/avax/PayrollVault.sol:PayrollVault",
        reuseVault
      )
    : await sourceViem.deployContract(
        "contracts/sablier-payroll-pod/avax/PayrollVault.sol:PayrollVault",
        [inboxFuji, cotiPayroll.address]
      );
  console.log(
    `[deploy-fuji-coti] PayrollVault: ${payrollVault.address}${reuseVault ? " (reused)" : " (fresh)"}`
  );

  const reuseClaim = !FORCE_REDEPLOY ? envAddress("PAYROLL_CLAIM_STORE") : undefined;
  const claimStore = reuseClaim
    ? await sourceViem.getContractAt(
        "contracts/sablier-payroll-pod/avax/PodClaimStore.sol:PodClaimStore",
        reuseClaim
      )
    : await sourceViem.deployContract(
        "contracts/sablier-payroll-pod/avax/PodClaimStore.sol:PodClaimStore",
        []
      );
  console.log(
    `[deploy-fuji-coti] PodClaimStore: ${claimStore.address}${reuseClaim ? " (reused)" : " (fresh)"}`
  );

  const reuseComptroller = !FORCE_REDEPLOY ? envAddress("PAYROLL_COMPTROLLER") : undefined;
  const comptroller = reuseComptroller
    ? await sourceViem.getContractAt(
        "contracts/sablier-payroll-pod/mocks/MockSablierComptroller.sol:MockSablierComptroller",
        reuseComptroller
      )
    : await sourceViem.deployContract(
        "contracts/sablier-payroll-pod/mocks/MockSablierComptroller.sol:MockSablierComptroller",
        [0n]
      );
  console.log(
    `[deploy-fuji-coti] Comptroller: ${comptroller.address}${reuseComptroller ? " (reused)" : " (fresh)"}`
  );

  const gasPrice = await sourceClients.publicClient.getGasPrice();
  const inboxContract = await sourceViem.getContractAt("Inbox", inboxFuji);
  const [payrollTargetWei, payrollCallerWei] = (await inboxContract.read.calculateTwoWayFeeRequiredInLocalToken([
    4096n,
    4096n,
    600_000n,
    600_000n,
    gasPrice,
  ])) as [bigint, bigint];
  const callbackFeeWei = padFee(payrollCallerWei);
  const inboxFeeWei = padFee(payrollTargetWei + payrollCallerWei);
  console.log(
    `[deploy-fuji-coti] fees inboxFeeWei=${inboxFeeWei} callbackFeeWei=${callbackFeeWei} (gasPrice=${gasPrice})`
  );

  await payrollVault.write.setInboxFees([inboxFeeWei, callbackFeeWei]);
  // Fuji public RPCs often rate-limit rapid same-wallet txs.
  await delay(8_000);
  await payrollVault.write.configure([
    `0x0000000000000000000000000000000000000000`,
    mpcExecutor,
    BigInt(COTI_CHAIN_ID),
  ]);
  await delay(3_000);

  const preferredFund = BigInt(process.env.PAYROLL_FUND_WEI?.trim() || String(2n * 10n ** 17n));
  await fundAffordable(
    sourceClients.walletClient,
    sourceClients.publicClient,
    payrollVault.address as Address,
    preferredFund,
    "PayrollVault"
  );

  const pTokenFees = await estimateGas(inboxContract);
  const pTokenTransferFeeWei = padFee(pTokenFees.totalValueWei);
  const pTokenCallbackFeeWei = padFee(pTokenFees.callbackFeeWei);

  const campaignFactory = await sourceViem.deployContract(
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
  console.log(`[deploy-fuji-coti] PayrollCampaignFactory: ${campaignFactory.address}`);
  await delay(5_000);
  await payrollVault.write.setCampaignFactory([campaignFactory.address]);
  await delay(5_000);

  let facadeAddress: Address | undefined;
  let runId: number | undefined;
  let campaignStartTime: number | undefined;
  let campaignName: string | undefined;

  if (!SKIP_TEMPLATE_CAMPAIGN) {
    const now = Math.floor(Date.now() / 1000);
    campaignStartTime = now - 60;
    campaignName = "PoD Payroll avalancheFuji";
    runId = Number(await payrollVault.read.nextRunId());
    const countBefore = Number(await campaignFactory.read.campaignCount());

    await campaignFactory.write.createCampaign([
      sourceClients.walletClient.account.address,
      `0x${"00".repeat(32)}`,
      pTokenAddress,
      campaignStartTime,
      0,
      campaignName,
      0n,
    ]);
    await delay(5_000);

    facadeAddress = (await campaignFactory.read.campaigns([BigInt(countBefore)])) as Address;
    console.log(
      `[deploy-fuji-coti] Template facade (thin, no MpcCore): ${facadeAddress} runId=${runId}`
    );

    await fundAffordable(
      sourceClients.walletClient,
      sourceClients.publicClient,
      facadeAddress,
      preferredFund,
      "PayrollCampaignFacade"
    );
  } else {
    console.log("[deploy-fuji-coti] SKIP_TEMPLATE_CAMPAIGN=1 — create campaigns via factory");
  }

  const production = {
    updatedAt: new Date().toISOString(),
    mode: "production",
    architecture: ARCHITECTURE,
    fundPath: "public pToken.transfer(facade) → requestCreditPool → COTI creditPool",
    claimPath: "claim → COTI verifyAndCredit → public payoutTo(uint256)",
    sourceNetwork: SOURCE_NETWORK,
    sourceChainId: FUJI_CHAIN_ID,
    cotiNetwork: COTI_NETWORK,
    cotiChainId: COTI_CHAIN_ID,
    inboxSource: inboxFuji,
    inboxCoti,
    mpcExecutor,
    privatePayrollCoti: cotiPayroll.address,
    payrollVault: payrollVault.address,
    payrollClaimStore: claimStore.address,
    payrollCampaignFactory: campaignFactory.address,
    payrollCampaignFacade: facadeAddress,
    pToken: pTokenAddress,
    pTokenKey: pTokenFromEnv ? "PAYROLL_PTOKEN_ADDRESS" : pTokenKey,
    underlying:
      (!pTokenFromEnv && portalTokens[pTokenKey]?.underlying?.trim()) || undefined,
    privacyPortal:
      (!pTokenFromEnv && portalTokens[pTokenKey]?.portal?.trim()) || undefined,
    comptroller: comptroller.address,
    owner: sourceClients.walletClient.account.address,
    cotiOwner,
    runId,
    campaignStartTime,
    campaignName,
    inboxFeeWei: inboxFeeWei.toString(),
    callbackFeeWei: callbackFeeWei.toString(),
    pTokenTransferFeeWei: pTokenTransferFeeWei.toString(),
    pTokenCallbackFeeWei: pTokenCallbackFeeWei.toString(),
  };

  await fs.mkdir(deploymentsDir, { recursive: true });
  await fs.writeFile(productionPath, `${JSON.stringify(production, null, 2)}\n`, "utf8");

  const cfgRaw = JSON.parse(await fs.readFile(deployConfigPath, "utf8")) as {
    chains: Record<string, Record<string, unknown>>;
  };
  cfgRaw.chains[String(FUJI_CHAIN_ID)] = {
    ...cfgRaw.chains[String(FUJI_CHAIN_ID)],
    privatePayrollCoti: cotiPayroll.address,
    payrollVault: payrollVault.address,
    payrollClaimStore: claimStore.address,
    payrollCampaignFactory: campaignFactory.address,
    ...(facadeAddress ? { payrollCampaignFacade: facadeAddress } : {}),
  };
  cfgRaw.chains[String(COTI_CHAIN_ID)] = {
    ...cfgRaw.chains[String(COTI_CHAIN_ID)],
    privatePayrollCoti: cotiPayroll.address,
  };
  await fs.writeFile(deployConfigPath, `${JSON.stringify(cfgRaw, null, 2)}\n`, "utf8");

  console.log("[deploy-fuji-coti] Done:");
  console.log(JSON.stringify(production, null, 2));
  console.log(`[deploy-fuji-coti] Wrote ${productionPath}`);
  console.log(`[deploy-fuji-coti] Updated ${deployConfigPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. UI/employer: public pToken.transfer(facade, amount) → settle");
  console.log("  2. Admin: facade.requestCreditPool(amount) {value: inboxFee}");
  console.log("  3. Relayer mines Fuji→COTI then COTI→Fuji for credit + claims");
  console.log("  4. npm run verify:production:avax");
};

main().catch((err) => {
  console.error("[deploy-fuji-coti] Failed:", err);
  process.exitCode = 1;
});
