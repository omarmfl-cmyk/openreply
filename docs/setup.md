# Setup

Get OpenReply running end to end: choose your Instagram connection, deploy the web app with Vercel Queues, configure the databases, and test a campaign. OpenReply is self-hosted with either provider.

If you use a coding assistant, start with [Set it up with an AI assistant](#set-it-up-with-an-ai-assistant). Its first decision is your provider, before any Meta app secrets.

## Choose your Instagram connection first

| Connection | What you configure | Costs |
| --- | --- | --- |
| **[Zernio](zernio.md), recommended for simpler connection setup** | A Zernio API key in Settings, a profile, and an Instagram account. OpenReply registers the webhook. No own Meta app or Meta secrets required. | Optional paid provider, plus your hosting. Zernio sponsors OpenReply. |
| **[Your own Meta app](#the-meta-app)** | Your Meta app, Instagram Login, app secrets, webhook, and App Review where required. | Your hosting and any other services you use. No Zernio subscription. |

Both use the official Instagram API and remain subject to Instagram’s policies, account requirements, permissions, rate limits, and messaging windows. Both need PostgreSQL, Redis, email delivery, and Vercel Queues. Existing connections are not migrated automatically.

Learn about the optional sponsor at [Zernio](https://zernio.com/?utm_source=openreply&utm_medium=sponsorship&utm_campaign=openreply-integration&utm_content=setup-provider). Check the [provider guide and feature limits](zernio.md) before choosing.

## Hosting and your domain

Deploy Next.js on Vercel Hobby with Neon PostgreSQL and Redis Cloud. DM jobs run through Vercel Queues push callbacks; no worker host or Deplexo is required.

Follow [Vercel Queues deployment and cutover](vercel-queues.md) for Node.js requirements, seeding, recovery, and tests. Retain your existing secrets and provider settings. The existing Vercel build applies existing Prisma migrations; this queue migration adds no schema changes.

For a new installation, provision PostgreSQL and Redis, configure the variables below, and deploy your fork on Vercel. Set `NEXTAUTH_URL` to its public HTTPS URL (or your custom domain), configure email delivery, then seed reconciliation as described in the queue guide.

## Environment variables

Copy `.env.example` to `.env` for local work, or set these in Vercel for hosting. Zernio credentials are saved in Settings, not environment variables. The Meta variables in the second table are only for direct Meta connections.

| Variable | What it is |
| --- | --- |
| `NEXTAUTH_URL` | Your public URL. Your Vercel domain in production, your tunnel URL locally. |
| `NEXTAUTH_SECRET` | Random secret. `openssl rand -base64 32` |
| `CRON_SECRET` | Random secret protecting the token-refresh cron. |
| `ENCRYPTION_KEY` | 32-byte hex. `openssl rand -hex 32`. Encrypts provider credentials and Instagram tokens. Used by web routes and queue callbacks. |
| `DATABASE_URL` | PostgreSQL connection string. Use the Neon connection string accessible from Vercel. |
| `REDIS_URL` | Redis connection string. Redis Cloud TCP connection for rate limiting, alerts, and reconciliation coordination. |
| `RESEND_API_KEY` | Resend key. Login is email magic links only, so without this nobody can sign in. |
| `EMAIL_FROM` | A sender on a domain you verified in Resend. The placeholder will not deliver. |
| `ALLOWED_EMAILS` | Optional. Comma-separated allowlist of addresses that may sign in, case insensitive. Unset, anyone who reaches your public URL can request a magic link and gets their own workspace, which is worth closing on an instance you run for yourself. |
| `EMAIL_SERVER` | Optional. An SMTP URL, for example `smtps://login%40example.com:password@mail.example.com:465`. Set it to send magic links through your own mail server instead of Resend; then `RESEND_API_KEY` is not needed. URL-encode special characters in the user and password (`@` becomes `%40`). Port 465 with `smtps://` is implicit TLS, port 587 with `smtp://` is STARTTLS. |

**Direct Meta only.** Leave these unset if all accounts use Zernio:

| Variable | What it is |
| --- | --- |
| `META_GRAPH_API_VERSION` | Graph API version, for example `v25.0`. |
| `INSTAGRAM_APP_ID` | From the Meta app, see Step 6. |
| `INSTAGRAM_APP_SECRET` | From the Meta app. |
| `FACEBOOK_APP_SECRET` | From the Meta app. |
| `WEBHOOK_VERIFY_TOKEN` | Any random string. You paste the same value into Meta's webhook config. |

`ENCRYPTION_KEY` must be exactly 64 hex characters or the app throws on boot.

Optional, for tuning the polling reconciler (defaults are fine to start):

| Variable | Default | What it does |
| --- | --- | --- |
| `COMMENT_POLL_INTERVAL_MS` | `300000` | Delay between successful reconciliation sweeps (5 min). |
| `COMMENT_POLL_MAX_PER_SWEEP` | `30` | Max new comments each campaign acts on per sweep. Keep it conservative; higher gets closer to Instagram's rate limits. |
| `COMMENT_POLL_LOOKBACK_HOURS` | `72` | How far back a sweep considers comments. |

## Connect through Zernio

After deployment, sign in as a workspace owner or admin and follow [docs/zernio.md](zernio.md). Save an unrestricted read/write API key with Inbox access, select your existing Zernio profile, then import an Instagram account or connect a new one through Zernio. OpenReply creates its webhook automatically.

You can skip the entire Meta app section below and continue at [Test it end to end](#test-it-end-to-end). No `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_SECRET`, or `WEBHOOK_VERIFY_TOKEN` is needed for this path.

## The Meta app

**Direct Meta connections only.** Zernio users skip this section.

This is the slow part. The code works out of the box; getting Meta to send you comment events is where people lose an afternoon. Every step here exists because skipping it breaks something later. Have your Vercel domain from Step 3 ready, you will paste it in a few times.

### Step 4: Create the Meta app

Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and create an app.

- App type: Business.
- Contact email: one you actually check.

When it asks you to add a use case, filter to All, then choose Manage messaging and content on Instagram. Do not pick "Create and manage ads with Marketing API", and do not pick "Authenticate with Facebook Login". OpenReply uses Instagram Login. Picking the Facebook Login variant makes the OAuth flow fail later with a mismatched client error.

If you accidentally added the Marketing API use case, remove it. It has its own heavy review requirements and can block publishing.

### Step 5: Collect the three secrets

There are two app secrets and two app IDs, which is confusing. Here is what maps to what.

| Environment variable | Where it lives |
| --- | --- |
| `INSTAGRAM_APP_ID` | Instagram, API setup with Instagram login. A number like `2036...` |
| `INSTAGRAM_APP_SECRET` | Same page, click Show |
| `FACEBOOK_APP_SECRET` | App settings, Basic, App secret, click Show |

The Instagram app ID is not the same number as the Facebook App ID shown on the Basic settings page. Use the one under the Instagram product.

OpenReply verifies webhook signatures against both `FACEBOOK_APP_SECRET` and `INSTAGRAM_APP_SECRET`, so you do not have to guess which one Meta signs with. Set both.

### Step 6: Add your Instagram account as a tester, and accept the invite

This is the step people miss, and it produces the error "Insufficient Developer Role" on the Instagram login screen. In development, only accounts that have a role on your app can connect. Even your own account has to be added and accept.

There are two halves. Both are required.

Half one, on the Meta side. In the app dashboard, open App roles, then Roles (in the newer console this is also reachable from the Instagram product under "Generate access tokens"). Find the section for Instagram testers, click add, and enter the exact Instagram username of the account you want to connect. Send the invite.

Half two, on the Instagram side. This is the part that gets skipped. Open Instagram as that account (the phone app is easiest):

1. Go to your profile, then the menu, then Settings and activity.
2. Open Apps and websites (older versions: Website permissions, then Apps and websites).
3. Open Tester invites.
4. Accept the invite from your app.

Until you accept here, the account is not really a tester and the login will keep failing. If you do not see the invite, double-check you sent it to the exact username and that the account is a Business or Creator account.

### Step 7: Register the OAuth redirect

In the Instagram product, open Set up Instagram business login, then Business login settings. In the OAuth redirect URIs field, add exactly, using your Vercel domain:

```
https://your-app.vercel.app/api/instagram/callback
```

No trailing slash. If this is missing or wrong, connecting an account fails with a redirect_uri mismatch. You can register more than one, which is useful if you change domains later; keep the old and new both listed.

You do not need the "Embed URL" that Meta shows here. OpenReply builds its own login URL. Users connect by opening your app, going to Settings, and clicking Connect Instagram.

### Step 8: Configure the webhook

Still in the Instagram product, find the Configure webhooks step.

- Callback URL: `https://your-app.vercel.app/api/webhook`
- Verify token: the value of `WEBHOOK_VERIFY_TOKEN` from your environment
- Click Verify and save. It should succeed immediately, because the app answers Meta's verification challenge. If the button is greyed out, click into the verify-token field and paste the token again; editing the callback URL often clears it.
- Subscribe to the `comments` field, and to `messages` as well.

Both fields matter. `comments` carries comment-to-DM, which is what most people come here for. `messages` carries inbound DMs and Story replies, which is what a campaign's "also reply when someone DMs these words" toggle runs on. Subscribe to `comments` alone and that toggle looks enabled but never fires, because the events it needs are never delivered.

To test delivery without a real comment, click Test next to `comments`, then click Send to My Server. This is a two-step control. Clicking Test only previews the sample payload; the second button is what actually POSTs it to your endpoint. After sending, a row should appear in your `WebhookEvent` table.

If your primary domain ever changes, update this callback URL to the new domain. A non-primary domain will 307-redirect the POST, and Meta does not reliably follow redirects, so webhooks silently stop.

### Step 9: Publish the app

Real comment webhooks are only delivered when the app is in Live state. In Development mode, only the console Test button delivers events. This is the single most common reason for "I set everything up and nothing happens."

Go to the Publish item in the left sidebar. Set the privacy policy, terms of service, and data deletion URLs first, or it will not let you publish. OpenReply ships these pages, on your Vercel domain:

```
https://your-app.vercel.app/privacy
https://your-app.vercel.app/data-deletion
https://your-app.vercel.app/terms
```

Then publish. Depending on your access level, Meta may let you go live for your own tester accounts immediately, or it may require App Review first (see the last section).

### Publishing is not Advanced Access: every account still needs a role on the app

This one costs an afternoon because the symptom points nowhere near the cause.

A published app still holds **Standard Access** to `instagram_business_basic`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`. Standard Access only covers Instagram accounts that have a role on your app — admins, developers, and Instagram testers. Publishing makes the app live; it does not widen who the permissions apply to. Advanced Access, which covers everyone else, comes only from App Review.

So connecting a second account fails even though the first one works, on the same app, with the same code.

The symptom: Instagram's consent screen appears and the login succeeds, the code exchange at `api.instagram.com/oauth/access_token` returns a normal `IGAA…` token with all the requested permissions — and then every single call against `graph.instagram.com` is refused:

```
Unsupported request - method type: get  [code=100, type=IGApiException]
```

`/access_token`, `/refresh_access_token`, `/me` — all of them, identically. Nothing about the message suggests a missing role, and the token itself looks fine.

The fix for your own accounts is the same two-part dance as Step 6, once per account: invite the Instagram username under App roles, Roles, Instagram testers, then accept the invite inside Instagram under Edit profile, Apps and websites, Tester invites. For accounts you do not control, you need App Review — see [META_APP_REVIEW.md](../META_APP_REVIEW.md).

### The account ID trap (informational)

You do not have to do anything here; OpenReply handles it. It is worth understanding because it is invisible when it goes wrong.

Meta's `/me` returns two IDs. The `id` field is app-scoped. The `user_id` field is the Instagram professional account ID. Webhooks put `user_id` in `entry.id`, and the messaging API keys off `user_id` too. OpenReply stores `user_id`, so a fresh connection matches correctly. If you upgraded from a very old build and an account was stored with the wrong ID, disconnect and reconnect it once.

## Test it end to end

1. Connect the account in Settings. For Zernio, complete the [provider setup](zernio.md). For direct Meta, make sure the account has accepted its tester invite (Step 6) and the app is published (Step 9).
2. Confirm the account appears in OpenReply and `/api/health` reports a healthy worker.
3. Create a campaign on one of your posts with a keyword like `TEST`.
4. From a different Instagram account, comment `TEST` on that post. It must be a different account, because OpenReply ignores your own comments on purpose.
5. Watch for the DM. If nothing arrives, check the DM Logs page and `/api/health`.

Hit `/api/health` any time. It reports database and Redis connectivity and `vercel-queue-push` execution mode. A resident heartbeat is not required. Verify actual delivery and backlog in Vercel Queues observability.

If you want to inspect where a comment stopped, the Postgres tables tell you: `WebhookEvent` for delivery, `DmLog` for send status and errors, `OperationalEvent` for worker crashes and the polling reconciler's sweep logs.

## Local development

You need Postgres and Redis. The included `docker-compose.yml` starts both:

```bash
docker-compose up -d
npm run db:generate
npm run db:migrate
```

Or install them natively (macOS):

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
createdb openreply
```

Then set `DATABASE_URL` to match your local user, for example `postgresql://YOUR_USER@localhost:5432/openreply`.

Link the local app to Vercel as described in [queue development](vercel-queues.md), then run:

```bash
npm run dev
```

For your provider to reach local webhooks, run an HTTPS tunnel and set `NEXTAUTH_URL` to it. For direct Meta, update its webhook and redirect URLs too. Configure the Zernio connection after setting the public URL so registration uses the tunnel:

```bash
ngrok http 3000
```

## Set it up with an AI assistant

Open a clone of this repository in your coding assistant and paste the prompt below. Keep real credentials in your deployment’s secret settings or local `.env`, not committed files.

```text
You are helping me self-host OpenReply in this repository. Read README.md,
docs/setup.md, and docs/zernio.md before changing anything.

My goal: <my own Instagram account, a team workspace, or another use case>.

Work through this order. Ask for decisions or actions only I can supply:

1. Choose the Instagram provider BEFORE asking for Meta secrets or walking me
   through Meta App Review. Recommend Zernio if I want to avoid creating and
   reviewing my own Meta app. Clearly disclose that it is an optional PAID
   service and OpenReply sponsor, that OpenReply remains self-hosted, and that
   direct Meta is still supported. Explain the feature limits in docs/zernio.md.
   Ask which provider I want. Do not silently migrate existing accounts.

2. Choose local or hosted. For hosting, the guide uses Vercel for the web app
   with Vercel Queues, Neon PostgreSQL, and Redis Cloud. For local, use Docker
   Compose and a public HTTPS tunnel. Explain infrastructure costs separately.

3. Configure shared services and secrets. Set up PostgreSQL, Redis, login email
   delivery, NEXTAUTH_URL, NEXTAUTH_SECRET, CRON_SECRET, and ENCRYPTION_KEY.
   Preserve ENCRYPTION_KEY. Run Prisma generation and
   migrations. Never commit credentials or print saved secrets.

4. Deploy the app, seed reconciliation using docs/vercel-queues.md, and verify
   a Vercel Queue delivery. No always-on worker is needed.

5. Connect the chosen provider:
   - Zernio: skip all Meta app secrets and own-app review steps. In Settings,
     have the workspace owner/admin save an unrestricted read/write API key
     with Inbox access, select an existing profile, and let OpenReply register
     its webhook. Select an existing Instagram account or use the Zernio
     connection flow to add one, then import it. Keep campaign automation in
     OpenReply; do not create a duplicate campaign in Zernio.
   - Direct Meta: follow the Meta app section in docs/setup.md. Ask for Meta
     secrets only on this path. Configure the redirect, webhook, tester roles,
     and publishing; explain Advanced Access/App Review where required.

6. Test a campaign with keyword TEST. Have a DIFFERENT Instagram account
   comment on the selected post. Confirm a DM and a SENT row in DM Logs.
   Diagnose with WebhookEvent, DmLog, OperationalEvent, and /api/health.

Rules:
- Instagram account requirements, messaging windows, permissions, and rate
  limits apply with either provider. Never promise a policy bypass.
- Do not invent dashboard steps. Ask if a screen differs from the guide.
- Do not put sponsorship or provider branding into customer DMs.
- Keep secrets in trusted secret settings. Rotate anything exposed.

Start by reading the docs, then ask me question 1.
```

By the end, `/api/health` returns `status: ok` with `worker.healthy: true`, and a comment with your keyword from a second account produces a `SENT` row in the DM logs. If you get there, you are done.

## Letting other people use your instance

**Direct Meta:** Everything above is enough to run OpenReply for your own accounts, or a handful of accounts you add as testers. No App Review needed.

For a stranger to connect through your own Meta app, Meta requires App Review granting Advanced Access on the messaging and comments permissions. That means:

- A screencast of the full flow working, recorded on real accounts in one take.
- A written justification for each permission. Drafts are in [../META_APP_REVIEW.md](../META_APP_REVIEW.md).
- Business verification, which asks for a document proving a legal business entity: a business registration or license, articles of incorporation, a business tax document, or a business bank statement.

Meta scrutinizes automated-DM apps and often rejects the first submission, so budget for a resubmit. If you do not have a registered business, most self-hosters skip this entirely by running their own instance for their own account, which never needs review.

For Zernio connections, you use its managed connection flow instead of your own Meta app review. Your instance is still self-hosted, and each workspace owner/admin configures its Zernio connection. Platform rules and provider limits still apply.

## Security notes

- `.env` is gitignored. Keep it that way.
- Rotate any secret that has been pasted anywhere it could be logged, including a chat with an AI assistant.
- Instagram tokens are encrypted at rest with `ENCRYPTION_KEY`. Losing or changing it means every connected account has to reconnect.
