import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";
import simCotiPlugin from "@coti-io/sim-coti-node/hardhat/plugin";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const pkgRoot = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(pkgRoot, ".env") });
dotenv.config({ path: path.resolve(pkgRoot, "../../pod-ecosystem-integration/.env") });

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";

if (!process.env.PRIVATE_KEY?.trim()) {
  const account = mnemonicToAccount(HARDHAT_MNEMONIC);
  process.env.PRIVATE_KEY = bytesToHex(account.getHdKey().privateKey!);
}

const collectTestPrivateKeys = (): `0x${string}`[] => {
  const raw = [
    process.env.PRIVATE_KEY?.trim(),
    process.env.COTI_TESTNET_PRIVATE_KEY?.trim(),
    process.env._PRIVATE_KEY?.trim(),
    process.env.PRIVATE_KEY_ACCOUNT_2?.trim(),
    process.env.SEPOLIA_PRIVATE_KEY?.trim(),
  ].filter((k): k is string => !!k);
  const seen = new Set<string>();
  const out: `0x${string}`[] = [];
  for (const key of raw) {
    const normalized = (key.startsWith("0x") ? key : `0x${key}`).toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized as `0x${string}`);
    }
  }
  return out;
};

// Always fund the full 20-account mnemonic list. An env-based override here would fund only
// the single auto-forced PRIVATE_KEY account (index 0), starving alice/bob/carol of ETH for gas.
const hardhatTestAccounts = () =>
  Array.from({ length: 20 }, (_, i) => ({
    privateKey: bytesToHex(mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: i }).getHdKey().privateKey!),
    balance: "100000000000000000000000",
  }));

// `http` network types take a flat private-key array (no {privateKey, balance} genesis shape).
// Always derive the full 20-account mnemonic list (index 0 matches the auto-forced PRIVATE_KEY
// above) — an env-based single-key override here would silently collapse alice/bob/employer/admin
// onto one signer, since only PRIVATE_KEY is ever force-set at config load time.
const httpAccounts = (): `0x${string}`[] =>
  Array.from({ length: 20 }, (_, i) =>
    bytesToHex(mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: i }).getHdKey().privateKey!)
  );

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, simCotiPlugin],
  solidity: {
    preferWasm: false,
    compilers: [
      {
        version: "0.8.28",
        settings: {
          evmVersion: "cancun",
          viaIR: true,
          optimizer: { enabled: true, runs: 10 },
        },
      },
    ],
    overrides: {
      "contracts/simCOTI/SimExtendedOperations.sol": {
        version: "0.8.28",
        settings: {
          evmVersion: "cancun",
          viaIR: true,
          optimizer: { enabled: true, runs: 1 },
        },
      },
    },
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
    tests: "./test",
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainId: parseInt(process.env.HARDHAT_CHAIN_ID || "31337"),
      accounts: hardhatTestAccounts(),
    },
    simCoti: {
      type: "edr-simulated",
      chainId: 7082401,
      accounts: hardhatTestAccounts(),
    },
    chain1: {
      type: "edr-simulated",
      chainId: 31337,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
      },
    },
    chain2: {
      type: "edr-simulated",
      chainId: 31338,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
      },
    },
    // Persistent devnet: external `hardhat node` processes (see scripts/devnet/).
    // Names must match connectDualChainForTests's "node" mode (pod-ecosystem-integration).
    localSepolia: {
      type: "http",
      chainType: "l1",
      chainId: parseInt(process.env.HARDHAT_CHAIN_ID || "31337"),
      url: process.env.DEVNET_AVAX_RPC_URL || "http://127.0.0.1:8545",
      accounts: httpAccounts(),
    },
    localSimCoti: {
      type: "http",
      chainType: "l1",
      chainId: 7082401,
      url: process.env.DEVNET_COTI_RPC_URL || "http://127.0.0.1:8546",
      accounts: httpAccounts(),
    },
  },
});
