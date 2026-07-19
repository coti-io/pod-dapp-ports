import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(pkgRoot, ".env") });
dotenv.config({ path: path.resolve(pkgRoot, "../../pod-ecosystem-integration/.env") });

if (!process.env.PRIVATE_KEY?.trim()) {
  const account = mnemonicToAccount("test test test test test test test test test test test junk");
  process.env.PRIVATE_KEY = bytesToHex(account.getHdKey().privateKey!);
}

process.env.POD_PAYROLL_PORT_TESTS = "1";
process.env.PAYROLL_SYSTEM_E2E = "1";
process.env.SABLIER_PAYROLL_TESTS = "1";
if (!process.env.COTI_BACKEND) {
  process.env.COTI_BACKEND = "sim";
}

await import("./e2e/payroll-system.e2e.js");
