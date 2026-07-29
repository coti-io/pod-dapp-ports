/**
 * Live Fuji/Sepolia + COTI attach smoke.
 *
 * Attaches to deployed Inbox / Privacy Portal / pToken / payroll from
 * `deployConfig.json` + `deployments/production-payroll-*.json`.
 * Does **not** redeploy the stack. Full create→fund→claim with inbox mining
 * stays on `payroll-system.e2e.ts` (Hardhat surrogate ↔ sim/live COTI).
 *
 *   SOURCE_NETWORK=avalancheFuji PAYROLL_E2E_LIVE_SOURCE=1 npm run test:e2e:live
 *   SOURCE_NETWORK=sepolia PAYROLL_E2E_LIVE_SOURCE=1 npm run test:e2e:live
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { spLog } from "../lib/utils.js";

const run = process.env.PAYROLL_E2E_LIVE_SOURCE === "1";
const d = run ? describe : describe.skip;

const SOURCE = (process.env.SOURCE_NETWORK || "avalancheFuji").trim();
const SOURCE_CHAIN: Record<string, { hardhatNetwork: string; chainId: number; deployFile: string }> = {
  avalancheFuji: {
    hardhatNetwork: "avalancheFuji",
    chainId: 43113,
    deployFile: "production-payroll-avalancheFuji.json",
  },
  sepolia: {
    hardhatNetwork: "sepolia",
    chainId: 11155111,
    deployFile: "production-payroll-sepolia.json",
  },
};

if (!run) {
  spLog(
    'live-source e2e skipped — set PAYROLL_E2E_LIVE_SOURCE=1 and SOURCE_NETWORK=avalancheFuji|sepolia'
  );
}

type DeployManifest = {
  inboxSource: string;
  inboxCoti: string;
  mpcExecutor: string;
  privatePayrollCoti: string;
  payrollVault: string;
  payrollClaimStore: string;
  payrollCampaignFactory: string;
  payrollCampaignFacade: string;
  pToken: string;
  privacyPortal: string;
  underlying: string;
  sourceChainId: number;
  cotiChainId: number;
};

type DeployConfigChain = {
  inbox?: string;
  cotiExecutor?: string;
  privatePayrollCoti?: string;
  payrollVault?: string;
  payrollClaimStore?: string;
  payrollCampaignFactory?: string;
  payrollCampaignFacade?: string;
  privacyPortalTokens?: Record<string, { portal?: string; pToken?: string; underlying?: string }>;
};

d(`Live attach: ${SOURCE} + COTI testnet`, { concurrency: 1 }, () => {
  it("contracts from deploy manifest have code and match deployConfig", async () => {
    const meta = SOURCE_CHAIN[SOURCE];
    assert.ok(meta, `unsupported SOURCE_NETWORK=${SOURCE}`);

    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const deployPath = join(root, "deployments", meta.deployFile);
    const peiConfigPath = join(root, "../../pod-ecosystem-integration/deployConfig.json");

    let manifest: DeployManifest;
    try {
      manifest = JSON.parse(readFileSync(deployPath, "utf8")) as DeployManifest;
    } catch {
      assert.fail(`missing ${deployPath} — run deploy:fuji-coti / deploy:production first`);
    }

    const deployConfig = JSON.parse(readFileSync(peiConfigPath, "utf8")) as {
      chains: Record<string, DeployConfigChain>;
    };
    const sourceCfg = deployConfig.chains[String(meta.chainId)] || {};
    const cotiCfg = deployConfig.chains["7082400"] || {};
    const pMTT = sourceCfg.privacyPortalTokens?.["p.MTT"] ?? sourceCfg.privacyPortalTokens?.pMTT;

    const { viem: sourceViem } = await network.connect({ network: meta.hardhatNetwork });
    const { viem: cotiViem } = await network.connect({ network: "cotiTestnet" });
    const sourcePc = await sourceViem.getPublicClient();
    const cotiPc = await cotiViem.getPublicClient();

    const sourceChainId = await sourcePc.getChainId();
    const cotiChainId = await cotiPc.getChainId();
    assert.equal(sourceChainId, meta.chainId);
    assert.equal(cotiChainId, 7082400);

    async function expectCode(label: string, client: typeof sourcePc, addr: string) {
      const code = (await client.getCode({ address: addr as `0x${string}` })) as string | undefined;
      assert.ok(code && code !== "0x", `${label} has no code at ${addr}`);
    }

    await expectCode("PayrollVault", sourcePc, manifest.payrollVault);
    await expectCode("PodClaimStore", sourcePc, manifest.payrollClaimStore);
    await expectCode("Factory", sourcePc, manifest.payrollCampaignFactory);
    await expectCode("Facade", sourcePc, manifest.payrollCampaignFacade);
    await expectCode("pToken", sourcePc, manifest.pToken);
    await expectCode("PrivacyPortal", sourcePc, manifest.privacyPortal);
    await expectCode("Inbox(source)", sourcePc, manifest.inboxSource);
    await expectCode("PrivatePayrollCoti", cotiPc, manifest.privatePayrollCoti);
    await expectCode("Inbox(coti)", cotiPc, manifest.inboxCoti);

    if (sourceCfg.payrollVault) {
      assert.equal(
        manifest.payrollVault.toLowerCase(),
        sourceCfg.payrollVault.toLowerCase(),
        "manifest vault vs deployConfig"
      );
    }
    if (pMTT?.pToken) {
      assert.equal(manifest.pToken.toLowerCase(), pMTT.pToken.toLowerCase(), "pToken vs deployConfig pMTT");
    }
    if (cotiCfg.privatePayrollCoti) {
      assert.equal(
        manifest.privatePayrollCoti.toLowerCase(),
        cotiCfg.privatePayrollCoti.toLowerCase(),
        "COTI payroll vs deployConfig"
      );
    }

    // Fuji/Sepolia: no MPC precompile on the PoD client chain.
    const precompile = (await sourcePc.getCode({
      address: "0x0000000000000000000000000000000000000064",
    })) as string | undefined;
    assert.ok(!precompile || precompile === "0x", `${SOURCE} must have empty code at 0x64`);

    const facade = await sourceViem.getContractAt(
      "contracts/sablier-payroll-pod/avax/PayrollCampaignFacade.sol:PayrollCampaignFacade",
      manifest.payrollCampaignFacade as `0x${string}`
    );
    const credited = (await facade.read.poolCreditedTotal()) as bigint;
    const token = (await facade.read.TOKEN()) as string;
    assert.equal(token.toLowerCase(), manifest.pToken.toLowerCase());
    spLog(
      `live attach ok ${SOURCE} facade=${manifest.payrollCampaignFacade} poolCreditedTotal=${credited} portal=${manifest.privacyPortal}`
    );
  });
});
