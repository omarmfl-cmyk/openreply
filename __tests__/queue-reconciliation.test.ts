import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  redis: { get: vi.fn(), set: vi.fn(), eval: vi.fn() },
  events: { findUnique: vi.fn(), create: vi.fn() },
  send: vi.fn(), reconcile: vi.fn(), attach: vi.fn(),
}));
vi.mock("@/lib/ops/redis", () => ({ getRedisConnection: () => mocks.redis }));
vi.mock("@/lib/db/client", () => ({ prisma: { operationalEvent: mocks.events } }));
vi.mock("@/lib/queue/client", () => ({ sendDmJob: mocks.send }));
vi.mock("@/lib/polling/comment-reconciler", () => ({ reconcileComments: mocks.reconcile }));
vi.mock("@/lib/automation/attach-next-reel", () => ({ attachPendingNextReels: mocks.attach }));
import { processReconciliation, seedReconciliation } from "@/lib/queue/reconciliation";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_DEPLOYMENT_ID", "new-deployment");
  vi.stubEnv("COMMENT_POLL_INTERVAL_MS", "300000");
  vi.spyOn(Date, "now").mockReturnValue(3_000_000);
  mocks.redis.get.mockResolvedValue("new-deployment");
  mocks.redis.set.mockResolvedValue("OK");
  mocks.events.findUnique.mockResolvedValue(null);
  mocks.events.create.mockImplementation(async ({ data }) => data);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const job = { bucket: 10, owner: "new-deployment" };

it("attaches new reels, reconciles, checkpoints, then schedules in five minutes", async () => {
  await processReconciliation(job);
  expect(mocks.attach).toHaveBeenCalledOnce();
  expect(mocks.reconcile).toHaveBeenCalledOnce();
  expect(mocks.send).toHaveBeenCalledWith("reconcile-comments", { bucket: 11, owner: job.owner }, expect.objectContaining({ delaySeconds: 300 }));
  expect(mocks.events.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
});

it("retries the checkpointed successor after publish failure without repeating a sweep", async () => {
  mocks.send.mockRejectedValueOnce(new Error("publish failed"));
  await expect(processReconciliation(job)).rejects.toThrow("publish failed");
  mocks.events.findUnique.mockResolvedValue(mocks.events.create.mock.calls[0][0].data);
  await processReconciliation(job);
  expect(mocks.reconcile).toHaveBeenCalledOnce();
  expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1]);
});

it("does not create a second loop from a duplicate delivery", async () => {
  await processReconciliation(job);
  mocks.events.findUnique.mockResolvedValue(mocks.events.create.mock.calls[0][0].data);
  await processReconciliation(job);
  expect(mocks.reconcile).toHaveBeenCalledOnce();
  expect(mocks.send.mock.calls[0][2].idempotencyKey).toBe(mocks.send.mock.calls[1][2].idempotencyKey);
});

it("does not reschedule when a newer deployment owns the loop", async () => {
  mocks.redis.get.mockResolvedValue("newer-deployment");
  await processReconciliation(job);
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("retries concurrent sweeps and failed sweeps without scheduling successors", async () => {
  mocks.redis.set.mockResolvedValueOnce(null);
  await expect(processReconciliation(job)).rejects.toThrow("already in progress");
  mocks.reconcile.mockRejectedValue(new Error("database down"));
  await expect(processReconciliation(job)).rejects.toThrow("database down");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.events.create).not.toHaveBeenCalled();
});

it("uses the same seed key in a time bucket and supports a fresh bucket after failure", async () => {
  await seedReconciliation();
  await seedReconciliation();
  expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1]);
  vi.mocked(Date.now).mockReturnValue(3_300_000);
  await seedReconciliation();
  expect(mocks.send.mock.calls[2][1].bucket).toBe(11);
});

it("honors the configured interval", async () => {
  vi.stubEnv("COMMENT_POLL_INTERVAL_MS", "600000");
  await processReconciliation(job);
  expect(mocks.send.mock.calls[0][2].delaySeconds).toBe(600);
});
