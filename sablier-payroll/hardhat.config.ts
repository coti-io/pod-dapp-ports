import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    preferWasm: process.env.HARDHAT_SOLIDITY_PREFER_WASM === "true",
    compilers: [
      {
        version: "0.8.28",
        settings: {
          evmVersion: "cancun",
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
        },
      },
    ],
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
      chainId: 31337,
    },
  },
});
