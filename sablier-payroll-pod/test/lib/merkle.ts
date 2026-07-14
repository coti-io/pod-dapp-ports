/**
 * PoD payroll port — merkle tree with encrypted amount commitments.
 * Leaf: keccak256(bytes.concat(keccak256(abi.encode(index, recipient, hash(ct)))))
 * encodeLeaf(index, recipient, amount) derives commitment from plaintext amount (S02 contract).
 */
import {
  encodeAbiParameters,
  keccak256,
  concatHex,
  type Address,
  type Hex,
} from "viem";
import { simEncryptUint256 } from "@coti-io/sim-coti-node";

export type RosterEntry = {
  index: number;
  recipient: Address;
  amount: bigint;
};

export type ClaimPackage = {
  index: number;
  recipient: Address;
  amount: bigint;
  proof: Hex[];
  leaf: Hex;
  amountCommitment?: Hex;
  itAmount?: {
    ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint };
    signature: Hex;
  };
};

export type SablierMerkleTree = {
  root: Hex;
  entries: RosterEntry[];
  packages: ClaimPackage[];
  packageFor(recipient: Address): ClaimPackage;
  packageAt(index: number): ClaimPackage;
};

export type PodMerkleContext = {
  userKey: string;
};

let podMerkleCtx: PodMerkleContext | null = null;

export function setPodMerkleContext(ctx: PodMerkleContext | null): void {
  podMerkleCtx = ctx;
}

function requireCtx(): PodMerkleContext {
  if (!podMerkleCtx) throw new Error("pod merkle context not set — call createSablierPayrollScenario first");
  return podMerkleCtx;
}

export function amountCommitmentFromPlain(amount: bigint): Hex {
  const { userKey } = requireCtx();
  const ct = simEncryptUint256(amount, userKey);
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "uint256", name: "ciphertextHigh" },
            { type: "uint256", name: "ciphertextLow" },
          ],
        },
      ],
      [{ ciphertextHigh: ct.ciphertextHigh, ciphertextLow: ct.ciphertextLow }]
    )
  );
}

export function encodeLeaf(index: number, recipient: Address, amount: bigint): Hex {
  const commitment = amountCommitmentFromPlain(amount);
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
      ],
      [BigInt(index), recipient, commitment]
    )
  );
  return keccak256(concatHex([inner]));
}

function commutativeKeccak256(a: Hex, b: Hex): Hex {
  const aBig = BigInt(a);
  const bBig = BigInt(b);
  const [left, right] = aBig < bBig ? [a, b] : [b, a];
  return keccak256(concatHex([left, right]));
}

function buildMerkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) throw new Error("merkle tree requires at least one leaf");
  let level = [...leaves];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(commutativeKeccak256(level[i], level[i + 1]));
      } else {
        next.push(level[i]);
      }
    }
    level = next;
  }
  return level[0];
}

function buildProof(leaves: Hex[], targetIndex: number): Hex[] {
  const proof: Hex[] = [];
  let level = [...leaves];
  let index = targetIndex;

  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    if (siblingIndex < level.length) {
      proof.push(level[siblingIndex]);
    }
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(commutativeKeccak256(level[i], level[i + 1]));
      } else {
        next.push(level[i]);
      }
    }
    index = Math.floor(index / 2);
    level = next;
  }
  return proof;
}

const treesByRoot = new Map<string, SablierMerkleTree>();

export function buildSablierTree(entries: RosterEntry[]): SablierMerkleTree {
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const leaves = sorted.map((e) => encodeLeaf(e.index, e.recipient, e.amount));
  const root = buildMerkleRoot(leaves);

  const packages: ClaimPackage[] = sorted.map((entry, i) => ({
    index: entry.index,
    recipient: entry.recipient,
    amount: entry.amount,
    proof: buildProof(leaves, i),
    leaf: leaves[i],
    amountCommitment: amountCommitmentFromPlain(entry.amount),
  }));

  const byRecipient = new Map(packages.map((p) => [p.recipient.toLowerCase(), p]));
  const byIndex = new Map(packages.map((p) => [p.index, p]));

  const tree = {
    root,
    entries: sorted,
    packages,
    packageFor(recipient: Address) {
      const pkg = byRecipient.get(recipient.toLowerCase());
      if (!pkg) throw new Error(`no package for recipient ${recipient}`);
      return pkg;
    },
    packageAt(index: number) {
      const pkg = byIndex.get(index);
      if (!pkg) throw new Error(`no package for index ${index}`);
      return pkg;
    },
  };
  treesByRoot.set(root.toLowerCase(), tree);
  return tree;
}

export function takeTreeByRoot(root: Hex): SablierMerkleTree | undefined {
  const tree = treesByRoot.get(root.toLowerCase());
  if (tree) treesByRoot.delete(root.toLowerCase());
  return tree;
}
