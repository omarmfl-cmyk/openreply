# Stack

| Layer | Tool |
| --- | --- |
| App and API | Next.js 16, React 19, Node.js 22+ on Vercel |
| Database | Prisma 7, Neon PostgreSQL |
| Background delivery | Official @vercel/queue, dm-processing topic, queue/v2beta push callback |
| Redis Cloud | Rate limiting, operational alerts, reconciliation coordination |
| Authentication | Auth.js / NextAuth, email magic links |
| Instagram | Direct Meta or optional Zernio |
| Tests | TypeScript and Vitest |

The callback processes comments, inbound messages, postbacks, follow-ups, and reconciliation. Reconciliation attaches pending next-reel campaigns, scans for missed comments, and durably publishes its successor with a five-minute delay. Existing daily token-refresh and follower-snapshot jobs remain.

There is no resident worker process. `npm run worker`, Deplexo, and other always-on worker hosts are unnecessary. Vercel's Queues usage and function execution remain subject to the project's plan and limits.

See [deployment, environment variables, recovery, and tests](vercel-queues.md), or [provider setup](setup.md).
