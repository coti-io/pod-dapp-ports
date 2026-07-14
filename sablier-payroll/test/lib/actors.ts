import type { Address, Hex } from "viem";
import type { ClaimPackage, SablierPayrollScenario } from "./sablier-scenario.js";
import { spLog } from "./utils.js";

export type ClaimResult = {
  txHash: Hex;
  receipt: { status: string };
};

export class Employer {
  constructor(private readonly s: SablierPayrollScenario) {}

  async mintAndFund(campaignAddress: Address, amount: bigint): Promise<void> {
    spLog(`employer funds campaign ${campaignAddress} with ${amount}`);
    await this.s.token.write.mint([this.s.employer.address, amount], {
      account: this.s.employer.address,
    });
    await this.s.token.write.transfer([campaignAddress, amount], {
      account: this.s.employer.address,
    });
  }
}

export class Employee {
  constructor(
    private readonly s: SablierPayrollScenario,
    private readonly account: SablierPayrollScenario["alice"]
  ) {}

  get address() {
    return this.account.address;
  }

  /** UI: preview claim package (salary visible in public Sablier model). */
  viewPackage(pkg: ClaimPackage): { salary: bigint; index: number } {
    spLog(`UI shows employee ${this.account.label} can claim ${pkg.amount} at index ${pkg.index}`);
    return { salary: pkg.amount, index: pkg.index };
  }

  /** UI: quote min protocol fee (Sablier comptroller). */
  async quoteClaimFee(campaign: SablierPayrollScenario["campaign"]): Promise<bigint> {
    const fee = (await campaign.read.calculateMinFeeWei()) as bigint;
    spLog(`UI fee quote: ${fee} wei`);
    return fee;
  }

  async claim(pkg: ClaimPackage, campaign: SablierPayrollScenario["campaign"]): Promise<ClaimResult> {
    spLog(`employee ${this.account.label} submits claim index=${pkg.index} amount=${pkg.amount}`);
    const fee = await this.quoteClaimFee(campaign);
    const hash = await campaign.write.claim(
      [BigInt(pkg.index), pkg.recipient, pkg.amount, pkg.proof],
      {
        account: this.account.address,
        value: fee,
      }
    );
    const receipt = await this.s.publicClient.waitForTransactionReceipt({ hash });
    spLog(`employee ${this.account.label} claim mined status=${receipt.status}`);
    return { txHash: hash, receipt };
  }

  async claimTo(
    pkg: ClaimPackage,
    to: Address,
    campaign: SablierPayrollScenario["campaign"]
  ): Promise<ClaimResult> {
    spLog(`employee ${this.account.label} claimTo ${to} index=${pkg.index}`);
    const fee = await this.quoteClaimFee(campaign);
    const hash = await campaign.write.claimTo(
      [BigInt(pkg.index), to, pkg.amount, pkg.proof],
      {
        account: this.account.address,
        value: fee,
      }
    );
    const receipt = await this.s.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash, receipt };
  }

  async readTokenBalance(): Promise<bigint> {
    return (await this.s.token.read.balanceOf([this.account.address])) as bigint;
  }

  /** UI: employee sends payroll tokens to another wallet (standard ERC20 transfer). */
  async transfer(to: Address, amount: bigint): Promise<Hex> {
    spLog(`employee ${this.account.label} transfers ${amount} to ${to}`);
    return this.s.token.write.transfer([to, amount], { account: this.account.address });
  }

  /** UI: employee approves a spender (e.g. exchange, payroll card, DeFi router). */
  async approve(spender: Address, amount: bigint): Promise<Hex> {
    spLog(`employee ${this.account.label} approves ${spender} for ${amount}`);
    return this.s.token.write.approve([spender, amount], { account: this.account.address });
  }

  async readAllowance(spender: Address): Promise<bigint> {
    return (await this.s.token.read.allowance([this.account.address, spender])) as bigint;
  }
}

export class Admin {
  constructor(private readonly s: SablierPayrollScenario) {}

  async clawback(
    campaign: SablierPayrollScenario["campaign"],
    to: Address,
    amount: bigint
  ): Promise<Hex> {
    spLog(`admin clawback ${amount} to ${to}`);
    return campaign.write.clawback([to, amount], { account: this.s.admin.address });
  }
}

export function employee(s: SablierPayrollScenario, who: "alice" | "bob" | "carol"): Employee {
  return new Employee(s, s[who]);
}

export function employer(s: SablierPayrollScenario): Employer {
  return new Employer(s);
}

export function admin(s: SablierPayrollScenario): Admin {
  return new Admin(s);
}
