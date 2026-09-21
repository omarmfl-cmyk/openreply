import { handleCallback } from "@vercel/queue";
import { processDmQueueJob } from "@/lib/queue/dm-worker";
import { dmQueueRetry } from "@/lib/queue/errors";
import type { DmQueueMessage } from "@/lib/queue/client";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = handleCallback<DmQueueMessage>(processDmQueueJob, {
  visibilityTimeoutSeconds: 330,
  retry: dmQueueRetry,
});
