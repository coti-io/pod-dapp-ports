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
process.env.SABLIER_PAYROLL_TESTS = "1";
process.env.COTI_BACKEND = "testnet";

await import("./stories/01-deploy-wiring.stories.js");
await import("./stories/02-employer-setup.stories.js");
await import("./stories/03-employee-claim.stories.js");
await import("./stories/04-claim-failures.stories.js");
await import("./stories/05-admin-clawback.stories.js");
await import("./stories/06-extended-coverage.stories.js");
await import("./stories/07-missing-payment-gaps.stories.js");
await import("./stories/08-employee-move-funds.stories.js");
