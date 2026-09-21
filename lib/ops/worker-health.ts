import { getRedisConnection } from "@/lib/ops/redis";

const WORKER_ALERTS_KEY = "alerts:worker:dm";

export interface WorkerHeartbeat {
  status: "running";
  worker: "dm";
  pid: number;
  hostname?: string;
  startedAt?: string;
  checkedAt: string;
}

export interface WorkerHealth {
  mode: "vercel-queue-push";
  heartbeatRequired: false;
  detail: string;
  healthy: boolean;
  heartbeat: WorkerHeartbeat | null;
  ageMs: number | null;
}

export interface WorkerAlert {
  level: "warning" | "error";
  message: string;
  jobId?: string;
  instagramAccountId?: string;
  commentId?: string;
  createdAt: string;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function getWorkerHealth(): Promise<WorkerHealth> {
  return {
    healthy: true, heartbeat: null, ageMs: null,
    mode: "vercel-queue-push", heartbeatRequired: false,
    detail: "Managed push callbacks; delivery health and backlog are available in Vercel Queues observability.",
  };
}

export async function recordWorkerAlert(alert: Omit<WorkerAlert, "createdAt">) {
  const payload: WorkerAlert = {
    ...alert,
    createdAt: new Date().toISOString(),
  };

  const redis = getRedisConnection();
  await redis.lpush(WORKER_ALERTS_KEY, JSON.stringify(payload));
  await redis.ltrim(WORKER_ALERTS_KEY, 0, 24);
}

export async function getWorkerAlerts(limit = 10): Promise<WorkerAlert[]> {
  const values = await getRedisConnection().lrange(
    WORKER_ALERTS_KEY,
    0,
    Math.max(0, limit - 1)
  );

  return values
    .map((value) => parseJson<WorkerAlert>(value))
    .filter((value): value is WorkerAlert => Boolean(value));
}
