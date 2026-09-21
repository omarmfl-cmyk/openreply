import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/ops/redis";
import { getWorkerHealth } from "@/lib/ops/worker-health";

export const runtime = "nodejs";
// Database and Redis checks must remain live. Queue status describes execution mode,
// not an invented backlog or heartbeat for an idle push consumer.
export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error";

interface HealthCheck {
  status: CheckStatus;
  detail?: string;
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Database check failed",
    };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  try {
    const pong = await getRedisConnection().ping();
    return { status: pong === "PONG" ? "ok" : "error", detail: pong };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Redis check failed",
    };
  }
}

async function checkQueue() {
  return {
    status: "ok" as const, mode: "vercel-queue-push", topic: "dm-processing",
    statusBasis: "configuration", deliveryVerified: false,
    detail: "No resident worker required. Verify deliveries in Vercel Queues observability.",
  };
}

export async function GET() {
  const [database, redis, queue, worker] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkQueue(),
    getWorkerHealth().catch((error) => ({
      healthy: false,
      heartbeat: null,
      ageMs: null,
      error: error instanceof Error ? error.message : "Worker check failed",
    })),
  ]);

  const healthy =
    database.status === "ok" &&
    redis.status === "ok" &&
    queue.status === "ok" &&
    worker.healthy;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: {
        database,
        redis,
        queue,
        worker,
      },
    },
    { status: healthy ? 200 : 503 }
  );
}
