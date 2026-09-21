# Vercel Queues deployment

## Architecture

Signed Meta and Zernio webhooks publish typed messages using the official
`@vercel/queue` SDK to `dm-processing`. The `queue/v2beta` trigger invokes
`POST /api/queues/dm-processing` on Vercel. Its callback awaits
`processDmQueueJob(message, metadata)` and acknowledges only after processing.
Comments, inbound messages, postbacks, rate-limit requeues, read fallbacks, and
appreciation follow-ups retain their payloads and provider routing.

Neon retains campaigns, accounts, auth, tracking, usage reservations, DM logs,
delivery receipts, and reconciliation checkpoints. Redis Cloud remains for rate
limiting, operational alerts, and short reconciliation leases/deployment ownership.
Redis no longer stores queue jobs. BullMQ and the resident worker entrypoint/script
are removed. No database migration is introduced and no existing secrets change.

Follow-ups use `followUpDelayMinutes * 60` as `delaySeconds`. Retention is extended
for delayed messages so a one-day follow-up does not expire before delivery.
The existing campaign API permits delays through 1,440 minutes. The queue helper
supports delays through seven days. Delays over six days use a durable six-day
hop and then the remaining delay, preserving the target time and leaving a
delivery window before the seven-day retention limit. Retry timing remains 5 and 15 minutes, with
three total deliveries and at most five concurrent callbacks, preserving the old
worker concurrency. Unconfirmed delivery is terminal.

The existing `PostbackDelivery` table now also protects direct Meta taps, comment
sends, public replies, inbound replies, and follow-ups. Distinct button taps still
work; redelivery of the same tap does not send again. Existing `DmLog` completion
and uncertainty guards remain. Claims survive crashes; a crash during an external
send can leave an uncertain delivery that requires inbox inspection. This is
at-least-once processing with conservative duplicate prevention, not an atomic
transaction between PostgreSQL and Instagram. Confirmed provider rejections allow
retry. Successful sends are logged before publishing their follow-ups, allowing a
failed publish to retry without repeating the original DM.

## Reconciliation and recovery

`reconcile-comments` attaches pending next-reel campaigns and calls
`reconcileComments()`. After a successful sweep it stores a deterministic
`OperationalEvent` checkpoint, then publishes its successor with a five-minute
delay. A duplicate retries the checkpointed successor's same idempotency key.
A Redis lease prevents overlapping sweeps; only the seeded deployment can keep
the loop alive. Old deployments may finish their existing DM jobs but stop
rescheduling reconciliation after ownership changes.

`COMMENT_POLL_INTERVAL_MS` defaults to 300000 and sets the delay after a successful
sweep (rounded up to seconds). It must be at least 1000 and less than seven days.
`COMMENT_POLL_MAX_PER_SWEEP` and `COMMENT_POLL_LOOKBACK_HOURS` retain their existing
semantics and defaults (30 per campaign/media selection and 72 hours).
Callbacks have a 300-second maximum runtime. Monitor timeouts as campaign volume
grows; the existing per-sweep limits still bound comment ingestion.

Call the protected seed endpoint after **every promotion or rollback**, using
the production alias. The daily `08:00 UTC` cron also reseeds after outages or
message expiry. Same-bucket seeds deduplicate; subsequent buckets allow recovery.
No five-minute Vercel cron and no continuously running process are needed.

## Environment

- Use Node.js 22 or newer, with Vercel Fluid compute enabled for the 300-second callback.
- No new application secret or queue API token is required on Vercel. The SDK
  uses Vercel's automatic OIDC credentials and deployment/region metadata.
- Retain `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, provider credentials,
  auth/email variables, and `NEXTAUTH_URL` unchanged.
- Use the existing `CRON_SECRET` for automatic recovery and manual seeding.
  Manual seeding also accepts the existing `NEXTAUTH_SECRET` fallback, but Vercel
  cron authentication needs `CRON_SECRET` configured.
- Keep producers and the callback in the same Vercel function region. Preview
  testing should use isolated database/Redis/provider accounts; it can send real DMs.

## Deployment and cutover

1. On Node.js 22+, run:

   ```sh
   npm ci
   npm run db:generate
   npm run typecheck
   npm test
   npm run build
   ```

2. Before switching production publishers, account for outstanding BullMQ jobs.
   They are **not automatically transferred** to Vercel Queues. Use the old
   deployment/worker to drain waiting, active, and delayed jobs during a controlled
   cutover, or export and republish pending payloads with their remaining delays.
   Avoid discarding delayed follow-ups. Do not delete Redis data blindly.
3. Deploy this revision to the existing Vercel project using its usual Git
   deployment. Keep the `vercel-build` command and all existing secrets. The
   checked-in `vercel.json` provisions the `dm-processing` trigger/topic with the
   callback. Verify it appears in the project's Queues view after deployment.
4. Promote the tested deployment, then seed using the production alias and your
   existing secret. Example with shell variables already set privately:

   ```sh
   curl --fail --silent --show-error \
     -H "Authorization: Bearer $CRON_SECRET" \
     "$APP_URL/api/cron/reconcile-comments"
   ```

   Expect `success: true`, `mode: vercel-queue-push`, and the deployment owner.
   Do not seed by calling the queue callback directly; its Vercel trigger is
   internally invoked and protected from public traffic.
5. Confirm `/api/health` returns database/Redis OK, queue mode
   `vercel-queue-push`, and `worker.heartbeatRequired: false`. Queue health here
   describes configuration; it does **not** claim to probe Vercel backlog or
   prove delivery. Queue counts display as unavailable in diagnostics; use
   Vercel Queues observability for delivery counts, errors, and oldest message age.
6. After the old jobs are accounted for, stop/remove Deplexo or the old worker
   service. `npm run worker` is removed and no longer required.

## Acceptance tests after deployment

Use a test campaign and a second Instagram account:

1. Send a matching comment; verify one private DM, the configured public reply,
   and the corresponding `SENT` log. Replay the event; verify no duplicate send.
2. Send a matching inbound DM; test ordinary reveal and follow-gated behavior.
3. Tap the opening/follow-check button. Replay the same `mid`, then make a new
   tap; verify the replay is deduplicated while a distinct tap still works.
4. Enable a one-minute follow-up. Verify it arrives after the delay, once only.
   Test the read fallback separately with and without an open messaging window.
5. Verify these paths for both direct Meta and Zernio test connections.
6. Seed twice in one time bucket. Verify a single successful reconciliation
   checkpoint and the next delayed reconciliation message. Wait at least five
   minutes and verify the next sweep. Test next-reel attachment as well.
7. In a preview/test environment, simulate a queue publish failure after a sweep
   and a provider rate-limit rejection. Verify the same successor is retried,
   existing DMs are not repeated, and failures appear in logs/observability.
8. Promote a new deployment and reseed. Verify the old reconciliation owner
   stops rescheduling. Check the daily recovery cron is registered.

Local development: link a separate Vercel development project with `vercel link`
and `vercel env pull`, then `npm run dev`. Use isolated development credentials;
never overwrite existing production secrets. The SDK discovers consumers from
the checked-in trigger configuration. Unit tests mock queue/provider calls and
do not require production credentials.

References: [official SDK](https://vercel.com/docs/queues/sdk),
[deployment isolation](https://vercel.com/docs/queues/concepts),
[quickstart](https://vercel.com/docs/queues/quickstart).

## Files changed in this migration

- `.env.example`
- `.github/workflows/ci.yml`
- `Dockerfile`
- `README.md`
- `__tests__/dm-worker.test.ts`
- `__tests__/queue-reconciliation.test.ts`
- `__tests__/vercel-queue.test.ts`
- `app/(dashboard)/diagnostics/page.tsx`
- `app/api/admin/diagnostics/route.ts`
- `app/api/cron/reconcile-comments/route.ts`
- `app/api/health/route.ts`
- `app/api/queues/dm-processing/route.ts`
- `docs/deploy-dokploy.md`
- `docs/setup.md`
- `docs/stack.md`
- `docs/vercel-queues.md`
- `docs/zernio.md`
- `lib/ops/redis.ts`
- `lib/ops/worker-health.ts`
- `lib/polling/comment-reconciler.ts`
- `lib/queue/client.ts`
- `lib/queue/dm-worker.ts`
- `lib/queue/errors.ts`
- `lib/queue/process-webhook.ts`
- `lib/queue/reconciliation.ts`
- `package-lock.json`
- `package.json`
- `vercel.json`
- `worker/dm-worker.ts` (removed)
