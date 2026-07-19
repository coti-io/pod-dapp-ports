import "dotenv/config";
import "@nomicfoundation/hardhat-verify";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import simCotiPlugin from "@coti-io/sim-coti-node/hardhat/plugin";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const pkgRoot = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(pkgRoot, ".env") });
dotenv.config({ path: path.resolve(pkgRoot, "../../pod-ecosystem-integration/.env") });

const envOrConfig = (key: string) => process.env[key] ?? configVariable(key);

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
// Also unlock funded COTI/testnet EOAs so setupContext can `getWalletClient(cotiOwner)` on the
// Hardhat AVAX surrogate (PEI hardhat.config pattern) without "Unknown account".
const hardhatTestAccounts = () => {
  const mnemonicAccounts = Array.from({ length: 20 }, (_, i) => ({
    privateKey: bytesToHex(mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: i }).getHdKey().privateKey!),
    balance: "100000000000000000000000",
  }));
  const seen = new Set(mnemonicAccounts.map((a) => a.privateKey.toLowerCase()));
  const extras = collectTestPrivateKeys()
    .filter((pk) => !seen.has(pk.toLowerCase()))
    .map((privateKey) => ({
      privateKey,
      balance: "100000000000000000000000",
    }));
  return [...mnemonicAccounts, ...extras];
};

// `http` network types take a flat private-key array (no {privateKey, balance} genesis shape).
// Always derive the full 20-account mnemonic list (index 0 matches the auto-forced PRIVATE_KEY
// above) — an env-based single-key override here would silently collapse alice/bob/employer/admin
// onto one signer, since only PRIVATE_KEY is ever force-set at config load time.
const httpAccounts = (): `0x${string}`[] =>
  Array.from({ length: 20 }, (_, i) =>
    bytesToHex(mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: i }).getHdKey().privateKey!)
  );

const cotiTestnetAccounts = () => collectTestPrivateKeys();

const privateKeyFor = (key: string) =>
  process.env[key] ??
  process.env.PRIVATE_KEY ??
  process.env.SEPOLIA_PRIVATE_KEY ??
  configVariable(key);

/** Prefer native solc; omit explicit path so Hardhat downloads the host platform binary. */
const solc028 = (settings: Record<string, unknown>) => ({
  version: "0.8.28",
  settings,
});

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, simCotiPlugin],
  verify: {
    etherscan: {
      apiKey: envOrConfig("ETHERSCAN_API_KEY"),
      enabled: true,
    },
  },
  chainDescriptors: {
    7082400: {
      name: "COTI Testnet",
      chainType: "generic",
      blockExplorers: {
        blockscout: {
          name: "COTI Testnet Blockscout",
          url: "https://testnet.cotiscan.io",
          apiUrl: "https://testnet.cotiscan.io/api",
        },
      },
    },
    11155111: {
      name: "Sepolia",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Etherscan",
          url: "https://sepolia.etherscan.io",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
    43113: {
      name: "Avalanche Fuji",
      chainType: "l1",
      blockExplorers: {
        etherscan: {
          name: "Snowscan (Fuji)",
          url: "https://testnet.snowscan.xyz",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
  },
  solidity: {
    preferWasm: false,
    compilers: [
      solc028({
        evmVersion: "cancun",
        viaIR: true,
        optimizer: { enabled: true, runs: 10 },
      }),
    ],
    overrides: {
      "contracts/simCOTI/SimExtendedOperations.sol": solc028({
        evmVersion: "cancun",
        viaIR: true,
        optimizer: { enabled: true, runs: 1 },
      }),
      "contracts/Inbox.sol": solc028({
        evmVersion: "paris",
        viaIR: true,
        optimizer: { enabled: true, runs: 10 },
      }),
      // COTI testnet rejects Shanghai PUSH0 — any contract deployed there must be paris.
      "contracts/fee/PriceOracle.sol": solc028({
        evmVersion: "paris",
        viaIR: true,
        optimizer: { enabled: true, runs: 10 },
      }),
      "contracts/pod/mpc/coti-side/MpcExecutor.sol": solc028({
        evmVersion: "paris",
        viaIR: true,
        optimizer: { enabled: true, runs: 10 },
      }),
      "contracts/pod/token/perc20/cotiside/PodErc20CotiMother.sol": solc028({
        evmVersion: "paris",
        viaIR: true,
        optimizer: { enabled: true, runs: 10 },
      }),
      "contracts/sablier-payroll-pod/coti/PrivatePayrollCoti.sol": solc028({
        evmVersion: "paris",
        viaIR: true,
        optimizer: { enabled: true, runs: 10 },
      }),
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
    sepolia: {
      type: "http",
      chainType: "l1",
      url: envOrConfig("SEPOLIA_RPC_URL"),
      accounts: [privateKeyFor("SEPOLIA_PRIVATE_KEY")],
    },
    cotiTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 7082400,
      url: envOrConfig("COTI_TESTNET_RPC_URL"),
      accounts: cotiTestnetAccounts(),
    },
    avalancheFuji: {
      type: "http",
      chainType: "l1",
      chainId: 43113,
      url:
        process.env.AVALANCHE_FUJI_RPC_URL ??
        "https://avalanche-fuji-c-chain-rpc.publicnode.com",
      accounts: [privateKeyFor("AVALANCHE_FUJI_PRIVATE_KEY")],
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
    // URLs are derived from DEVNET_AVAX_PORT/DEVNET_COTI_PORT — the same env vars
    // start.sh/deploy.ts use to pick which port to bind/record — so there's a single
    // source of truth for "what port is this devnet on" instead of two independently
    // settable values (a port var here and a separate URL var there) that can desync.
    localSepolia: {
      type: "http",
      chainType: "l1",
      chainId: parseInt(process.env.HARDHAT_CHAIN_ID || "31337"),
      url: `http://127.0.0.1:${process.env.DEVNET_AVAX_PORT || "8545"}`,
      accounts: httpAccounts(),
    },
    localSimCoti: {
      type: "http",
      chainType: "l1",
      chainId: 7082401,
      url: `http://127.0.0.1:${process.env.DEVNET_COTI_PORT || "8546"}`,
      accounts: httpAccounts(),
    },
  },
});
