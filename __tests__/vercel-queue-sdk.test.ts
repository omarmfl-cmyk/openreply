import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueueClient, UnauthorizedError } from "@vercel/queue";

// Exercise the installed SDK; only the HTTP boundary is simulated.
// These tests verify SDK response handling, not live service deduplication.
const http = vi.fn<typeof fetch>();
const queue = new QueueClient({ token: "test-token", deploymentId: null, region: "iad1" });

beforeEach(() => {
  http.mockReset();
  vi.stubGlobal("fetch", http);
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(["first", "second"])("accepts repeated keys and passes through server ID %s", async (duplicateId) => {
  // 0.6.0 SendOptions documents accepted repeats; the service deduplicates
  // delivery out-of-band, so a duplicate need not return the original ID.
  http.mockResolvedValueOnce(Response.json({ messageId: "first" }, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ messageId: duplicateId }, { status: 201 }));
  const options = { idempotencyKey: "same-key" };
  await expect(queue.send("test-topic", { value: 1 }, options)).resolves.toEqual({ messageId: "first" });
  await expect(queue.send("test-topic", { value: 1 }, options)).resolves.toEqual({ messageId: duplicateId });
  expect(http).toHaveBeenCalledTimes(2);
  for (const [, init] of http.mock.calls) {
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Vqs-Idempotency-Key")).toBe("same-key");
  }
});

it("returns null for HTTP 202 deferred acceptance", async () => {
  http.mockResolvedValueOnce(new Response(null, { status: 202 }));
  await expect(queue.send("test-topic", {})).resolves.toEqual({ messageId: null });
});

it.each(["conflict", JSON.stringify({ originalMessageId: "first" })])("throws an unstructured Error for publish-time 409 body %s", async (body) => {
  http.mockResolvedValueOnce(new Response(body, { status: 409 }));
  const error = await queue.send("test-topic", {}, { idempotencyKey: "same-key" }).catch(error => error);
  expect(error.constructor).toBe(Error);
  expect(error.message).toBe(body);
  expect(error).not.toHaveProperty("status");
  expect(error).not.toHaveProperty("code");
  expect(error).not.toHaveProperty("originalMessageId");
});

it("preserves structured authentication failures", async () => {
  http.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
  await expect(queue.send("test-topic", {})).rejects.toBeInstanceOf(UnauthorizedError);
});

it("propagates transport failures unchanged", async () => {
  const error = new Error("connection failed");
  http.mockRejectedValueOnce(error);
  await expect(queue.send("test-topic", {})).rejects.toBe(error);
});
