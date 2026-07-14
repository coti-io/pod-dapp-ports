import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { network } from "hardhat";
import { buildSablierTree, type ClaimPackage, type SablierMerkleTree } from "./merkle.js";
import { spLog } from "./utils.js";

export type Account = {
  address: Address;
  wallet: WalletClient;
  label: string;
};

export type SablierPayrollScenario = {
  viem: Awaited<ReturnType<typeof network.connect>>["viem"];
  publicClient: PublicClient;
  employer: Account;
  employees: Account[];
  alice: Account;
  bob: Account;
  carol: Account;
  admin: Account;
  token: Awaited<ReturnType<typeof deployScenario>>["token"];
  comptroller: Awaited<ReturnType<typeof deployScenario>>["comptroller"];
  campaign: Awaited<ReturnType<typeof deployScenario>>["campaign"];
  merkle: typeof buildSablierTree;
  freshCampaign: (opts: FreshCampaignOpts) => Promise<{
    tree: SablierMerkleTree;
    campaign: SablierPayrollScenario["campaign"];
    fundAmount: bigint;
  }>;
};

export type FreshCampaignOpts = {
  roster: { recipient: Address; amount: bigint }[];
  fundAmount?: bigint;
  campaignStartTime?: number;
  expiration?: number;
  minFeeUSD?: bigint;
};

async function deployScenario(viem: SablierPayrollScenario["viem"], _employer: Account) {
  const token = await viem.deployContract(
    "contracts/mocks/SablierPayrollToken.sol:SablierPayrollToken",
    ["Payroll USD", "PUSD", 6]
  );
  const comptroller = await viem.deployContract(
    "contracts/mocks/MockSablierComptroller.sol:MockSablierComptroller",
    [0n]
  );

  return { token, comptroller, campaign: null as any };
}

export async function createSablierPayrollScenario(): Promise<SablierPayrollScenario> {
  const { viem } = await network.connect({ network: "hardhat" });
  const publicClient = await viem.getPublicClient();

  const wallets = await viem.getWalletClients();
  const employerWallet = wallets[0];
  const aliceWallet = wallets[1] ?? wallets[0];
  const bobWallet = wallets[2] ?? wallets[0];
  const carolWallet = wallets[3] ?? wallets[0];
  const adminWallet = wallets[0];

  const employer: Account = {
    address: employerWallet.account.address,
    wallet: employerWallet,
    label: "employer",
  };
  const alice: Account = {
    address: aliceWallet.account.address,
    wallet: aliceWallet,
    label: "alice",
  };
  const bob: Account = {
    address: bobWallet.account.address,
    wallet: bobWallet,
    label: "bob",
  };
  const carol: Account = {
    address: carolWallet.account.address,
    wallet: carolWallet,
    label: "carol",
  };
  const admin: Account = {
    address: adminWallet.account.address,
    wallet: adminWallet,
    label: "admin",
  };

  const { token, comptroller } = await deployScenario(viem, employer);

  spLog(`deployed token=${token.address} comptroller=${comptroller.address}`);

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

    const campaign = await viem.deployContract(
      "contracts/SablierMerkleInstantHarness.sol:SablierMerkleInstantHarness",
      [
        admin.address,
        comptroller.address,
        tree.root,
        token.address,
        campaignStartTime,
        expiration,
        "Q1 Payroll",
        minFeeUSD,
      ]
    );

    await token.write.mint([employer.address, fundAmount], { account: employer.address });
    await token.write.transfer([campaign.address, fundAmount], { account: employer.address });

    spLog(`campaign=${campaign.address} root=${tree.root} funded=${fundAmount}`);
    return { tree, campaign, fundAmount };
  }

  // Default campaign placeholder — stories call freshCampaign
  const placeholder = await viem.deployContract(
    "contracts/SablierMerkleInstantHarness.sol:SablierMerkleInstantHarness",
    [
      admin.address,
      comptroller.address,
      `0x${"00".repeat(32)}` as Hex,
      token.address,
      0,
      0,
      "placeholder",
      0n,
    ]
  );

  return {
    viem,
    publicClient,
    employer,
    employees: [alice, bob, carol],
    alice,
    bob,
    carol,
    admin,
    token,
    comptroller,
    campaign: placeholder,
    merkle: buildSablierTree,
    freshCampaign,
  };
}

export type { ClaimPackage, SablierMerkleTree };
