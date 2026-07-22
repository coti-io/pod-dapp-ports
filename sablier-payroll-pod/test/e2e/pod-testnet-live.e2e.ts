/**
 * PoD-Testnet-Live e2e: Fuji + COTI against deployConfig / production manifest.
 *
 * - Encrypts with PoD encryption service (`CotiPodCrypto`) for claim verify IT
 * - Register-leaf IT uses onboarded COTI owner key (direct COTI tx.origin)
 * - Tracks inbox requests with `PodRequest.waitForRequest`
 * - Does **not** mine (`batchProcessRequests`) — waits for live PoD miners
 *
 *   PAYROLL_E2E_POD_LIVE=1 SOURCE_NETWORK=avalancheFuji npm run test:e2e:pod-live
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { prepareIT256 } from "@coti-io/coti-sdk-typescript";
import {
  concatHex,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  decodeFunctionResult,
  keccak256,
  parseAbi,
  parseAbiItem,
  toFunctionSelector,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalizePrivateKey } from "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";
import {
  PAYROLL_FEE_CALLBACK_CALL_SIZE,
  PAYROLL_FEE_CALLBACK_EXEC_GAS,
  PAYROLL_FEE_REMOTE_CALL_SIZE,
  PAYROLL_FEE_REMOTE_EXEC_GAS,
  quotePayrollInboxFees,
} from "../lib/payroll-fees.js";
import { amountCommitmentFromCt } from "../lib/merkle.js";
import {
  FUJI_CHAIN_ID,
  cotiRpcUrl,
  createPodRequestTracker,
  encodeClaimProofHandle,
  encryptItUint256,
  extractRequestIdFromTx,
  loadPayrollLiveManifest,
  loadPeiDeployConfig,
  waitForLivePodRequest,
  waitForLivePTokenBalance,
  type PayrollLiveManifest,
} from "../lib/pod-live.js";
import { spLog } from "../lib/utils.js";

const REGISTER_LEAF_SELECTOR = toFunctionSelector(
  "registerLeaf(uint256,uint256,address,bytes32,((uint256,uint256),bytes))"
) as Hex;

const BATCH_PROCESS_SELECTOR = toFunctionSelector(
  "batchProcessRequests(uint256,(bytes32,address,address,(bytes4,bytes,bytes8[],bytes32[]),bytes4,bytes4,bool,bytes32,uint256,uint256)[])"
) as Hex;

const run = process.env.PAYROLL_E2E_POD_LIVE === "1";
const d = run ? describe : describe.skip;

if (!run) {
  spLog("pod-testnet-live skipped — set PAYROLL_E2E_POD_LIVE=1");
}

const FACADE_ABI = parseAbi([
  "function poolCreditedTotal() view returns (uint256)",
  "function requestCreditPool(uint256 amount, uint256 callbackFeeWei) payable",
  "function hasClaimed(uint256 index) view returns (bool)",
  "function admin() view returns (address)",
  "function TOKEN() view returns (address)",
  "function calculateMinFeeWei() view returns (uint256)",
  "function claim(uint256 index, address recipient, bytes32[] merkleProof, uint256 inboxTotalFeeWei, uint256 inboxCallbackFeeWei, uint256 pTokenTotalFeeWei, uint256 pTokenCallbackFeeWei) payable",
  "function registerLeaf(uint256 index, address recipient, bytes32 commitment)",
  "function runId() view returns (uint256)",
]);

const PTOKEN_ABI = parseAbi([
  "function estimateFee() view returns (uint256 totalFeeWei, uint256 targetFeeWei, uint256 callbackFeeWei)",
  "function transfer(address to, uint256 amount, uint256 callbackFee) payable returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

const PORTAL_ABI = parseAbi([
  "function estimateDepositFees(uint256 amount) view returns (uint256 portalFee, bool usedDynamic, uint256 mintTotalFee, uint256 mintCallbackFee)",
  "function deposit(address recipient, uint256 amount, uint256 portalFee, uint256 mintCallbackFee) payable",
  "function underlying() view returns (address)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
]);

const CLAIM_STORE_ABI = parseAbi([
  "function submitPayload(address facade, uint256 index, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) verifyIt, bytes proofHandle)",
]);

const COTI_PAYROLL_ABI = parseAbi([
  "function registerRun(uint256 runId, bytes32 eligibilityRoot)",
  "function registerLeaf(uint256 runId, uint256 index, address employee, bytes32 amountCommitment, ((uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) itAmount)",
  "function runs(uint256) view returns (bytes32 eligibilityRoot, bool exists)",
]);

const FACTORY_ABI = parseAbi([
  "function createCampaign(address admin, bytes32 merkleRoot, address token, uint40 campaignStartTime, uint40 expiration, string campaignName, uint256 minFeeUSD) returns (address facade, uint256 runId)",
  "function campaignCount() view returns (uint256)",
  "function campaigns(uint256) view returns (address)",
]);

const INBOX_FEE_ABI = parseAbi([
  "function calculateTwoWayFeeRequiredInLocalToken(uint256,uint256,uint256,uint256,uint256) view returns (uint256,uint256)",
]);

const CAMPAIGN_CREATED =
  "event CampaignCreated(address indexed facade, uint256 indexed runId, address indexed admin, address creator, address token, bytes32 merkleRoot)" as const;

function formatLocalIt(it: {
  ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint };
  signature: string | Hex | Uint8Array | number[];
}) {
  const signature =
    typeof it.signature === "string"
      ? ((it.signature.startsWith("0x") ? it.signature : `0x${it.signature}`) as Hex)
      : (toHex(it.signature as Uint8Array) as Hex);
  return { ciphertext: it.ciphertext, signature };
}

async function buildOwnedIt256(
  privateKey: Hex,
  amount: bigint,
  validatingContract: Address,
  functionSelector: Hex
) {
  const account = privateKeyToAccount(privateKey).address;
  // Bypass mpc-test-utils AES cache / stale env — recover the on-chain key for this EOA.
  const { Wallet: CotiWallet, JsonRpcProvider, ONBOARD_CONTRACT_ADDRESS } = await import(
    "@coti-io/coti-ethers"
  );
  const provider = new JsonRpcProvider(cotiRpcUrl()) as never;
  const wallet = new CotiWallet(privateKey, provider);
  const onboardAddress =
    process.env.COTI_ONBOARD_CONTRACT_ADDRESS || ONBOARD_CONTRACT_ADDRESS;
  await wallet.generateOrRecoverAes(onboardAddress);
  let userKey = wallet.getUserOnboardInfo()?.aesKey;
  if (!userKey) throw new Error(`no AES key for ${account}`);
  if (userKey.startsWith("0x")) userKey = userKey.slice(2);
  if (userKey.length > 32) userKey = userKey.slice(0, 32);
  wallet.setAesKey(userKey);
  spLog(`IT encrypt ${account.slice(0, 10)}… aes=${userKey.slice(0, 8)}…`);
  return formatLocalIt(
    prepareIT256(
      amount,
      { wallet: wallet as never, userKey },
      validatingContract,
      functionSelector
    )
  );
}

function encodeSingleLeaf(index: number, recipient: Address, commitment: Hex): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }],
      [BigInt(index), recipient, commitment]
    )
  );
  return keccak256(concatHex([inner]));
}

/** eth_call with gasPrice so pToken/portal estimateFee sees non-zero tx.gasprice. */
async function estimatePTokenFeesLive(
  publicClient: PublicClient,
  pToken: Address,
  gasPrice: bigint
): Promise<{ totalFeeWei: bigint; callbackFeeWei: bigint }> {
  const data = encodeFunctionData({
    abi: PTOKEN_ABI,
    functionName: "estimateFee",
  });
  const raw = (await publicClient.request({
    method: "eth_call",
    params: [
      {
        to: pToken,
        data,
        gasPrice: `0x${gasPrice.toString(16)}`,
      },
      "latest",
    ],
  })) as Hex;
  const [totalFeeWei, , callbackFeeWei] = decodeFunctionResult({
    abi: PTOKEN_ABI,
    functionName: "estimateFee",
    data: raw,
  }) as [bigint, bigint, bigint];
  // Small pad for mulDiv rounding between estimate and validate.
  const pad = (x: bigint) => x + x / 20n + 1n;
  return {
    totalFeeWei: pad(totalFeeWei),
    callbackFeeWei: pad(callbackFeeWei),
  };
}

async function liveGasPrice(publicClient: PublicClient): Promise<bigint> {
  const gasPriceRaw = await publicClient.getGasPrice();
  const minGasPriceWei = 2_000_000_000n;
  return gasPriceRaw > minGasPriceWei ? gasPriceRaw : minGasPriceWei;
}

/** Fresh pending nonce + retries for Fuji RPC / aborted-run races. */
async function writeLiveContract(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Address,
  args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
    gas?: bigint;
    gasPrice?: bigint;
  },
  label: string
): Promise<Hex> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const nonce = await publicClient.getTransactionCount({
      address: account,
      blockTag: "pending",
    });
    const baseGas = args.gasPrice ?? (await liveGasPrice(publicClient));
    const gasPrice = baseGas + BigInt(attempt) * 250_000_000n;
    try {
      return await walletClient.writeContract({
        ...args,
        account,
        chain: null,
        nonce,
        gasPrice,
      } as never);
    } catch (e) {
      lastErr = e;
      const msg = String(e).toLowerCase();
      if (
        (msg.includes("nonce") ||
          msg.includes("underpriced") ||
          msg.includes("replacement")) &&
        attempt < 3
      ) {
        spLog(`${label} retry ${attempt + 1}: ${String(e).slice(0, 140)}`);
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function waitReceipt(
  publicClient: PublicClient,
  hash: Hex,
  label?: string
): Promise<void> {
  const timeout = Number(process.env.FUJI_RECEIPT_TIMEOUT_MS || 300_000);
  const deadline = Date.now() + timeout;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: Math.min(60_000, deadline - Date.now()),
      });
      if (receipt.status !== "success") {
        throw new Error(`tx reverted${label ? ` (${label})` : ""}: ${hash}`);
      }
      return;
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
      throw new Error(
        `waitReceipt failed${label ? ` (${label})` : ""} hash=${hash}: ${msg}`
      );
    }
  }
  throw new Error(
    `waitReceipt failed${label ? ` (${label})` : ""} hash=${hash}: ${String(lastErr)}`
  );
}

async function fundFacadeLive(params: {
  manifest: PayrollLiveManifest;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
  tracker: ReturnType<typeof createPodRequestTracker>;
  facade: Address;
  amount: bigint;
  label: string;
}): Promise<void> {
  const { manifest, publicClient, walletClient, account, tracker, facade, amount, label } =
    params;
  const pToken = manifest.pToken as Address;
  const portal = manifest.privacyPortal as Address;
  const underlying = manifest.underlying as Address;
  const gasPrice = await liveGasPrice(publicClient);
  const inboxReader = {
    read: {
      calculateTwoWayFeeRequiredInLocalToken: async (
        args: readonly [bigint, bigint, bigint, bigint, bigint]
      ) =>
        publicClient.readContract({
          address: manifest.inboxSource as Address,
          abi: INBOX_FEE_ABI,
          functionName: "calculateTwoWayFeeRequiredInLocalToken",
          args: [...args],
        }) as Promise<readonly [bigint, bigint]>,
    },
  };

  const [portalFee] = (await publicClient.readContract({
    address: portal,
    abi: PORTAL_ABI,
    functionName: "estimateDepositFees",
    args: [amount],
  })) as [bigint, boolean, bigint, bigint];
  const pTokenFees = await estimatePTokenFeesLive(publicClient, pToken, gasPrice);
  assert.ok(pTokenFees.totalFeeWei > 0n, "pToken estimateFee with gasPrice must be > 0");

  try {
    const mintHash = await writeLiveContract(
      publicClient,
      walletClient,
      account,
      {
        address: underlying,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [account, amount],
        gasPrice,
      },
      `${label}-mint`
    );
    await waitReceipt(publicClient, mintHash, `${label}-mint`);
  } catch (e) {
    spLog(`underlying mint skipped: ${String(e).slice(0, 120)}`);
  }

  const approveHash = await writeLiveContract(
    publicClient,
    walletClient,
    account,
    {
      address: underlying,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [portal, amount],
      gasPrice,
    },
    `${label}-approve`
  );
  await waitReceipt(publicClient, approveHash, `${label}-approve`);

  const depHash = await writeLiveContract(
    publicClient,
    walletClient,
    account,
    {
      address: portal,
      abi: PORTAL_ABI,
      functionName: "deposit",
      args: [account, amount, portalFee, pTokenFees.callbackFeeWei],
      value: portalFee + pTokenFees.totalFeeWei,
      gasPrice,
    },
    `${label}-deposit`
  );
  const depReq = await extractRequestIdFromTx({
    publicClient,
    txHash: depHash,
    inboxAddress: manifest.inboxSource as Address,
  });
  await waitForLivePodRequest(tracker, FUJI_CHAIN_ID, depReq, {
    label: `${label}-portal-deposit`,
    until: "complete",
  });

  const beforeCredit = (await publicClient.readContract({
    address: facade,
    abi: FACADE_ABI,
    functionName: "poolCreditedTotal",
  })) as bigint;

  const xferHash = await writeLiveContract(
    publicClient,
    walletClient,
    account,
    {
      address: pToken,
      abi: PTOKEN_ABI,
      functionName: "transfer",
      args: [facade, amount, pTokenFees.callbackFeeWei],
      value: pTokenFees.totalFeeWei,
      gasPrice,
    },
    `${label}-transfer`
  );
  const xferReq = await extractRequestIdFromTx({
    publicClient,
    txHash: xferHash,
    inboxAddress: manifest.inboxSource as Address,
  });
  await waitForLivePodRequest(tracker, FUJI_CHAIN_ID, xferReq, {
    label: `${label}-ptoken-transfer`,
    until: "complete",
  });

  const payrollFees = await quotePayrollInboxFees(inboxReader as never, gasPrice);
  const creditHash = await writeLiveContract(
    publicClient,
    walletClient,
    account,
    {
      address: facade,
      abi: FACADE_ABI,
      functionName: "requestCreditPool",
      args: [amount, payrollFees.callbackFeeWei],
      value: payrollFees.totalFeeWei,
      gasPrice,
    },
    `${label}-credit`
  );
  const creditReq = await extractRequestIdFromTx({
    publicClient,
    txHash: creditHash,
    inboxAddress: manifest.inboxSource as Address,
  });
  await waitForLivePodRequest(tracker, FUJI_CHAIN_ID, creditReq, {
    label: `${label}-credit-pool`,
    until: "complete",
    timeoutMs: Number(process.env.POD_LIVE_WAIT_MS || 900_000),
  });

  const deadline = Date.now() + 180_000;
  let credited = beforeCredit;
  while (Date.now() < deadline) {
    credited = (await publicClient.readContract({
      address: facade,
      abi: FACADE_ABI,
      functionName: "poolCreditedTotal",
    })) as bigint;
    if (credited >= beforeCredit + amount) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  assert.ok(
    credited >= beforeCredit + amount,
    `poolCreditedTotal expected >= ${beforeCredit + amount}, got ${credited}`
  );
  spLog(`${label} fund ok credited=${credited} (+${amount})`);
}

d("PoD-Testnet-Live (encrypt svc + live miners)", { concurrency: 1 }, () => {
  let manifest: PayrollLiveManifest;
  let publicClient: PublicClient;
  let walletClient: WalletClient;
  let account: Address;
  let privateKey: Hex;
  let tracker: ReturnType<typeof createPodRequestTracker>;

  before(async () => {
    manifest = loadPayrollLiveManifest();
    const cfg = loadPeiDeployConfig();
    const fujiCfg = cfg.chains[String(FUJI_CHAIN_ID)] || {};
    assert.equal(
      manifest.inboxSource.toLowerCase(),
      String(fujiCfg.inbox || "").toLowerCase(),
      "manifest inbox must match deployConfig[43113].inbox"
    );
    assert.ok(manifest.payrollVault, "missing payrollVault — run npm run deploy:fuji-coti");

    privateKey = normalizePrivateKey(
      process.env.AVALANCHE_FUJI_PRIVATE_KEY?.trim() ||
        process.env.PRIVATE_KEY?.trim() ||
        (() => {
          throw new Error("Missing AVALANCHE_FUJI_PRIVATE_KEY / PRIVATE_KEY");
        })()
    ) as Hex;
    account = privateKeyToAccount(privateKey).address;

    const { viem } = await network.connect({ network: "avalancheFuji" });
    publicClient = await viem.getPublicClient();
    walletClient = await viem.getWalletClient(account);
    tracker = createPodRequestTracker(manifest);

    const chainId = await publicClient.getChainId();
    assert.equal(chainId, FUJI_CHAIN_ID);
    spLog(
      `pod-live ready account=${account} vault=${manifest.payrollVault} facade=${manifest.payrollCampaignFacade} inbox=${manifest.inboxSource}`
    );

    // Let prior aborted-run pending txs settle before we take nonces.
    const pending = await publicClient.getTransactionCount({
      address: account,
      blockTag: "pending",
    });
    const latest = await publicClient.getTransactionCount({
      address: account,
      blockTag: "latest",
    });
    if (pending > latest) {
      spLog(`waiting for ${pending - latest} pending Fuji tx(s) to clear…`);
      const settleDeadline = Date.now() + 180_000;
      while (Date.now() < settleDeadline) {
        const p = await publicClient.getTransactionCount({
          address: account,
          blockTag: "pending",
        });
        const l = await publicClient.getTransactionCount({
          address: account,
          blockTag: "latest",
        });
        if (p === l) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    // Ensure COTI twin has the Fuji run registered (deploy used to skip this).
    const { viem: cotiViem } = await network.connect({ network: "cotiTestnet" });
    const cotiPc = await cotiViem.getPublicClient();
    const cotiPk = normalizePrivateKey(
      process.env.COTI_TESTNET_PRIVATE_KEY?.trim() || privateKey
    ) as Hex;
    const cotiAccount = privateKeyToAccount(cotiPk).address;
    const cotiWallet = await cotiViem.getWalletClient(cotiAccount);
    const runId = (await publicClient.readContract({
      address: manifest.payrollCampaignFacade as Address,
      abi: FACADE_ABI,
      functionName: "runId",
    })) as bigint;
    const run = (await cotiPc.readContract({
      address: manifest.privatePayrollCoti as Address,
      abi: COTI_PAYROLL_ABI,
      functionName: "runs",
      args: [runId],
    })) as [Hex, boolean];
    if (!run[1]) {
      const zeroRoot = `0x${"00".repeat(32)}` as Hex;
      const hash = await cotiWallet.writeContract({
        address: manifest.privatePayrollCoti as Address,
        abi: COTI_PAYROLL_ABI,
        functionName: "registerRun",
        args: [runId, zeroRoot],
        account: cotiAccount,
        chain: null,
      });
      await cotiPc.waitForTransactionReceipt({ hash });
      spLog(`registered COTI runId=${runId}`);
    } else {
      spLog(`COTI runId=${runId} already registered`);
    }
  });

  it("wiring: inbox fee quote (UI heuristics) works against live oracle / gasPrice", async () => {
    const gasPriceRaw = await publicClient.getGasPrice();
    const minGasPriceWei = 2_000_000_000n;
    const gasPrice = gasPriceRaw > minGasPriceWei ? gasPriceRaw : minGasPriceWei;
    const [target, callback] = (await publicClient.readContract({
      address: manifest.inboxSource as Address,
      abi: INBOX_FEE_ABI,
      functionName: "calculateTwoWayFeeRequiredInLocalToken",
      args: [
        PAYROLL_FEE_REMOTE_CALL_SIZE,
        PAYROLL_FEE_CALLBACK_CALL_SIZE,
        PAYROLL_FEE_REMOTE_EXEC_GAS,
        PAYROLL_FEE_CALLBACK_EXEC_GAS,
        gasPrice,
      ],
    })) as [bigint, bigint];
    assert.ok(target + callback > 0n, "inbox fee quote must be > 0 at live gasPrice");
    const padded = await quotePayrollInboxFees(
      {
        read: {
          calculateTwoWayFeeRequiredInLocalToken: async (args) =>
            publicClient.readContract({
              address: manifest.inboxSource as Address,
              abi: INBOX_FEE_ABI,
              functionName: "calculateTwoWayFeeRequiredInLocalToken",
              args: [...args],
            }) as Promise<readonly [bigint, bigint]>,
        },
      },
      gasPrice
    );
    assert.ok(padded.totalFeeWei >= target + callback);
    spLog(
      `fee quote gasPrice=${gasPrice} inbox raw=${target + callback} padded total=${padded.totalFeeWei} callback=${padded.callbackFeeWei}`
    );
  });

  it("encrypt: CotiPodCrypto.itUint256 via encryption service", async () => {
    const it = await encryptItUint256(1_500n, {
      contractAddress: manifest.payrollCampaignFacade,
      userAddress: account,
    });
    assert.ok(it.signature.startsWith("0x") && it.signature.length > 10);
    assert.ok(it.ciphertext.ciphertextHigh >= 0n || it.ciphertext.ciphertextLow >= 0n);
    spLog(`encrypt svc ok sig=${it.signature.slice(0, 18)}…`);
  });

  const runTemplateFund = process.env.POD_LIVE_TEMPLATE_FUND === "1";
  (runTemplateFund ? it : it.skip)(
    "fund: public pToken.transfer + requestCreditPool; wait live round-trip",
    async () => {
      // pMTT uses 6 decimals — deposit a whole token so portal limits / fees behave.
      const amount = 1_000_000n;
      await fundFacadeLive({
        manifest,
        publicClient,
        walletClient,
        account,
        tracker,
        facade: manifest.payrollCampaignFacade as Address,
        amount,
        label: "template",
      });
    }
  );

  it("claim: createCampaign → register → fund → submitPayload → claim; wait live payout", async () => {
    const salary = 500_000n; // 0.5 pMTT (6 decimals)
    const index = 0;
    const recipient = account;
    const pToken = manifest.pToken as Address;
    const gasPrice = await liveGasPrice(publicClient);

    const cotiPk = normalizePrivateKey(
      process.env.COTI_TESTNET_PRIVATE_KEY?.trim() || privateKey
    ) as Hex;
    const cotiAccount = privateKeyToAccount(cotiPk).address;
    const { viem: cotiViem } = await network.connect({ network: "cotiTestnet" });
    const cotiPc = await cotiViem.getPublicClient();
    const cotiWallet = await cotiViem.getWalletClient(cotiAccount);

    // Register IT: owner-signed (tx.origin on direct COTI registerLeaf).
    const registerIt = await buildOwnedIt256(
      cotiPk,
      salary,
      manifest.privatePayrollCoti as Address,
      REGISTER_LEAF_SELECTOR
    );
    const commitment = amountCommitmentFromCt(registerIt.ciphertext);
    const leaf = encodeSingleLeaf(index, recipient, commitment);
    const merkleRoot = leaf; // single-leaf tree
    const proof: Hex[] = [];

    const now = Number((await publicClient.getBlock()).timestamp);
    const createHash = await writeLiveContract(
      publicClient,
      walletClient,
      account,
      {
        address: manifest.payrollCampaignFactory as Address,
        abi: FACTORY_ABI,
        functionName: "createCampaign",
        args: [
          account,
          merkleRoot,
          pToken,
          now - 60,
          0,
          `pod-live-claim-${Date.now()}`,
          0n,
        ],
        gasPrice,
      },
      "createCampaign"
    );
    const createReceipt = await publicClient.waitForTransactionReceipt({
      hash: createHash,
      timeout: Number(process.env.FUJI_RECEIPT_TIMEOUT_MS || 300_000),
    });
    assert.equal(createReceipt.status, "success", "createCampaign reverted");

    let facade: Address | undefined;
    let runId: bigint | undefined;
    for (const log of createReceipt.logs) {
      if (log.address.toLowerCase() !== manifest.payrollCampaignFactory.toLowerCase()) continue;
      try {
        const decoded = decodeEventLogSafe(log);
        if (decoded) {
          facade = decoded.facade;
          runId = decoded.runId;
          break;
        }
      } catch {
        /* next */
      }
    }
    if (!facade || runId === undefined) {
      const count = (await publicClient.readContract({
        address: manifest.payrollCampaignFactory as Address,
        abi: FACTORY_ABI,
        functionName: "campaignCount",
      })) as bigint;
      facade = (await publicClient.readContract({
        address: manifest.payrollCampaignFactory as Address,
        abi: FACTORY_ABI,
        functionName: "campaigns",
        args: [count - 1n],
      })) as Address;
      runId = (await publicClient.readContract({
        address: facade,
        abi: FACADE_ABI,
        functionName: "runId",
      })) as bigint;
    }
    spLog(`claim campaign facade=${facade} runId=${runId} root=${merkleRoot}`);

    const cotiRegisterGas = BigInt(process.env.COTI_REGISTER_LEAF_GAS?.trim() || "8000000");
    const runHash = await cotiWallet.writeContract({
      address: manifest.privatePayrollCoti as Address,
      abi: COTI_PAYROLL_ABI,
      functionName: "registerRun",
      args: [runId, merkleRoot],
      account: cotiAccount,
      chain: null,
      gas: cotiRegisterGas,
    });
    const runReceipt = await cotiPc.waitForTransactionReceipt({ hash: runHash });
    assert.equal(runReceipt.status, "success", `registerRun reverted ${runHash}`);

    const leafHash = await cotiWallet.writeContract({
      address: manifest.privatePayrollCoti as Address,
      abi: COTI_PAYROLL_ABI,
      functionName: "registerLeaf",
      args: [runId, BigInt(index), recipient, commitment, registerIt],
      account: cotiAccount,
      chain: null,
      gas: cotiRegisterGas,
    });
    const leafReceipt = await cotiPc.waitForTransactionReceipt({
      hash: leafHash,
      timeout: Number(process.env.FUJI_RECEIPT_TIMEOUT_MS || 300_000),
    });
    assert.equal(
      leafReceipt.status,
      "success",
      `registerLeaf reverted ${leafHash} — raise COTI_REGISTER_LEAF_GAS if OOG`
    );

    const fujiLeafHash = await writeLiveContract(
      publicClient,
      walletClient,
      account,
      {
        address: facade,
        abi: FACADE_ABI,
        functionName: "registerLeaf",
        args: [BigInt(index), recipient, commitment],
        gasPrice,
      },
      "fuji-registerLeaf"
    );
    await waitReceipt(publicClient, fujiLeafHash, "fuji-registerLeaf");

    await fundFacadeLive({
      manifest,
      publicClient,
      walletClient,
      account,
      tracker,
      facade,
      amount: salary,
      label: `claim-run${runId}`,
    });

    // Employer float pays claim inbox fees from facade balance.
    const inboxReader = {
      read: {
        calculateTwoWayFeeRequiredInLocalToken: async (
          args: readonly [bigint, bigint, bigint, bigint, bigint]
        ) =>
          publicClient.readContract({
            address: manifest.inboxSource as Address,
            abi: INBOX_FEE_ABI,
            functionName: "calculateTwoWayFeeRequiredInLocalToken",
            args: [...args],
          }) as Promise<readonly [bigint, bigint]>,
      },
    };
    const payrollFees = await quotePayrollInboxFees(inboxReader as never, gasPrice);
    const pTokenFees = await estimatePTokenFeesLive(publicClient, pToken, gasPrice);
    const floatNonce = await publicClient.getTransactionCount({
      address: account,
      blockTag: "pending",
    });
    const floatHash = await walletClient.sendTransaction({
      to: facade,
      value: payrollFees.totalFeeWei + pTokenFees.totalFeeWei + 10n ** 15n,
      account,
      chain: null,
      gasPrice,
      nonce: floatNonce,
    });
    await waitReceipt(publicClient, floatHash, "facade-float");

    // Verify IT must be signed by the live network miner (tx.origin on batchProcess).
    // Encryption-service verify ITs validate but recovered a different plaintext than
    // owner prepareIT256 register (errorCode=6). Use MINER / _PRIVATE_KEY instead.
    const minerPk = normalizePrivateKey(
      process.env._PRIVATE_KEY?.trim() ||
        (() => {
          throw new Error("Missing _PRIVATE_KEY (network miner) for live claim verify IT");
        })()
    ) as Hex;
    const minerAccount = privateKeyToAccount(minerPk).address;
    spLog(`claim verify IT signer (miner)=${minerAccount}`);
    const verifyIt = await buildOwnedIt256(
      minerPk,
      salary,
      manifest.inboxCoti as Address,
      BATCH_PROCESS_SELECTOR
    );
    assert.ok(
      verifyIt.ciphertext.ciphertextHigh !== 0n || verifyIt.ciphertext.ciphertextLow !== 0n,
      "verify IT ciphertext must be non-zero"
    );
    const proofHandle = encodeClaimProofHandle(proof, BigInt(index));
    const submitHash = await writeLiveContract(
      publicClient,
      walletClient,
      account,
      {
        address: manifest.payrollClaimStore as Address,
        abi: CLAIM_STORE_ABI,
        functionName: "submitPayload",
        args: [facade, BigInt(index), verifyIt, proofHandle],
        gasPrice,
      },
      "submitPayload"
    );
    await waitReceipt(publicClient, submitHash, "submitPayload");

    const balBefore = (await publicClient.readContract({
      address: pToken,
      abi: PTOKEN_ABI,
      functionName: "balanceOf",
      args: [recipient],
    })) as bigint;

    const claimHash = await writeLiveContract(
      publicClient,
      walletClient,
      account,
      {
        address: facade,
        abi: FACADE_ABI,
        functionName: "claim",
        args: [
          BigInt(index),
          recipient,
          proof,
          payrollFees.totalFeeWei,
          payrollFees.callbackFeeWei,
          pTokenFees.totalFeeWei,
          pTokenFees.callbackFeeWei,
        ],
        value: 0n,
        gasPrice,
        gas: 8_000_000n,
      },
      "claim"
    );
    const claimReq = await extractRequestIdFromTx({
      publicClient,
      txHash: claimHash,
      inboxAddress: manifest.inboxSource as Address,
    });
    await waitForLivePodRequest(tracker, FUJI_CHAIN_ID, claimReq, {
      label: `claim-verify-${claimReq.slice(0, 10)}`,
      until: "complete",
      timeoutMs: Number(process.env.POD_LIVE_WAIT_MS || 900_000),
    });

    const claimedDeadline = Date.now() + 120_000;
    let claimed = false;
    while (Date.now() < claimedDeadline) {
      claimed = (await publicClient.readContract({
        address: facade,
        abi: FACADE_ABI,
        functionName: "hasClaimed",
        args: [BigInt(index)],
      })) as boolean;
      if (claimed) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    assert.ok(
      claimed,
      `hasClaimed still false after claim round-trip (requestId=${claimReq}) — COTI may have raised verifyAndCredit`
    );

    // Nested payoutTo → pToken.transfer is a second live round-trip.
    await waitForLivePTokenBalance({
      publicClient,
      pToken,
      account: recipient,
      minBalance: balBefore + salary,
      label: `claim-payout-${runId}`,
      timeoutMs: Number(process.env.POD_LIVE_WAIT_MS || 900_000),
    });
    spLog(`claim ok runId=${runId} salary=${salary} facade=${facade}`);
  });
});

function decodeEventLogSafe(log: {
  data: Hex;
  topics: readonly Hex[] | Hex[];
}): { facade: Address; runId: bigint } | null {
  try {
    const decoded = decodeEventLog({
      abi: [parseAbiItem(CAMPAIGN_CREATED)],
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });
    if (decoded.eventName !== "CampaignCreated") return null;
    const args = decoded.args as { facade: Address; runId: bigint };
    return { facade: args.facade, runId: args.runId };
  } catch {
    return null;
  }
}
