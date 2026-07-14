/** Phase 2 backend adapter — implement PodPayrollBackend when porting. */
import type { ClaimPackage, SablierPayrollScenario } from "./sablier-scenario.js";
import type { ClaimResult } from "./actors.js";

export interface PayrollBackend {
  readonly name: "sablier" | "pod";
  claim(employee: string, pkg: ClaimPackage, scenario: SablierPayrollScenario): Promise<ClaimResult>;
}

export const SablierBackend: PayrollBackend = {
  name: "sablier",
  async claim(_employee, _pkg, _scenario) {
    throw new Error("use actors.Employee.claim in Phase 1");
  },
};
