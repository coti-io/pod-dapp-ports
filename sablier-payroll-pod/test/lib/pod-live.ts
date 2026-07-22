/**
 * PoD-Testnet-Live helpers: encrypt via PoD encryption service, track requests
 * with `@coti-io/pod-sdk` (no in-process mining — live miners complete round-trips).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CotiPodCrypto,
  DataType,
  PodContract,
  PodRequest,
  type PodSdkConfig,
  type RequestTrackingResponse,
  type EncryptedValue,
} from "@coti-io/pod-sdk";
import { JsonRpcProvider, Wallet, Contract, type InterfaceAbi } from "ethers";
import type { Address, Hex, PublicClient } from "viem";
import { encodeAbiParameters, parseAbiItem, decodeEventLog } from "viem";

export const FUJI_CHAIN_ID = 43113;
export const COTI_CHAIN_ID = 7082400;

export type PayrollLiveManifest = {
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
  comptroller?: string;
  sourceChainId: number;
  cotiChainId: number;
  owner?: string;
};

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const peiRoot = join(pkgRoot, "../../pod-ecosystem-integration");

export function loadPayrollLiveManifest(
  deployFile = "production-payroll-avalancheFuji.json"
): PayrollLiveManifest {
  return JSON.parse(
    readFileSync(join(pkgRoot, "deployments", deployFile), "utf8")
  ) as PayrollLiveManifest;
}

export function loadPeiDeployConfig(): {
  chains: Record<string, Record<string, any>>;
} {
  return JSON.parse(readFileSync(join(peiRoot, "deployConfig.json"), "utf8"));
}

export function fujiRpcUrl(): string {
  return (
    process.env.AVALANCHE_FUJI_RPC_URL?.trim() ||
    "https://avalanche-fuji-c-chain-rpc.publicnode.com"
  );
}

export function cotiRpcUrl(): string {
  const url = process.env.COTI_TESTNET_RPC_URL?.trim();
  if (!url) throw new Error("Missing COTI_TESTNET_RPC_URL");
  return url;
}

/** SDK config always uses deployConfig inbox addresses (not stale pod-sdk defaults). */
export function buildPodSdkConfig(manifest: PayrollLiveManifest): PodSdkConfig {
  return {
    chains: [
      {
        chainId: FUJI_CHAIN_ID,
        inboxAddress: manifest.inboxSource,
        rpcUrl: fujiRpcUrl(),
      },
      {
        chainId: COTI_CHAIN_ID,
        inboxAddress: manifest.inboxCoti,
        rpcUrl: cotiRpcUrl(),
      },
    ],
    encryptionNetwork: "testnet",
  };
}

export function createPodRequestTracker(manifest: PayrollLiveManifest): PodRequest {
  return new PodRequest(buildPodSdkConfig(manifest));
}

/**
 * Wait for live PoD miners to complete a two-way round-trip.
 * Does **not** call batchProcessRequests / mine locally.
 */
export async function waitForLivePodRequest(
  tracker: PodRequest,
  sourceChainId: number,
  requestId: string,
  opts?: {
    until?: "mined" | "executed" | "complete";
    timeoutMs?: number;
    intervalMs?: number;
    label?: string;
  }
): Promise<RequestTrackingResponse> {
  const label = opts?.label ?? requestId.slice(0, 18);
  const until = opts?.until ?? "complete";
  const timeoutMs = opts?.timeoutMs ?? Number(process.env.POD_LIVE_WAIT_MS || 600_000);
  const intervalMs = opts?.intervalMs ?? 5_000;
  console.log(
    `[pod-live] wait ${label} until=${until} timeoutMs=${timeoutMs} (live miners — no local mine)`
  );
  const status = await tracker.waitForRequest(sourceChainId, requestId, {
    until,
    timeoutMs,
    intervalMs,
  });
  if (status.execution) {
    throw new Error(
      `[pod-live] request ${requestId} failed on target: code=${status.execution.errorCode} ${status.execution.errorMessage}`
    );
  }
  console.log(
    `[pod-live] ${label} ok mined=${status.minedOnTarget} executed=${status.executedOnTarget} responseExecuted=${status.response?.executedOnTarget ?? false}`
  );
  return status;
}

/** Encrypt plaintext amount via PoD encryption service (UI path). */
export async function encryptItUint256(
  amount: bigint,
  opts?: {
    contractAddress?: string;
    functionSelector?: string;
    userAddress?: string;
  }
): Promise<{ ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint }; signature: Hex }> {
  const enc = (await CotiPodCrypto.encrypt(amount.toString(), "testnet", DataType.itUint256, {
    contractAddress: opts?.contractAddress,
    functionSelector: opts?.functionSelector,
    userAddress: opts?.userAddress,
  })) as EncryptedValue;

  return encryptedValueToItUint256(enc);
}

/** Normalize encryption-service / JSON ciphertext into Solidity itUint256 ABI shape. */
export function encryptedValueToItUint256(enc: EncryptedValue): {
  ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint };
  signature: Hex;
} {
  const signature = String((enc as { signature: string | string[] }).signature);
  const sig = (signature.startsWith("0x") ? signature : `0x${signature}`) as Hex;
  const ct = (enc as { ciphertext: unknown }).ciphertext;

  if (ct && typeof ct === "object" && "ciphertextHigh" in (ct as object)) {
    const o = ct as { ciphertextHigh: string | bigint; ciphertextLow: string | bigint };
    return {
      ciphertext: {
        ciphertextHigh: BigInt(o.ciphertextHigh),
        ciphertextLow: BigInt(o.ciphertextLow),
      },
      signature: sig,
    };
  }

  // Scalar hex / bigint → split into high/low 128-bit limbs (ctUint256 layout).
  let raw: bigint;
  if (typeof ct === "bigint") raw = ct;
  else if (typeof ct === "string") raw = BigInt(ct.startsWith("0x") ? ct : `0x${ct}`);
  else if (ct && typeof ct === "object" && "value" in (ct as object)) {
    throw new Error("itString ciphertext cannot convert to itUint256");
  } else {
    throw new Error(`unexpected encryption ciphertext shape: ${JSON.stringify(ct)}`);
  }

  const mask = (1n << 128n) - 1n;
  return {
    ciphertext: {
      ciphertextHigh: raw >> 128n,
      ciphertextLow: raw & mask,
    },
    signature: sig,
  };
}

const INBOX_MESSAGE_SENT =
  "event MessageSent(bytes32 indexed requestId, uint256 indexed targetChainId, address indexed targetContract, bytes4 methodSelector, bytes32 methodCallHash, uint256 dataLength, uint16 datatypeCount, uint16 datalenCount, bytes4 callbackSelector, bytes4 errorSelector)" as const;

/** Prefer inbox MessageSent (v2.2 compact log); fall back to first indexed bytes32 topic on inbox. */
export async function extractRequestIdFromTx(params: {
  publicClient: PublicClient;
  txHash: Hex;
  inboxAddress: Address;
}): Promise<Hex> {
  const timeout = Number(process.env.FUJI_RECEIPT_TIMEOUT_MS || 300_000);
  const deadline = Date.now() + timeout;
  let receipt: Awaited<ReturnType<PublicClient["waitForTransactionReceipt"]>> | undefined;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      receipt = await params.publicClient.waitForTransactionReceipt({
        hash: params.txHash,
        timeout: Math.min(60_000, deadline - Date.now()),
      });
      break;
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      if (
        msg.includes("could not be found") ||
        msg.includes("TransactionReceiptNotFound") ||
        msg.includes("Timed out")
      ) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw e;
    }
  }
  if (!receipt) {
    throw new Error(`no receipt for ${params.txHash}: ${String(lastErr)}`);
  }
  if (receipt.status !== "success") {
    throw new Error(`tx reverted: ${params.txHash}`);
  }

  const inbox = params.inboxAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== inbox) continue;
    try {
      const decoded = decodeEventLog({
        abi: [parseAbiItem(INBOX_MESSAGE_SENT)],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "MessageSent") {
        return decoded.args.requestId as Hex;
      }
    } catch {
      /* try next */
    }
    // Compact MessageSent: topic[1] is indexed requestId
    if (log.topics.length >= 2 && log.topics[1]) {
      return log.topics[1] as Hex;
    }
  }

  // Fallback: PodContract.extractRequestIds (may lag inbox event ABI — best effort)
  try {
    const provider = new JsonRpcProvider(fujiRpcUrl());
    const wallet = Wallet.createRandom().connect(provider);
    const pod = new PodContract(params.inboxAddress, [], wallet, {
      inboxAddress: params.inboxAddress,
      encryptionNetwork: "testnet",
    });
    const ids = await pod.extractRequestIds(params.txHash);
    if (ids.length) return ids[0] as Hex;
  } catch {
    /* ignore */
  }

  throw new Error(`no requestId in tx ${params.txHash}`);
}

export function formatItForAbi(it: {
  ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint };
  signature: Hex;
}) {
  return [it.ciphertext, it.signature] as const;
}

export function encodeClaimProofHandle(proof: Hex[], index: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "bytes32[]" }, { type: "uint256" }],
    [proof, index]
  );
}

/**
 * After a claim callback, `payoutTo` queues a nested Fuji→COTI pToken transfer.
 * Poll employee balance until it lands (live miners — no local mine).
 */
export async function waitForLivePTokenBalance(params: {
  publicClient: PublicClient;
  pToken: Address;
  account: Address;
  minBalance: bigint;
  label?: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<bigint> {
  const label = params.label ?? `balance-${params.account.slice(0, 10)}`;
  const timeoutMs = params.timeoutMs ?? Number(process.env.POD_LIVE_WAIT_MS || 600_000);
  const intervalMs = params.intervalMs ?? 5_000;
  const abi = [
    {
      type: "function",
      name: "balanceOf",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "uint256" }],
    },
  ] as const;
  console.log(
    `[pod-live] wait ${label} minBalance=${params.minBalance} timeoutMs=${timeoutMs} (live miners — no local mine)`
  );
  const deadline = Date.now() + timeoutMs;
  let bal = 0n;
  while (Date.now() < deadline) {
    bal = (await params.publicClient.readContract({
      address: params.pToken,
      abi,
      functionName: "balanceOf",
      args: [params.account],
    })) as bigint;
    if (bal >= params.minBalance) {
      console.log(`[pod-live] ${label} ok balance=${bal}`);
      return bal;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `[pod-live] ${label} timeout: balance=${bal} < minBalance=${params.minBalance}`
  );
}

/** Thin ethers wrapper around a Fuji contract for extractRequestIds only. */
export function podContractFor(
  address: string,
  abi: InterfaceAbi,
  privateKey: string,
  inboxAddress: string
): PodContract {
  const provider = new JsonRpcProvider(fujiRpcUrl());
  const signer = new Wallet(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`, provider);
  return new PodContract(address, abi, signer, {
    inboxAddress,
    encryptionNetwork: "testnet",
  });
}

export { Contract, JsonRpcProvider, Wallet };
