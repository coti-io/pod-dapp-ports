/**
 * Production deploy: payroll contracts bound to launched Inbox addresses in deployConfig.json.
 * Does NOT deploy Inbox, MpcExecutor, or Privacy Portal — only payroll-specific contracts.
 *
 * Resume partially deployed runs via:
 *   PRIVATE_PAYROLL_COTI / PAYROLL_VAULT / PAYROLL_CLAIM_STORE / PAYROLL_COMPTROLLER
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  asAddress,
  getChainConfig,
  getViemClients,
} from "../../../pod-ecosystem-integration/scripts/deploy-utils.js";
import {
  fundContractForInboxFees,
  normalizePrivateKey,
} from "../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";

const pkgRoot = path.dirname(fileURLToPath(import.meta.url));
const portRoot = path.resolve(pkgRoot, "..");
const peiRoot = path.resolve(portRoot, "../../pod-ecosystem-integration");
const deployConfigPath = path.resolve(peiRoot, "deployConfig.json");
const deploymentsDir = path.resolve(portRoot, "deployments");

/** Always read PEI deployConfig — not cwd-relative (Hardhat run cwd is the port package). */
const readPeiDeployConfig = async (): Promise<{
  chains?: Record<string, Record<string, any>>;
}> => {
  const raw = await fs.readFile(deployConfigPath, "utf8");
  return JSON.parse(raw);
};

const SOURCE_NETWORK = process.env.SOURCE_NETWORK ?? "sepolia";
const COTI_NETWORK = process.env.COTI_NETWORK ?? "cotiTestnet";const COTI_CHAIN_ID = Number(process.env.COTI_TESTNET_CHAIN_ID || "7082400");

const SEPOLIA_CHAIN_ID = 11155111;
const FUJI_CHAIN_ID = 43113;

/** Per-source-chain manifest — Fuji must not overwrite Sepolia. */
const productionPathFor = (networkName: string) =>
  path.resolve(deploymentsDir, `production-payroll-${networkName}.json`);
const legacyProductionPath = path.resolve(deploymentsDir, "production-payroll.json");

const readJsonIfExists = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const resolveSourceChainId = (networkName: string): number => {
  if (networkName === "avalancheFuji") return FUJI_CHAIN_ID;
  if (networkName === "sepolia") return SEPOLIA_CHAIN_ID;
  throw new Error(`Unsupported SOURCE_NETWORK ${networkName}; use sepolia or avalancheFuji`);
};

const envAddress = (key: string): Address | undefined => {
  const v = process.env[key]?.trim();
  return v ? (asAddress(v, key) as Address) : undefined;
};

/** Fund vault/facade with available balance, keeping a gas reserve. */
async function fundAffordable(
  wallet: { account: { address: Address }; sendTransaction: (...args: any[]) => Promise<`0x${string}`> },
  publicClient: { getBalance: (args: { address: Address }) => Promise<bigint>; waitForTransactionReceipt: (...args: any[]) => Promise<unknown> },
  to: Address,
  preferredWei: bigint,
  label: string
): Promise<bigint> {
  const bal = await publicClient.getBalance({ address: wallet.account.address });
  const gasReserve = 50n * 10n ** 15n; // 0.05 ETH
  const maxAffordable = bal > gasReserve ? bal - gasReserve : 0n;
  const amount = preferredWei < maxAffordable ? preferredWei : maxAffordable;
  if (amount === 0n) {
    console.log(`[deploy-production] skip fund ${label}: balance too low (${bal} wei)`);
    return 0n;
  }
  console.log(`[deploy-production] fund ${label} with ${amount} wei (preferred ${preferredWei})`);
  await fundContractForInboxFees(wallet, publicClient, to, amount);
  return amount;
}

const main = async () => {
  const deployConfig = await readPeiDeployConfig();
  const sourceChainId = resolveSourceChainId(SOURCE_NETWORK);
  const sourceCfg = getChainConfig(deployConfig as any, sourceChainId, SOURCE_NETWORK);
  const cotiCfg = getChainConfig(deployConfig as any, COTI_CHAIN_ID, COTI_NETWORK);

  const inboxSource = asAddress(
    process.env.SOURCE_INBOX?.trim() || sourceCfg.inbox?.trim() || "",
    "SOURCE_INBOX / deployConfig inbox"
  );
  const inboxCoti = asAddress(
    process.env.COTI_INBOX?.trim() || process.env.INBOX?.trim() || cotiCfg.inbox?.trim() || "",
    "COTI_INBOX / deployConfig inbox"
  );
  const mpcExecutor = asAddress(
    process.env.COTI_MPC_EXECUTOR_ADDRESS?.trim() || cotiCfg.cotiExecutor?.trim() || "",
    "COTI_MPC_EXECUTOR_ADDRESS / deployConfig cotiExecutor"
  );

  // Prefer p.MTT (private MTT) for payroll payouts. Override with PAYROLL_PTOKEN_ADDRESS
  // or PAYROLL_PTOKEN_KEY=p.USDC|p.WAVAX|p.WETH|p.MTT.
  const pTokenFromEnv = process.env.PAYROLL_PTOKEN_ADDRESS?.trim();
  const portalTokens = sourceCfg.privacyPortalTokens ?? {};
  const preferredKey = (process.env.PAYROLL_PTOKEN_KEY?.trim() || "p.MTT") as string;
  const tokenKeys = [
    preferredKey,
    "p.MTT",
    "p.USDC",
    "p.WAVAX",
    "p.WETH",
    "pMTT",
    "pUSDC",
    "pWAVAX",
    "pWETH",
    ...Object.keys(portalTokens),
  ];
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
    "PAYROLL_PTOKEN_ADDRESS / deployConfig privacyPortalTokens (prefer p.MTT)"
  );
  console.log(
    `[deploy-production] Payroll pToken key=${pTokenFromEnv ? "env" : pTokenKey} address=${pTokenAddress}`
  );

  // Same COTI testnet hosts both Sepolia + Fuji inbound — reuse PrivatePayrollCoti when present
  // unless FORCE_REDEPLOY_PAYROLL=1 (required after iter-08: old twin lacks creditPool).
  const forceRedeploy = process.env.FORCE_REDEPLOY_PAYROLL === "1";
  const priorCoti = forceRedeploy
    ? undefined
    : envAddress("PRIVATE_PAYROLL_COTI") ||
      (await readJsonIfExists<{ privatePayrollCoti?: string }>(productionPathFor(SOURCE_NETWORK)))
        ?.privatePayrollCoti ||
      (await readJsonIfExists<{ privatePayrollCoti?: string }>(legacyProductionPath))
        ?.privatePayrollCoti ||
      (await readJsonIfExists<{ privatePayrollCoti?: string }>(
        productionPathFor(SOURCE_NETWORK === "avalancheFuji" ? "sepolia" : "avalancheFuji")
      ))?.privatePayrollCoti ||
      cotiCfg.privatePayrollCoti?.trim() ||
      undefined;
  if (priorCoti && !process.env.PRIVATE_PAYROLL_COTI?.trim()) {
    process.env.PRIVATE_PAYROLL_COTI = priorCoti;
    console.log(`[deploy-production] Reusing PrivatePayrollCoti ${priorCoti}`);
  }
  if (forceRedeploy) {
    console.log("[deploy-production] FORCE_REDEPLOY_PAYROLL=1 — deploying fresh PrivatePayrollCoti");
    delete process.env.PRIVATE_PAYROLL_COTI;
  }

  const cotiPk = normalizePrivateKey(
    process.env.COTI_TESTNET_PRIVATE_KEY?.trim() ||
      process.env._PRIVATE_KEY?.trim() ||
      process.env.PRIVATE_KEY?.trim() ||
      (() => {
        throw new Error("Missing COTI deployer private key");
      })()
  );
  const cotiOwner = privateKeyToAccount(cotiPk as `0x${string}`).address;

  console.log(`[deploy-production] Source network: ${SOURCE_NETWORK} (chain ${sourceChainId})`);
  console.log(`[deploy-production] COTI network: ${COTI_NETWORK} (chain ${COTI_CHAIN_ID})`);
  console.log(`[deploy-production] Inbox source=${inboxSource} coti=${inboxCoti}`);
  console.log(`[deploy-production] MpcExecutor=${mpcExecutor} pToken=${pTokenAddress}`);

  const sourceConn = await network.connect({ network: SOURCE_NETWORK });
  const { viem: sourceViem, provider: sourceProvider, networkName: sourceLabel } = sourceConn;
  const sourceClients = await getViemClients(sourceViem, sourceProvider, sourceLabel);

  const cotiConn = await network.connect({ network: COTI_NETWORK });
  const { viem: cotiViem, provider: cotiProvider, networkName: cotiLabel } = cotiConn;
  const cotiClients = await getViemClients(cotiViem, cotiProvider, cotiLabel);

  const reuseCoti = forceRedeploy ? undefined : envAddress("PRIVATE_PAYROLL_COTI");
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
    `[deploy-production] PrivatePayrollCoti: ${cotiPayroll.address}${reuseCoti ? " (reused)" : ""}`
  );

  const reuseVault = forceRedeploy ? undefined : envAddress("PAYROLL_VAULT");
  const payrollVault = reuseVault
    ? await sourceViem.getContractAt(
        "contracts/sablier-payroll-pod/avax/PayrollVault.sol:PayrollVault",
        reuseVault
      )
    : await sourceViem.deployContract(
        "contracts/sablier-payroll-pod/avax/PayrollVault.sol:PayrollVault",
        [inboxSource, cotiPayroll.address]
      );
  console.log(
    `[deploy-production] PayrollVault: ${payrollVault.address}${reuseVault ? " (reused)" : ""}`
  );

  const reuseClaim = forceRedeploy ? undefined : envAddress("PAYROLL_CLAIM_STORE");
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
    `[deploy-production] PodClaimStore: ${claimStore.address}${reuseClaim ? " (reused)" : ""}`
  );

  const reuseComptroller = forceRedeploy ? undefined : envAddress("PAYROLL_COMPTROLLER");
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
    `[deploy-production] Comptroller: ${comptroller.address}${reuseComptroller ? " (reused)" : ""}`
  );

  // Fuji/public RPCs often rate-limit rapid same-wallet txs ("replacement underpriced").
  await new Promise((r) => setTimeout(r, 8_000));
  await payrollVault.write.configure([
    `0x0000000000000000000000000000000000000000`,
    mpcExecutor,
    BigInt(COTI_CHAIN_ID),
  ]);
  await new Promise((r) => setTimeout(r, 3_000));

  const preferredFund = BigInt(process.env.PAYROLL_FUND_WEI?.trim() || String(2n * 10n ** 17n)); // default 0.2 ETH
  await fundAffordable(
    sourceClients.walletClient,
    sourceClients.publicClient,
    payrollVault.address as Address,
    preferredFund,
    "PayrollVault"
  );

  const campaignFactory = await sourceViem.deployContract(
    "contracts/sablier-payroll-pod/avax/PayrollCampaignFactory.sol:PayrollCampaignFactory",
    [payrollVault.address, claimStore.address, comptroller.address]
  );
  console.log(`[deploy-production] PayrollCampaignFactory: ${campaignFactory.address}`);
  await new Promise((r) => setTimeout(r, 5_000));
  await payrollVault.write.setCampaignFactory([campaignFactory.address]);
  await new Promise((r) => setTimeout(r, 5_000));

  const now = Math.floor(Date.now() / 1000);
  const campaignStartTime = now - 60;
  const campaignName = `PoD Payroll ${SOURCE_NETWORK}`;
  const runId = Number(await payrollVault.read.nextRunId());
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
  await new Promise((r) => setTimeout(r, 5_000));

  const facadeAddress = (await campaignFactory.read.campaigns([BigInt(countBefore)])) as Address;
  const facade = await sourceViem.getContractAt(
    "contracts/sablier-payroll-pod/avax/PayrollCampaignFacade.sol:PayrollCampaignFacade",
    facadeAddress
  );
  console.log(`[deploy-production] PayrollCampaignFacade (via factory): ${facade.address} runId=${runId}`);

  await fundAffordable(
    sourceClients.walletClient,
    sourceClients.publicClient,
    facade.address as Address,
    preferredFund,
    "PayrollCampaignFacade"
  );

  const production = {
    updatedAt: new Date().toISOString(),
    mode: "production",
    sourceNetwork: SOURCE_NETWORK,
    sourceChainId,
    cotiNetwork: COTI_NETWORK,
    cotiChainId: COTI_CHAIN_ID,
    inboxSource,
    inboxCoti,
    mpcExecutor,
    privatePayrollCoti: cotiPayroll.address,
    payrollVault: payrollVault.address,
    payrollClaimStore: claimStore.address,
    payrollCampaignFactory: campaignFactory.address,
    payrollCampaignFacade: facade.address,
    pToken: pTokenAddress,
    pTokenKey: pTokenFromEnv ? "PAYROLL_PTOKEN_ADDRESS" : pTokenKey,
    underlying:
      (!pTokenFromEnv && portalTokens[pTokenKey]?.underlying?.trim()) || undefined,
    privacyPortal:
      (!pTokenFromEnv && portalTokens[pTokenKey]?.portal?.trim()) || undefined,
    comptroller: comptroller.address,
    owner: sourceClients.walletClient.account.address,
    runId,
    campaignStartTime,
    campaignName,
  };

  const productionPath = productionPathFor(SOURCE_NETWORK);
  await fs.mkdir(deploymentsDir, { recursive: true });
  await fs.writeFile(productionPath, `${JSON.stringify(production, null, 2)}\n`, "utf8");
  // Keep legacy path in sync for Sepolia (existing verify scripts / docs).
  if (SOURCE_NETWORK === "sepolia") {
    await fs.writeFile(legacyProductionPath, `${JSON.stringify(production, null, 2)}\n`, "utf8");
  }

  const cfgRaw = JSON.parse(await fs.readFile(deployConfigPath, "utf8")) as {
    chains: Record<string, Record<string, unknown>>;
  };
  cfgRaw.chains[String(sourceChainId)] = {
    ...cfgRaw.chains[String(sourceChainId)],
    privatePayrollCoti: cotiPayroll.address,
    payrollVault: payrollVault.address,
    payrollClaimStore: claimStore.address,
    payrollCampaignFactory: campaignFactory.address,
    payrollCampaignFacade: facade.address,
  };
  cfgRaw.chains[String(COTI_CHAIN_ID)] = {
    ...cfgRaw.chains[String(COTI_CHAIN_ID)],
    privatePayrollCoti: cotiPayroll.address,
  };
  await fs.writeFile(deployConfigPath, `${JSON.stringify(cfgRaw, null, 2)}\n`, "utf8");

  console.log("[deploy-production] Done:");
  console.log(JSON.stringify(production, null, 2));
  console.log(`[deploy-production] Updated ${deployConfigPath}`);
  console.log(`[deploy-production] Wrote ${productionPath}`);
};

main().catch((err) => {
  console.error("[deploy-production] Failed:", err);
  process.exitCode = 1;
});
