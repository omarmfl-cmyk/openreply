import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/ops/redis";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";
import { sendDmJob, type ReconcileCommentsJob } from "./client";

export function reconciliationIntervalMs() {
  const interval = Number(process.env.COMMENT_POLL_INTERVAL_MS ?? 300_000);
  if (!Number.isFinite(interval) || interval < 1000 || interval >= 604_800_000)
    throw new Error("COMMENT_POLL_INTERVAL_MS must be between 1000 and 604799999");
  return Math.ceil(interval / 1000) * 1000;
}

function scope() {
  return `${process.env.VERCEL_PROJECT_ID ?? "openreply"}:${process.env.VERCEL_ENV ?? "development"}`;
}
function owner() {
  return process.env.VERCEL_DEPLOYMENT_ID ?? "local";
}
const ownerKey = () => `reconciliation:owner:${scope()}`;

async function enqueue(bucket: number, deployment: string, delaySeconds: number) {
  await sendDmJob("reconcile-comments", { bucket, owner: deployment }, {
    delaySeconds,
    idempotencyKey: `reconcile:${scope()}:${deployment}:${bucket}`,
  });
}

/** Call on the promoted deployment, never during a build or a cold start. */
export async function seedReconciliation() {
  const deployment = owner();
  // Ownership is shared across deployments; a previous deployment drains but
  // cannot keep its recurring loop alive after this promotion/reseed.
  await getRedisConnection().set(ownerKey(), deployment);
  const bucket = Math.floor(Date.now() / reconciliationIntervalMs());
  await enqueue(bucket, deployment, 0);
  return { mode: "vercel-queue-push", topic: "dm-processing", bucket, owner: deployment };
}

export async function processReconciliation(data: ReconcileCommentsJob) {
  const redis = getRedisConnection();
  if (await redis.get(ownerKey()) !== data.owner || data.owner !== owner()) return;
  const lockKey = `reconciliation:lock:${scope()}`;
  const token = randomUUID();
  // Longer than the callback's 300-second maximum runtime. A crash expires the
  // lease; duplicate deliveries retry instead of starting a parallel sweep.
  if (await redis.set(lockKey, token, "PX", 330_000, "NX") !== "OK")
    throw new Error("Reconciliation already in progress");
  try {
    const interval = reconciliationIntervalMs();
    const id = `reconcile:${scope()}:${data.owner}:${data.bucket}`;
    let receipt = await prisma.operationalEvent.findUnique({ where: { id } });
    if (!receipt) {
      await attachPendingNextReels();
      await reconcileComments();
      const nextBucket = Math.max(data.bucket + 1, Math.floor(Date.now() / interval) + 1);
      // Persist the successor before publishing, so a send failure/redelivery
      // retries the SAME successor without repeating a successful sweep.
      receipt = await prisma.operationalEvent.create({ data: {
        id, source: "WORKER", level: "INFO",
        message: "Vercel Queue comment reconciliation completed",
        payload: { nextBucket, nextAt: Date.now() + interval },
      } });
    }
    const next = receipt.payload as { nextBucket: number; nextAt: number };
    if (await redis.get(ownerKey()) !== data.owner) return;
    await enqueue(next.nextBucket, data.owner, Math.max(0, Math.ceil((next.nextAt - Date.now()) / 1000)));
  } finally {
    await redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, lockKey, token);
  }
}
