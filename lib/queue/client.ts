/** Vercel Queues publishers; Redis is retained for non-queue coordination. */
import { createHash, randomUUID } from "node:crypto";
import { send } from "@vercel/queue";

export type CommentSource = "WEBHOOK" | "POLLING";

export interface ProcessCommentJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  // Set when the comment came from an ad: the organic post the ad was made
  // from. Campaigns are bound to that post, so both ids have to be matched.
  originalMediaId?: string;
  requeueAttempt?: number;
  // Which path enqueued this comment. It is not copied to ProcessedComment or
  // used for reconciliation dedup.
  source?: CommentSource;
}

// Delivered when a user taps an opening DM's button — carries the reveal target.
export interface ProcessPostbackJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
  fallback?: boolean;
}

// Scheduled after the link is delivered, to send the appreciation follow-up.
// Enqueued with a delay (followUpDelayMinutes) so it can fire later, not just
// immediately.
export interface ProcessFollowUpJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  userId: string;
  automationId: string;
  commenterName?: string | null;
}

// An inbound DM from a user. Campaigns with `dmTriggerEnabled` whose keywords
// match the text reply to the sender.
export interface ProcessMessageJob {
  accountConnectionId?: string;
  instagramAccountId: string;
  messageId: string;
  messageText: string;
  senderId: string;
}

export type DmQueueJob =
  | ProcessCommentJob
  | ProcessPostbackJob
  | ProcessFollowUpJob
  | ProcessMessageJob;

export const POSTBACK_JOB_NAME = "process-postback";
export const FOLLOWUP_JOB_NAME = "process-followup";
export const MESSAGE_JOB_NAME = "process-message";


export const DM_TOPIC = "dm-processing";
export const RECONCILE_JOB_NAME = "reconcile-comments";
export interface ReconcileCommentsJob { bucket: number; owner: string }
export type DmQueueMessage = (
  | { type: "process-comment"; data: ProcessCommentJob; jobId?: string }
  | { type: "process-postback"; data: ProcessPostbackJob; jobId?: string }
  | { type: "process-message"; data: ProcessMessageJob; jobId?: string }
  | { type: "process-followup"; data: ProcessFollowUpJob; jobId?: string }
  | { type: "reconcile-comments"; data: ReconcileCommentsJob; jobId?: string }
) & { notBefore?: number };

const MAX_DELAY_SECONDS = 7 * 24 * 60 * 60;
export async function sendDmJob<T extends DmQueueMessage["type"]>(
  type: T,
  data: Extract<DmQueueMessage, { type: T }>["data"],
  options: { delaySeconds?: number; idempotencyKey?: string } = {},
) {
  const delaySeconds = Math.ceil(options.delaySeconds ?? 0);
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0 || delaySeconds > MAX_DELAY_SECONDS) {
    throw new RangeError("Queue delay must be between zero and 7 days");
  }
  const message = { type, data, jobId: options.idempotencyKey } as DmQueueMessage;
  // At the seven-day boundary delay == TTL would leave no delivery window.
  // Use a durable six-day hop, then delay the remainder without touching a DM.
  if (delaySeconds > MAX_DELAY_SECONDS - 86400) {
    message.notBefore = Date.now() + delaySeconds * 1000;
    message.jobId ??= randomUUID();
  }
  return publishMessage(message, delaySeconds, options.idempotencyKey);
}

export function deferDmQueueJob(message: DmQueueMessage) {
  const remaining = Math.max(0, Math.ceil((message.notBefore! - Date.now()) / 1000));
  return publishMessage(message, remaining,
    `deferred:${message.jobId}:${message.notBefore}:${Math.ceil(remaining / (MAX_DELAY_SECONDS - 86400))}`);
}

function publishMessage(message: DmQueueMessage, requestedDelay: number, key?: string) {
  const delaySeconds = Math.min(requestedDelay, MAX_DELAY_SECONDS - 86400);
  return send(DM_TOPIC, message, {
    // SDK keys are limited to 256 characters; retain the original job identity
    // in the envelope while publishing a bounded, collision-resistant key.
    idempotencyKey: key
      ? createHash("sha256").update(key).digest("hex")
      : undefined,
    delaySeconds,
    retentionSeconds: Math.min(MAX_DELAY_SECONDS, Math.max(86400, delaySeconds + 86400)),
  });
}
