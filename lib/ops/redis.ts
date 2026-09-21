import Redis from "ioredis";
let connection: Redis | null = null;
export function getRedisConnection(): Redis {
  if (!connection) connection = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    commandTimeout: 5000,
  });
  return connection;
}
