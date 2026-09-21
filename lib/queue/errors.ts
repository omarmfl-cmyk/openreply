export class UnrecoverableDmError extends Error {
  name = "UnrecoverableDmError";
}
export function dmQueueRetry(error: unknown, metadata: { deliveryCount: number }) {
  if (error instanceof UnrecoverableDmError || metadata.deliveryCount >= 3)
    return { acknowledge: true as const };
  return { afterSeconds: [300, 900, 2700][Math.min(Math.max(metadata.deliveryCount - 1, 0), 2)] };
}
