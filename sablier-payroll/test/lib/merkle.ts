/**
 * Sablier-compatible merkle tree builder.
 * Leaf format matches SablierMerkleBase._preProcessClaim:
 *   leaf = keccak256(bytes.concat(keccak256(abi.encode(index, recipient, amount))))
 * Tree pairing uses OpenZeppelin commutative keccak256 (Hashes.commutativeKeccak256).
 */
import {
  encodeAbiParameters,
  keccak256,
  concatHex,
  type Address,
  type Hex,
} from "viem";

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
};

export type SablierMerkleTree = {
  root: Hex;
  entries: RosterEntry[];
  packages: ClaimPackage[];
  packageFor(recipient: Address): ClaimPackage;
  packageAt(index: number): ClaimPackage;
};

function encodeLeaf(index: number, recipient: Address, amount: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint128" },
      ],
      [BigInt(index), recipient, amount]
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
  }));

  const byRecipient = new Map(packages.map((p) => [p.recipient.toLowerCase(), p]));
  const byIndex = new Map(packages.map((p) => [p.index, p]));

  return {
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
}

export { encodeLeaf };
