// Continuously drives the async cross-chain PoD relaying between the two persistent devnet
// nodes, so claims/funding transactions submitted by a UI actually complete instead of sitting
// pending forever. In the test suite this is done on-demand via runCrossChainTwoWayRoundTrip;
// this script is the always-on equivalent for an interactive devnet.
//
// Run with: npx hardhat run scripts/devnet/relayer.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

// Exit on fatal errors (matching deploy.ts) rather than logging and continuing: a relayer
// that's silently dead but still holds its pid file makes relayer.sh report it as healthy.
process.on("unhandledRejection", (reason) => {
  fs.writeSync(2, `\n[relayer] UNHANDLED REJECTION: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  fs.writeSync(2, `\n[relayer] UNCAUGHT EXCEPTION: ${err.stack}\n`);
  process.exit(1);
});

const { getNextUnminedOutboundRequest, mineRequest, getResponseRequestBySource } = await import(
  "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js"
);
const { getDefaultCotiMineGasPodToken } = await import(
  "../../../../pod-ecosystem-integration/test/tokens/test-token-utils.js"
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const deploymentsPath = path.join(repoRoot, "deployments", "local-devnet.json");
const POLL_MS = Number(process.env.RELAYER_POLL_MS || 2000);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadDeployments() {
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployments found at ${deploymentsPath} — run scripts/devnet/deploy.ts first.`);
  }
  return JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
}

async function main() {
  const deployments = loadDeployments();
  const avaxChainId: number = deployments.avax.chainId;
  const cotiChainId: number = deployments.coti.chainId;

  const { viem: sepoliaViem } = await network.connect({ network: "localSepolia" });
  const { viem: cotiViem } = await network.connect({ network: "localSimCoti" });

  const inboxSepolia = await sepoliaViem.getContractAt("Inbox", deployments.avax.contracts.inbox);
  const inboxCoti = await cotiViem.getContractAt("Inbox", deployments.coti.contracts.inbox);

  const sepoliaPublicClient = await sepoliaViem.getPublicClient();
  const cotiPublicClient = await cotiViem.getPublicClient();
  const [sepoliaWallet] = await sepoliaViem.getWalletClients();
  const [cotiWallet] = await cotiViem.getWalletClients();

  const ctx = {
    contracts: { inboxCoti, inboxSepolia },
    coti: { wallet: cotiWallet, publicClient: cotiPublicClient },
    sepolia: { wallet: sepoliaWallet, publicClient: sepoliaPublicClient },
  };

  console.log(
    `[relayer] watching avax(${avaxChainId}) inbox ${inboxSepolia.address} <-> coti(${cotiChainId}) inbox ${inboxCoti.address}`
  );

  // COTI-side executions run private/MPC operations that routinely need more gas than
  // mineRequest's own targetFee-derived default — the test suite always overrides this
  // explicitly for pToken/MPC-heavy legs (getDefaultCotiMineGasPodToken, COTI_MINE_GAS_MPC_*).
  // The relayer can't tell request "type" apart generically, so use the same generous
  // default for every COTI-side mine; it's a ceiling, not an exact cost.
  const mineOptionsFor = (mineChain: "sepolia" | "coti") =>
    mineChain === "coti" ? { gas: getDefaultCotiMineGasPodToken() } : undefined;

  async function relayDirection(
    fromLabel: "sepolia" | "coti",
    toLabel: "sepolia" | "coti",
    fromInbox: typeof inboxSepolia,
    toInbox: typeof inboxCoti,
    fromChainId: number,
    toChainId: number
  ): Promise<boolean> {
    const next = await getNextUnminedOutboundRequest(fromInbox, toInbox, fromChainId, toChainId);
    if (next.timestamp === 0n || next.targetContract === ZERO_ADDRESS) return false;

    console.log(`[relayer] mining ${fromLabel}->${toLabel} request ${next.requestId}`);
    const { requestIdUsed } = await mineRequest(ctx, toLabel, BigInt(fromChainId), next, "relayer", mineOptionsFor(toLabel));

    if (next.isTwoWay) {
      const returnLeg = await getResponseRequestBySource(toLabel === "coti" ? inboxCoti : inboxSepolia, requestIdUsed, "relayer");
      console.log(`[relayer] relaying ${toLabel}->${fromLabel} response ${returnLeg.requestId}`);
      await mineRequest(ctx, fromLabel, BigInt(toChainId), returnLeg, "relayer", mineOptionsFor(fromLabel));
    }
    return true;
  }

  console.log("[relayer] started");
  for (;;) {
    let didWork = false;
    try {
      didWork = (await relayDirection("sepolia", "coti", inboxSepolia, inboxCoti, avaxChainId, cotiChainId)) || didWork;
      didWork = (await relayDirection("coti", "sepolia", inboxCoti, inboxSepolia, cotiChainId, avaxChainId)) || didWork;
    } catch (err) {
      console.error("[relayer] error while relaying:", err instanceof Error ? err.message : err);
    }
    if (!didWork) await sleep(POLL_MS);
  }
}

await main();
