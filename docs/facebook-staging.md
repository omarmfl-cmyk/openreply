# Facebook staging setup — manual only

Built on `facebook-support` from `c960b3127a859f0e29e3a19a728f652e0565030c`. Nothing here has been deployed or configured externally. These instructions are for a **separate staging project**, never the existing production project. The implementation requires both `OPENREPLY_ENV=staging` and `FACEBOOK_AUTOMATION_ENABLED=true`; it is off by default.

## Resources to create manually

1. Create a separate Vercel project and stable HTTPS staging hostname. Do not link this working folder to the production project or change its settings. Before publishing this branch anywhere, ensure that doing so cannot trigger builds in the existing production-linked project using production credentials. A separate staging repository/project connection avoids that risk. This task did not push the branch.
2. Create a fresh, empty Neon staging database. Prefer an empty database to a production branch containing real account tokens or personal data. If using a branch, its database and data must be isolated and contain test accounts only.
3. Create separate Redis and email test resources for the existing application's supporting features. Use staging-only login identities. Do not copy the production environment wholesale.
4. Create a separate Meta test/development app with Facebook Login and the Page/Messenger capabilities required below. Create a dedicated Facebook test Page and grant the test administrator the appropriate Page tasks. Add test people to the app's roles. Use only test Pages and people for sends.
5. Set the staging-only environment below in the new project. Keep existing production secrets and `.env.local` unchanged. Use a separate shell/checkout with explicit staging configuration for migration and deployment.
6. Verify the database host and database name are the new staging database before manually running `npx prisma migrate deploy`. The migration is committed at `prisma/migrations/20260930090000_facebook_support/migration.sql`. It has only been exercised in an in-memory database here. **The repository's existing `vercel-build` script already runs `prisma migrate deploy`**: verify the staging database target before the first staging build as well.
7. Manually deploy to the new staging project. Verify its queue trigger is installed for topic `facebook-comments`, route `/api/queues/facebook-comments`, with the existing `queue/v2beta` integration. This is a separate topic from `dm-processing`. Leave the old project's queue and crons untouched.
8. Configure the test Meta app's OAuth redirect and Page webhook below. Webhooks need to reach the staging endpoint without an interactive Vercel login barrier; configure access only on the new staging project. Then log in to staging, open Settings → Facebook Pages → Connect Facebook Page, authorize permissions, and select the test Page. Saving the selection subscribes that Page to `feed` through the test app.

## Staging environment

| Variable | Value in the new staging project |
|---|---|
| `OPENREPLY_ENV` | `staging` |
| `FACEBOOK_AUTOMATION_ENABLED` | `true` |
| `FACEBOOK_PAGE_APP_ID` | Separate test Meta app ID |
| `FACEBOOK_PAGE_APP_SECRET` | Separate test Meta app secret; also authenticates Page webhook signatures |
| `FACEBOOK_PAGE_WEBHOOK_VERIFY_TOKEN` | New random staging Page verification token |
| `FACEBOOK_PAGE_GRAPH_API_VERSION` | `v26.0` (also the code default) |
| `NEXTAUTH_URL` | `https://<staging-host>` |
| `DATABASE_URL` | New staging Neon connection string |
| `REDIS_URL` | Separate staging Redis connection string |
| `ENCRYPTION_KEY` | New staging-only 32-byte key encoded as 64 hexadecimal characters |
| `NEXTAUTH_SECRET` | New staging-only authentication secret |
| `CRON_SECRET` | New staging-only cron secret |
| `EMAIL_FROM` | Authorized test sender |
| `RESEND_API_KEY` or `EMAIL_SERVER` | Test email credentials; `EMAIL_SERVER` selects SMTP |
| `ALLOWED_EMAILS` | Recommended: comma-separated test login addresses |

For Instagram regression tests on staging only, supply separate test values for the existing `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_SECRET`, and `WEBHOOK_VERIFY_TOKEN`, using an isolated Instagram test account/app. Keep the existing production values unchanged. The new Page integration never uses `FACEBOOK_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, or the existing Instagram Graph version setting.

Do not put any secret in a `NEXT_PUBLIC_` variable. Vercel supplies deployment-scoped Queue credentials; do not copy a production queue credential. No new npm dependency or worker service is needed.

## Meta configuration and verified API contract

- OAuth redirect: `https://<staging-host>/api/facebook/callback` (exact match in Facebook Login settings).
- Webhook callback: `https://<staging-host>/api/webhook`.
- Verify token: the new `FACEBOOK_PAGE_WEBHOOK_VERIFY_TOKEN`.
- Webhook object: **Page** (`object: "page"`); subscribe to **`feed`**. App-level webhook configuration and Page-level `/{page-id}/subscribed_apps` subscription are both needed. The latter is performed when a Page is saved in staging. Inbound `messages`/`messaging_postbacks` subscriptions are not used by this implementation.
- Required OAuth permissions requested and checked: `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `pages_messaging`.
- The test person needs Page access/tasks that permit moderation, messaging, and subscription management. Permission grants alone do not override missing Page tasks. Development/Standard Access is restricted to eligible app-role testers; wider access requires Meta's applicable review/access requirements, handled manually.
- Discovery: paginated `GET /me/accounts` with `id,name,access_token,tasks`; chosen Page token is validated against the test app and encrypted before storage. Temporary user authorization is encrypted in a ten-minute HttpOnly cookie bound to the user/workspace/state.
- Public reply: `POST /{comment-id}/comments` with `message`, authorized by the Page token.
- Private reply: `POST /{page-id}/messages` with `recipient.comment_id` and `message.text`, authorized by the Page token. This is a private reply to the comment, not an unsolicited send to its author ID.
- Meta permits only one private reply to an eligible comment within seven days. A comment by another Page is not eligible. Subsequent conversation rules are separate and are not implemented here. An API rejection is terminal and logged with its code/subcode; it never creates an endless retry loop.

Official sources checked during implementation (September 30, 2026):

- [Page discovery and authorization](https://developers.facebook.com/documentation/pages-api/getting-started)
- [Access tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens)
- [Page webhook setup](https://developers.facebook.com/documentation/pages-api/webhooks-for-pages)
- [Page webhook reference](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/)
- [Public comment replies](https://developers.facebook.com/docs/graph-api/reference/object/comments)
- [Private replies, eligibility, and request shape](https://developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies)
- [Authoritative permissions catalog](https://developers.facebook.com/docs/permissions)
- [Vercel Queues](https://vercel.com/docs/queues)

Some Meta narrative pages contain inconsistent permission spellings; the implementation uses the names in the permissions catalog above, including `pages_read_user_content`.

## Campaign and delivery behavior

Create a campaign and choose Instagram, Facebook, or Both. Instagram's existing account/post/message controls stay intact. Facebook has its own Page, all-posts/specific `PageID_PostID`, keywords, whole-word option, optional public reply and optional private reply. Replies are plain text; include full links explicitly. Both saves the Instagram campaign and its Facebook companion atomically. The original Stop/Resume action controls both; the Facebook checkbox can pause just its companion. A saved Facebook-only campaign can attach to an existing Instagram campaign through its edit screen.

Switching Both to Instagram pauses and detaches the Facebook companion, retaining its logs. Switching an existing Instagram campaign to Facebook-only pauses that Instagram campaign. Deleting a Both campaign pauses the retained Facebook companion. Disconnecting Instagram independently does not disable Facebook; the nullable link lives only on the new Facebook table. Existing Instagram duplication/import continues to operate on Instagram; it does not silently clone Facebook settings.

Facebook disconnect clears that Page's stored token and disables processing locally; it preserves delivery history and deduplication records. It does not revoke the user's app authorization or remove the external Page subscription. Remove the test subscription manually if no longer wanted. Reconnecting refreshes `connectedAt`, invalidates older queued jobs, and ignores comments predating connection. Previously active campaigns can receive new comments after reconnection.

Deduplication uses a durable Page/campaign/comment unique key plus an atomic claim for each public/private channel. A second durable Page/comment claim prevents two campaigns from attempting the same private reply. Multiple matching campaigns may each send a public reply. Avoid overlapping campaigns if that is unwanted.

Delivery states are `PENDING`, `UNCONFIRMED`, `SENT`, `FAILED`, and `SKIPPED`, separately for public/private. A send is claimed before HTTP. A timeout, process crash, or missing response ID remains `UNCONFIRMED` and is never resent automatically. This favors avoiding duplicates over guaranteed delivery: a crash after claiming but before HTTP can miss a reply. Investigate the Page/Messenger history before any manual intervention; do not reset an ambiguous row to `PENDING`. Infrastructure/database failures can exhaust the queue's three deliveries and leave work pending; monitor staging logs and investigate such rows. There is no automatic reconciliation or resend UI.

Page token expiry/data-access expiry is stored and shown; expired tokens prevent sends. Tokens may be revoked early. There is no long-lived user-token exchange or automatic Facebook token renewal in this first version; reconnect when necessary. Test the actual token lifetime before scheduling a long staging soak.

## Manual staging acceptance plan

All actions below use staging test accounts and resources only. Real OAuth, browser interaction, live Queue delivery, and live Meta sends remain unverified until these steps are completed.

1. Confirm staging deployment/database/app IDs, log in, and connect only the test Page. Check the Page name and expiry display. Deny a permission once and verify a clear failure; reconnect successfully.
2. Create Facebook-only public+private campaign for keyword `link`. Have a different app-role test person comment `link` on the test Page. Confirm one public reply, one permitted private reply, stored reply IDs, and separate SENT log entries.
3. Comment an unmatched word; then test case/whole-word matching. No unmatched send should occur. Comment as the Page itself; it must be ignored. Send an event for an unconnected Page; it must be ignored.
4. Redeliver the same signed webhook and Queue job repeatedly/concurrently. Confirm no additional sends. Test two matching campaigns on the same comment: at most one private attempt overall.
5. Test an ineligible private reply (e.g. a Page author or other Meta eligibility rejection) and a public-reply rejection. Verify independent status/error codes and no repeated private attempts. Test an old comment/private seven-day cutoff without sending to real people.
6. Create a second test workspace. Verify Page selection, campaign reads/writes, logs, and queued job IDs cannot cross workspaces. The same Page cannot be attached to two workspaces.
7. Disconnect Facebook; verify its token is cleared and queued/new events do not send. Confirm the staging Instagram account is unaffected. Reconnect and confirm older queued jobs are skipped.
8. Disconnect only the staging Instagram test account; verify Facebook remains connected and functional. Never use the current production Instagram account for this test.
9. Create/edit/pause/resume Both; switch to Facebook-only and Instagram-only and verify the documented lifecycle. Check keyboard labels, Page selector, validation messages, logs pagination and narrow-screen layout in a browser.
10. Exercise an Instagram staging comment/DM campaign and both webhook verification tokens. Confirm `object=instagram` reaches only the original processor, `object=page` only Facebook, and unknown objects trigger neither. Verify cross-app signatures are rejected.
11. Observe queue retry handling and UNCONFIRMED behavior using controlled test failures. Do not create duplicate real sends merely to test recovery. Confirm pending/failed/unknown rows are visible to the operator.
12. Before applying the migration anywhere else, repeat migration checks on a disposable staging snapshot and review SQL/locks. Old Instagram scalar columns and rows must remain unchanged. Any future production release is a separate approval and deployment task.

For a safe local build without usable environment credentials, run `node scripts/check-facebook-isolated.mjs`. It executes `npm run build` with dummy values and local port-1 database/Redis targets; it does not deploy or run migrations. It suppresses values loaded from root `.env*` files without editing those files. The normal build command in an arbitrary shell does not provide this isolation.
