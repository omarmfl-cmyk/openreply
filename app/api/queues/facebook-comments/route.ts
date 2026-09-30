import { handleCallback } from '@vercel/queue';
import { processFacebookJob, type FacebookJob } from '@/lib/facebook/queue';
import { dmQueueRetry } from '@/lib/queue/errors';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const POST = handleCallback<FacebookJob>(processFacebookJob, {
  visibilityTimeoutSeconds: 330, retry: dmQueueRetry,
});
