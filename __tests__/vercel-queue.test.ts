import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@vercel/queue", () => ({ send: mocks.send }));
import { sendDmJob, deferDmQueueJob } from "@/lib/queue/client";
import { dmQueueRetry, UnrecoverableDmError } from "@/lib/queue/errors";
import { getWorkerHealth } from "@/lib/ops/worker-health";

beforeEach(() => { mocks.send.mockReset().mockResolvedValue({ messageId: "m1" }); });

describe("Vercel queue publisher", () => {
  it("preserves a follow-up payload and leaves retention time after the delay", async () => {
    const data = { instagramAccountId: "ig", accountConnectionId: "connection", userId: "u", automationId: "a", commenterName: "Name" };
    await sendDmJob("process-followup", data, { delaySeconds: 1440 * 60, idempotencyKey: "followup_a_u" });
    expect(mocks.send).toHaveBeenCalledWith("dm-processing", {
      type: "process-followup", data, jobId: "followup_a_u",
    }, {
      delaySeconds: 86400, retentionSeconds: 172800,
      idempotencyKey: createHash("sha256").update("followup_a_u").digest("hex"),
    });
  });
  it("rounds delays up and accepts the SDK's deferred success response", async () => {
    mocks.send.mockResolvedValue({ messageId: null });
    await expect(sendDmJob("reconcile-comments", { bucket: 1, owner: "d" }, { delaySeconds: 1.2 }))
      .resolves.toEqual({ messageId: null });
    expect(mocks.send.mock.calls[0][2].delaySeconds).toBe(2);
  });
  it("propagates publish failures so the caller can retry", async () => {
    mocks.send.mockRejectedValue(new Error("unavailable"));
    await expect(sendDmJob("reconcile-comments", { bucket: 1, owner: "d" })).rejects.toThrow("unavailable");
  });
  it("supports seven-day delays without expiring at the delivery boundary", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000000);
    try {
      await sendDmJob("process-followup", { instagramAccountId: "ig", userId: "u", automationId: "a" },
        { delaySeconds: 604800, idempotencyKey: "followup_a_u" });
      const message = mocks.send.mock.calls[0][1];
      expect(mocks.send.mock.calls[0][2]).toMatchObject({ delaySeconds: 518400, retentionSeconds: 604800 });
      clock.mockReturnValue(1000000 + 518400000);
      await deferDmQueueJob(message);
      expect(mocks.send.mock.calls[1][1]).toEqual(message);
      expect(mocks.send.mock.calls[1][2]).toMatchObject({ delaySeconds: 86400, retentionSeconds: 172800 });
    } finally { clock.mockRestore(); }
  });
  it.each([-1, Infinity, 604801])("rejects unusable delays: %s", async delaySeconds => {
    await expect(sendDmJob("reconcile-comments", { bucket: 1, owner: "d" }, { delaySeconds })).rejects.toThrow(RangeError);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

it("preserves retry delays and acknowledges uncertain delivery", () => {
  expect(dmQueueRetry(new Error(), { deliveryCount: 1 })).toEqual({ afterSeconds: 300 });
  expect(dmQueueRetry(new Error(), { deliveryCount: 2 })).toEqual({ afterSeconds: 900 });
  expect(dmQueueRetry(new Error(), { deliveryCount: 3 })).toEqual({ acknowledge: true });
  expect(dmQueueRetry(new UnrecoverableDmError(), { deliveryCount: 1 })).toEqual({ acknowledge: true });
});

it("does not require a resident worker heartbeat", async () => {
  expect(await getWorkerHealth()).toMatchObject({ healthy: true, mode: "vercel-queue-push", heartbeatRequired: false, heartbeat: null });
});
