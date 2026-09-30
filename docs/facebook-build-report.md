# Facebook build report

Completed locally on September 30, 2026. External staging setup, deployment, and live acceptance testing were intentionally not performed. See [manual staging guide](facebook-staging.md).

## 1–4. Branch, baseline, status, commits

- Branch: `facebook-support`.
- Starting commit: `c960b3127a859f0e29e3a19a728f652e0565030c`.
- `git fetch origin` succeeded before implementation; `origin/main` and local `main` matched the required starting commit. No push or merge was performed.
- Unrelated initial working changes were preserved and excluded from every commit:

```text
 M .env.example
 M __tests__/vercel-queue.test.ts
?? __tests__/queue-deduplication.test.ts
```

Those three entries are the expected final working-tree status after committing this report. They are user changes, not Facebook deliverables.

Local commits, in order:

| Commit | Description |
|---|---|
| `8427d80` | Add isolated Page, campaign, and delivery models |
| `b3f7936` | Add staging-only Page OAuth connection |
| `e7bd6b0` | Dispatch Page webhooks to isolated queue processing |
| `a36945c` | Add campaign platform selection and delivery logs |
| `006d293` | Keep Facebook-only conversion selection consistent |
| `7008191` | Cover isolation, delivery, and additive migration |
| Documentation commit containing this file | Staging setup guide and build report; final hash supplied in the handoff |

## 5. Files changed by this work

```text
app/(dashboard)/campaigns/facebook/[id]/edit/page.tsx
app/(dashboard)/campaigns/page.tsx
app/(dashboard)/logs/page.tsx
app/(dashboard)/settings/page.tsx
app/api/automations/route.ts
app/api/facebook/callback/route.ts
app/api/facebook/campaigns/route.ts
app/api/facebook/connect/route.ts
app/api/facebook/logs/route.ts
app/api/facebook/pages/route.ts
app/api/queues/facebook-comments/route.ts
app/api/webhook/route.ts
components/campaign-builder.tsx
components/facebook-campaign-list.tsx
components/facebook-campaign.tsx
components/facebook-connection.tsx
components/facebook-logs.tsx
lib/facebook/auth.ts
lib/facebook/campaigns.ts
lib/facebook/client.ts
lib/facebook/config.ts
lib/facebook/queue.ts
lib/facebook/webhook.ts
prisma/migrations/20260930090000_facebook_support/migration.sql
prisma/schema.prisma
vercel.json
__tests__/facebook-auth.test.ts
__tests__/facebook-campaign-api.test.ts
__tests__/facebook-client.test.ts
__tests__/facebook-dispatch.test.ts
__tests__/facebook-migration.test.ts
__tests__/facebook.test.ts
scripts/check-facebook-isolated.mjs
docs/facebook-staging.md
docs/facebook-build-report.md
```

No package/lockfile change or dependency installation was needed.

## 6–7. Schema and SQL

Four new tables: `FacebookPage` (workspace, selected Page, encrypted token, expiry and disconnect state); `FacebookCampaign` (Facebook-only configuration and optional link to an Instagram Automation); `FacebookDelivery` (comment identity plus independent public/private status, errors and reply IDs); `FacebookPrivateClaim` (durable one-private-attempt-per-Page/comment marker).

New enum `FacebookReplyStatus`: PENDING, UNCONFIRMED, SENT, FAILED, SKIPPED. New unique keys enforce Page ownership, at most one Facebook companion per Automation, and Page/campaign/comment deduplication. New lookup indexes and foreign keys belong only to new tables. The optional `FacebookCampaign.automationId` foreign key uses `ON DELETE SET NULL`; no existing Instagram foreign key becomes nullable. Workspace and Automation gain Prisma relation metadata only, without new SQL columns on old tables. `InstagramAccount` and `DmLog` are unchanged.

Migration SQL contains one CREATE TYPE, four CREATE TABLEs, seven CREATE INDEXes, and six ALTER TABLE statements adding foreign keys **to Facebook tables only**. There are no existing-table column alterations or data writes/deletes. It was generated with schema-to-schema diff and applied only inside an in-memory PGlite test. No remote database migration was run. Future application still requires ordinary staging review: foreign-key creation can acquire locks on referenced tables even with additive SQL.

## 8–12. Meta and staging configuration

Permissions: `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `pages_messaging`.

New staging variables: `OPENREPLY_ENV=staging`, `FACEBOOK_AUTOMATION_ENABLED=true`, `FACEBOOK_PAGE_APP_ID`, `FACEBOOK_PAGE_APP_SECRET`, `FACEBOOK_PAGE_WEBHOOK_VERIFY_TOKEN`, `FACEBOOK_PAGE_GRAPH_API_VERSION=v26.0`. The staging project also needs its own database, Redis, encryption/auth/cron secrets, email configuration, and `NEXTAUTH_URL`. Exact variable instructions and official Meta sources are in the [staging guide](facebook-staging.md#staging-environment).

OAuth callback: `https://<staging-host>/api/facebook/callback`. Webhook: `https://<staging-host>/api/webhook`. Configure Page object `feed` at app level; Page selection subscribes `/{page-id}/subscribed_apps` to `feed`. No change to the production Instagram webhook or app is needed or made.

## 13–16. Exact validation results

| Check | Result |
|---|---|
| Baseline `npm test`, before Facebook changes | Exit 0; **30 passed files, 1 skipped (31); 315 passed tests, 12 skipped (327)**; 2.21 s |
| Final `npm test` | Exit 0; **36 passed files, 1 skipped (37); 382 passed tests, 12 skipped (394)**; 4.82 s; start 09:26:26 |
| `npm run typecheck` | Exit 0; no TypeScript errors |
| Prisma generate | Exit 0; Prisma Client **7.8.0** generated locally; final build generation 479 ms |
| `node scripts/check-facebook-isolated.mjs` → `npm run build` | Exit 0; Next.js **16.2.6** Turbopack; compilation 7.5 s, TypeScript 10.0 s, **63/63** static pages in 683 ms |
| `npm run lint` | Exit 0; no ESLint warnings/errors |
| `git diff --check` | Exit 0; no whitespace errors; Git emitted only its Windows LF→CRLF advisory |

Build warnings: QueueClient could not detect a local region and defaulted to `iad1`; no failure. The isolation script supplies dummy values and nonfunctional local database/Redis targets, overriding root `.env*` values in the child process only. Next reports the presence of `.env.local`, but usable credentials from it are suppressed; the file is not edited. Build performs generation/compilation, not migration or deployment.

The 12 skipped tests are the pre-existing opt-in `tracked-link-order.db.test.ts` suite, skipped because `TEST_DATABASE_URL` was not supplied. They were also skipped at baseline. No existing test regression remains. Two new test type errors and one new UI lint issue found during development were corrected before final verification.

The 67 added checks cover the requested acceptance cases:

| Requested cases | Evidence |
|---|---|
| 1–3: Instagram/Page/unknown dispatch | `facebook-dispatch.test.ts`, including both verification tokens and cross-app signature rejection |
| 4–5: existing Instagram comments/DM | Full original suite remains green; original processor, worker, and queue client unchanged |
| 6–10: keyword match/nonmatch, self-comment, unconnected Page, workspace isolation | `facebook.test.ts`, `facebook-auth.test.ts`, `facebook-campaign-api.test.ts` |
| 11–12: duplicate webhooks/comments | Concurrent/repeated worker tests, queue acceptance variations, SQL unique constraints/atomic claim; cross-campaign private claim |
| 13–16: public/private success/failure/eligibility | `facebook.test.ts` plus HTTP request-contract tests in `facebook-client.test.ts`; terminal failures and ambiguous outcomes are not resent |
| 17–18: independent disconnect | Auth route tests and database migration/lifecycle test |
| 19–20: old campaign validity and data preservation | `facebook-migration.test.ts` applies historical migrations, seeds old records, applies new SQL, compares every seeded old row and column definition, then executes old writes |

Meta/Queue boundaries were mocked; PGlite executed migration SQL entirely in memory. No real Facebook replies were sent, no production token was used, and no remote database was contacted for these tests. UI browser testing and actual staged OAuth/Queue/API interoperability are still manual acceptance work.

## 17–18. Existing Instagram/shared files changed, and why

| Existing file | Exact purpose of the change |
|---|---|
| `app/api/webhook/route.ts` | Adds Page-only secret/verification/dispatch; preserves the original Instagram signature/parser/processor flow; unknown objects cannot reach the Instagram processor |
| `app/api/automations/route.ts` | Optional, staging-gated Facebook companion reads/atomic creates/edits and Both pause/delete lifecycle; legacy Instagram payloads remain valid |
| `components/campaign-builder.tsx` | Staging-gated platform selector, independent Facebook fields/editor, optional Both payload; existing Instagram account selector and configuration remain |
| `app/(dashboard)/settings/page.tsx` | Adds Facebook connection section beside the existing Instagram section |
| `app/(dashboard)/campaigns/page.tsx` | Adds separately labeled Facebook/Both campaign panel |
| `app/(dashboard)/logs/page.tsx` | Adds separately labeled Facebook delivery logs |
| `prisma/schema.prisma` | New Facebook models/enum and relation metadata on Workspace/Automation; no existing scalar-column change |
| `vercel.json` | Adds separate Facebook queue trigger; existing Instagram trigger and crons remain unchanged |

Existing `lib/meta/oauth.ts` token encryption and `lib/utils/keyword-matcher.ts` matching are reused without edits. `lib/meta/webhook.ts`, `lib/queue/process-webhook.ts`, `lib/queue/client.ts`, `lib/queue/dm-worker.ts`, Instagram auth/disconnect routes, and the existing queue callback are unchanged. No generic social architecture, renamed Instagram model/function/job, BullMQ worker, or Queue SDK behavior change was introduced.

## 19–21. Risks, manual setup, and test plan

Follow the [staging setup and acceptance plan](facebook-staging.md). Remaining limits: Meta permissions/review and Page tasks must be satisfied; test app access is restricted; private replies depend on Meta eligibility; short-lived/revoked Page tokens require reconnection; in-flight requests can finish around a disconnect; ambiguous delivery is intentionally not retried and can miss a send; infrastructure failures can leave pending rows after retry exhaustion. Multiple campaigns can each send public replies, while only one private attempt is allowed. Disconnect is local and leaves the external Page subscription intact. Facebook messages are plain text; no follow-up Messenger conversation, automatic reconciliation, token refresh, or bulk backfill was added.

These are reviewed local code and tests, not a claim of live staging or production readiness. The new feature is restricted to explicitly enabled staging. A future production rollout requires a separate decision and review.

## 22. Production confirmation

- **Main untouched:** no commit, merge, or push to main; its local ref and fetched origin/main remain the required baseline.
- **Production Vercel untouched:** no deployment, project configuration, environment, queue, or cron change.
- **Production Neon untouched:** no query, data change, or migration run against it.
- **Production Meta app untouched:** no app, permission, webhook, token, or subscription configuration changed.
- **Current Instagram deployment untouched:** no production Instagram disconnect or deployment action was performed.
- Existing production secrets and environment files were not changed or rotated. Unrelated local changes were preserved. Production runtime health was not independently monitored; the confirmation above describes the actions performed, not an external uptime measurement.
