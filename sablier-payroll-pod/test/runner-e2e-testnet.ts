import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(pkgRoot, ".env") });
dotenv.config({ path: path.resolve(pkgRoot, "../../pod-ecosystem-integration/.env") });

// Hardhat surrogate must keep mnemonic #0 as the primary unlocked account.
const hardhatPk = bytesToHex(
  mnemonicToAccount("test test test test test test test test test test test junk").getHdKey().privateKey!
);
if (!process.env.HARDHAT_PRIVATE_KEY?.trim()) {
  process.env.HARDHAT_PRIVATE_KEY = hardhatPk;
}
// Do not clobber a funded COTI_TESTNET_PRIVATE_KEY — Hardhat uses mnemonic accounts.
if (!process.env.PRIVATE_KEY?.trim()) {
  process.env.PRIVATE_KEY = hardhatPk;
}

// Prefer reusing live COTI inbox/executor/mother across retries (see test/lib/e2e-cache.ts).
process.env.COTI_REUSE_CONTRACTS = process.env.COTI_REUSE_CONTRACTS || "true";
process.env.COTI_REUSE_ALLOW_FRESH_HARDHAT = "1";

if (!process.env.COTI_MINE_GAS_MPC_256?.trim()) {
  process.env.COTI_MINE_GAS_MPC_256 = "80000000";
}
if (!process.env.COTI_MINE_GAS_POD_TOKEN?.trim()) {
  process.env.COTI_MINE_GAS_POD_TOKEN = "80000000";
}

process.env.POD_PAYROLL_PORT_TESTS = "1";
process.env.PAYROLL_SYSTEM_E2E = "1";
process.env.SABLIER_PAYROLL_TESTS = "1";
process.env.COTI_BACKEND = "testnet";

await import("./e2e/payroll-system.e2e.js");
