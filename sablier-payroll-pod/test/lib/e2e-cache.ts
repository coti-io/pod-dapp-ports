/**
 * Persist live-COTI infra across e2e retries (Hardhat source is always fresh in-process).
 * Reuses: COTI Inbox + MpcExecutor (via PEI coti-testnet.json + COTI_REUSE_*) and PodErc20CotiMother.
 * Redeploys each run: Hardhat inbox/portal/pToken/vault + PrivatePayrollCoti (run-id clean slate).
 *
 * Retries must use a unique `HARDHAT_CHAIN_ID` (≥ 313370000) so COTI inbound nonces stay contiguous
 * for the reused inbox (fresh Hardhat always restarts outbound nonces at 1).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import { createPublicClient, http } from "viem";
import { spLog } from "./utils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const E2E_CACHE_PATH = path.join(ROOT, "deployments", "e2e-testnet-cache.json");
export const COTI_DEPLOYMENTS_PATH = path.join(ROOT, "deployments", "coti-testnet.json");

export type E2eTestnetCache = {
  updatedAt: string;
  cotiOwner: Address;
  inboxCoti: Address;
  mpcExecutor: Address;
  podCotiMother: Address;
};

function hasCode(code: string | undefined | null): boolean {
  return !!code && code !== "0x";
}

export function readE2eCache(): E2eTestnetCache | null {
  if (!existsSync(E2E_CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(E2E_CACHE_PATH, "utf8")) as E2eTestnetCache;
  } catch {
    return null;
  }
}

export function writeE2eCache(cache: Omit<E2eTestnetCache, "updatedAt">): void {
  mkdirSync(path.dirname(E2E_CACHE_PATH), { recursive: true });
  const payload: E2eTestnetCache = { ...cache, updatedAt: new Date().toISOString() };
  writeFileSync(E2E_CACHE_PATH, JSON.stringify(payload, null, 2));
  // Keep PEI setupContext cache in sync for inbox/executor reuse.
  writeFileSync(
    COTI_DEPLOYMENTS_PATH,
    JSON.stringify(
      {
        inbox: cache.inboxCoti,
        mpcExecutor: cache.mpcExecutor,
        updatedAt: payload.updatedAt,
      },
      null,
      2
    )
  );
  spLog(`e2e cache saved mother=${cache.podCotiMother} inbox=${cache.inboxCoti}`);
}

/** Verify cached COTI addresses still have code; clear env reuse if stale. */
export async function prepareE2eReuseEnv(opts: {
  cotiRpcUrl: string;
  cotiOwner: Address;
}): Promise<E2eTestnetCache | null> {
  const cache = readE2eCache();
  if (!cache) {
    spLog("e2e cache miss — will deploy COTI inbox/executor/mother");
    return null;
  }
  if (cache.cotiOwner.toLowerCase() !== opts.cotiOwner.toLowerCase()) {
    spLog(
      `e2e cache owner mismatch (cache=${cache.cotiOwner} now=${opts.cotiOwner}) — redeploying COTI infra`
    );
    return null;
  }

  const client = createPublicClient({ transport: http(opts.cotiRpcUrl) });
  const addrs: Array<[string, Address]> = [
    ["inboxCoti", cache.inboxCoti],
    ["mpcExecutor", cache.mpcExecutor],
    ["podCotiMother", cache.podCotiMother],
  ];
  for (const [label, addr] of addrs) {
    const code = await client.getCode({ address: addr });
    if (!hasCode(code as string)) {
      spLog(`e2e cache stale: ${label} ${addr} has no code — redeploying`);
      return null;
    }
  }

  process.env.COTI_REUSE_CONTRACTS = "true";
  process.env.COTI_REUSE_ALLOW_FRESH_HARDHAT = "1";
  process.env.COTI_INBOX_ADDRESS = cache.inboxCoti;
  process.env.COTI_MPC_EXECUTOR_ADDRESS = cache.mpcExecutor;
  writeFileSync(
    COTI_DEPLOYMENTS_PATH,
    JSON.stringify(
      {
        inbox: cache.inboxCoti,
        mpcExecutor: cache.mpcExecutor,
        updatedAt: cache.updatedAt,
      },
      null,
      2
    )
  );
  spLog(
    `e2e reuse COTI inbox=${cache.inboxCoti} executor=${cache.mpcExecutor} mother=${cache.podCotiMother}`
  );
  return cache;
}
