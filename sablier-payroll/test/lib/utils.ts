export function logStep(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export function spLog(message: string): void {
  logStep(`sablier-payroll: ${message}`);
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
