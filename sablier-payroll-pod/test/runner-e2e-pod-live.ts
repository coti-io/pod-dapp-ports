import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(pkgRoot, ".env") });
dotenv.config({ path: path.resolve(pkgRoot, "../../pod-ecosystem-integration/.env") });

process.env.PAYROLL_E2E_POD_LIVE = "1";
if (!process.env.SOURCE_NETWORK?.trim()) {
  process.env.SOURCE_NETWORK = "avalancheFuji";
}

await import("./e2e/pod-testnet-live.e2e.js");
