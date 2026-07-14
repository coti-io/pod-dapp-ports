import { logStep } from "../../../../pod-ecosystem-integration/test/system/mpc-test-utils.js";

export function spLog(message: string): void {
  logStep(`sablier-payroll-pod: ${message}`);
}

export async function increaseTime(publicClient: { request: (args: unknown) => Promise<unknown> }, seconds: number) {
  await publicClient.request({
    method: "evm_increaseTime",
    params: [seconds],
  });
  await publicClient.request({ method: "evm_mine", params: [] });
}

export async function setNextBlockTimestamp(
  publicClient: { request: (args: unknown) => Promise<unknown> },
  timestamp: bigint
) {
  await publicClient.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(timestamp)],
  });
  await publicClient.request({ method: "evm_mine", params: [] });
}
