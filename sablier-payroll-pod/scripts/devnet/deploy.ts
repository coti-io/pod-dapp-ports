// One-shot deploy against the persistent local devnet (scripts/devnet/start.sh).
// Reuses the exact same deployment/wiring sequence the test suite already
// proves correct (createSablierPayrollScenario) — just pointed at the two
// long-running external nodes instead of ephemeral in-process networks, and
// left running afterward instead of torn down.
//
// Run with: npx hardhat run scripts/devnet/deploy.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Node's default fatal-rejection exit path has been observed to segfault on this
// platform before it can flush its own error output. Handle rejections/exceptions
// ourselves, flush synchronously, and exit normally so the real error is visible.
process.on("unhandledRejection", (reason) => {
  fs.writeSync(2, `\nUNHANDLED REJECTION: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  fs.writeSync(2, `\nUNCAUGHT EXCEPTION: ${err.stack}\n`);
  process.exit(1);
});

process.env.SIM_COTI_NETWORK_MODE ||= "node";
process.env.COTI_BACKEND ||= "sim";
process.env.POD_PAYROLL_PORT_TESTS ||= "1";
process.env.SABLIER_PAYROLL_TESTS ||= "1";

const { createSablierPayrollScenario } = await import("../../test/lib/pod-scenario.js");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  console.log("Connecting to persistent devnet + deploying payroll protocol...");
  const scenario = await createSablierPayrollScenario();

  console.log("Deploying a demo campaign (alice/bob/carol roster)...");
  const demoRoster = [
    { recipient: scenario.alice.address, amount: 2_500n },
    { recipient: scenario.bob.address, amount: 3_000n },
    { recipient: scenario.carol.address, amount: 1_500n },
  ];
  const { campaign, tree, fundAmount } = await scenario.freshCampaign({ roster: demoRoster });

  const podCtx = scenario.podBackend.podCtx as unknown as {
    contracts: {
      inboxSepolia: { address: string };
      inboxCoti: { address: string };
      mpcExecutor?: { address: string };
    };
    coti: { publicClient: { getChainId: () => Promise<number> } };
  };

  // Query the live chain IDs rather than hardcoding — HARDHAT_CHAIN_ID can override
  // the AVAX-surrogate chain ID (see hardhat.config.ts), and hardcoding here would
  // silently desync deployments/local-devnet.json (and the relayer, which reads
  // chain IDs from it) from whatever the nodes are actually running.
  const avaxChainId = await scenario.publicClient.getChainId();
  const cotiChainId = await podCtx.coti.publicClient.getChainId();
  const avaxPort = process.env.DEVNET_AVAX_PORT || "8545";
  const cotiPort = process.env.DEVNET_COTI_PORT || "8546";

  const out = {
    updatedAt: new Date().toISOString(),
    avax: {
      chainId: avaxChainId,
      rpcUrl: `http://127.0.0.1:${avaxPort}`,
      contracts: {
        payrollVault: scenario.podBackend.payrollVault.address,
        claimStore: scenario.podBackend.claimStore.address,
        comptroller: scenario.comptroller.address,
        token: scenario.token.address,
        inbox: podCtx.contracts.inboxSepolia.address,
      },
    },
    coti: {
      chainId: cotiChainId,
      rpcUrl: `http://127.0.0.1:${cotiPort}`,
      contracts: {
        privatePayrollCoti: scenario.podBackend.cotiPayroll.address,
        inbox: podCtx.contracts.inboxCoti.address,
        mpcExecutor: podCtx.contracts.mpcExecutor?.address,
      },
    },
    accounts: {
      admin: scenario.admin.address,
      employer: scenario.employer.address,
      alice: scenario.alice.address,
      bob: scenario.bob.address,
      carol: scenario.carol.address,
    },
    demoCampaign: {
      address: campaign.address,
      merkleRoot: tree.root,
      fundAmount: fundAmount.toString(),
      roster: tree.packages.map((pkg) => ({
        index: pkg.index,
        recipient: pkg.recipient,
        amount: pkg.amount.toString(),
        amountCommitment: pkg.amountCommitment,
        proof: pkg.proof,
      })),
    },
  };

  const outDir = path.join(repoRoot, "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "local-devnet.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
