# Deploying Saxl Lead System

This is the first-deploy walkthrough. Follow it once per environment
(staging, production). Before starting, the repo's CI must be green
on the commit you intend to deploy — `pnpm typecheck` and `pnpm test`
should pass locally too.

## What we're deploying

- Next.js 14 App Router app, runtime: Node.js (not Edge — the webhook
  uses `crypto.timingSafeEqual` which Edge runtime doesn't ship).
- One scheduled cron at `/api/cron/process-follow-ups` defined in
  `vercel.json` (every 15 minutes).
- Supabase Postgres for storage; auth via `@supabase/ssr`.
- Resend for outbound notifications.
- Anthropic Claude for inbound parsing.

## Prerequisites

Accounts you need before the first deploy:

| Service | Free tier OK? | Notes |
|---|---|---|
| Vercel | Yes (Hobby) | Connects to GitHub for auto-deploy |
| Supabase | Yes | One project per environment |
| Resend | Yes (3K emails/month) | Domain `saxllabs.com` already verified |
| Anthropic | Pay-as-you-go | $5 covers thousands of Haiku 4.5 parses |
| GitHub | Free | Repo: `Kernalsmelly/saxl-lead-system` |

## Step-by-step deploy

### 1. Create the Supabase project

1. Supabase Dashboard → New Project. Name: `saxl-lead-system-prod`
   (or `-staging`). Pick the same region as your Vercel deploy
   (West US 2 if in doubt).
2. After provisioning, grab from Settings → API:
   - **Project URL** (`https://<id>.supabase.co`)
   - **Publishable key** (`sb_publishable_...`) — browser-safe
   - **Secret key** (`sb_secret_...`) — server-only
3. Apply migrations in this order via the SQL editor:
   ```
   supabase/migrations/20260423000000_init_schema.sql
   supabase/migrations/20260424000000_add_table_grants.sql
   supabase/migrations/20260428000000_add_ai_parsed_event_type.sql
   ```
   The grants migration is mandatory — see
   `memory/feedback_supabase_grants.md`. Without it, every PostgREST
   query 500s with `42501`.
4. Sanity check the `lead_event_type` enum:
   ```sql
   select unnest(enum_range(null::lead_event_type));
   ```
   Expect 7 values including `ai_parsed`.

### 2. Verify the Resend domain

The `saxllabs.com` domain is already verified in the dev Resend
account. For a separate prod Resend account (recommended once you
have paying clients) you'd:
1. Add `saxllabs.com` in Resend Domains.
2. Copy DKIM/SPF/return-path DNS records into your DNS provider.
3. Wait for ✓ Verified.

For now, reuse the existing dev Resend API key — production traffic
volume is essentially zero until you onboard a real client.

### 3. Generate prod-only secrets

In a terminal:

```sh
openssl rand -hex 32   # CRON_SECRET
```

(Or the PowerShell equivalent: `-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })`)

### 4. Connect the repo to Vercel

1. Vercel Dashboard → Add New → Project → Import the GitHub repo.
2. Framework preset: **Next.js** (auto-detected).
3. Root directory: leave default (repo root).
4. Build command: leave default (`pnpm build`).
5. Install command: `pnpm install --frozen-lockfile`.

### 5. Set environment variables in Vercel

Project → Settings → Environment Variables. Add each of these to
**Production** (and **Preview** if you want previews to work, but
you'll likely want previews to point at a staging Supabase, not
prod):

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<prod-id>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` (prod) |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` (prod) |
| `NEXT_PUBLIC_APP_URL` | `https://app.saxllabs.com` (or your Vercel URL) |
| `APP_BASE_URL` | same as `NEXT_PUBLIC_APP_URL` |
| `RESEND_API_KEY` | `re_...` |
| `NOTIFICATIONS_FROM_EMAIL` | `notifications@saxllabs.com` |
| `CRON_SECRET` | the 64-hex string from step 3 |
| `ANTHROPIC_API_KEY` | `sk-ant-...` |

`.env.example` is the source of truth for what's required. If a
new env var lands there, this list needs updating in the same PR.

### 6. Deploy

Push to `main` (or hit the "Deploy" button). Watch the build log:
- Install + typecheck + lint should pass (CI already verified them).
- The build output should mention `Cron jobs detected (1)` —
  Vercel saw `vercel.json`.

### 7. Wire up Vercel Cron's auth

Vercel Cron sends requests with no special auth header by default.
Our cron route requires `Authorization: Bearer <CRON_SECRET>` (or
`?secret=` for manual testing).

In Vercel: Project → Settings → Environment Variables, the
`CRON_SECRET` var you set in step 5 is automatically forwarded to
cron requests as the Bearer token *only if* you've set it. Confirm
by triggering the cron manually from Vercel's Cron dashboard
("Run now") and watching the function log — you should see a
`processed: 0` (or some number) JSON response and no `unauthorized`
error.

If you see `401 unauthorized` on the manual run, double-check the
`CRON_SECRET` value in Vercel matches what was set when the route
was deployed.

### 8. Bootstrap the first tenant

Production starts with zero rows in `tenants`. Until the onboarding
flow exists, create the row by hand in the prod SQL editor. You'll
need:

1. Sign up at `https://app.saxllabs.com/login` so an `auth.users`
   row exists with your email. Confirm via the magic-link.
2. Look up your auth uid:
   ```sql
   select id, email from auth.users where email = 'you@example.com';
   ```
3. Insert the tenant + channel:
   ```sql
   insert into public.tenants (name, owner_user_id)
   values ('TrashX', '<paste auth uid>')
   returning id;

   -- Use the returned tenant id below.
   insert into public.tenant_channels (tenant_id, channel_type, enabled, config)
   values (
     '<tenant id>',
     'website_form',
     true,
     jsonb_build_object('webhook_secret', 'whsec_' || encode(gen_random_bytes(32), 'hex'))
   );
   ```
4. Sign in to `/app/settings` and grab the webhook URL + secret to
   paste into the customer's website form integration.

### 9. Smoke test prod

Run the same `pnpm sign-webhook` command you'd run locally, but
point at the prod URL and use the prod webhook secret. Expected:
- HTTP 200 with `{"lead_id":"..."}`
- The lead appears in `/app/leads`
- An "Owner Notified" event lands in the activity timeline within
  ~30s
- 15 minutes later (or sooner if you trigger the cron manually),
  the follow-ups for that lead either fire or get cancelled
  depending on its current status

## Updating production

Standard flow:

1. Branch off `main`, make changes, push.
2. Open a PR. CI runs typecheck + test + lint.
3. Vercel posts a Preview URL on the PR. Smoke-test against it if
   the change touches the request path.
4. Merge to `main`. Vercel auto-deploys to production.

For schema changes:

1. Add a new migration file under `supabase/migrations/`.
2. Apply it to the prod Supabase project via the SQL editor
   **before** merging the code that depends on it.
3. Re-run `supabase gen types typescript --project-id <prod-id>`
   against prod's schema to keep types in sync.
4. Merge the code.

Migrations run in numeric order; never edit a migration after it's
been applied to prod. Always add a new file.

## Manual cron trigger (prod)

If you need to fire the follow-up cron outside its 15-minute schedule:

```sh
curl "https://app.saxllabs.com/api/cron/process-follow-ups?secret=<CRON_SECRET>"
```

The Bearer-token form also works:

```sh
curl https://app.saxllabs.com/api/cron/process-follow-ups \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Response is JSON: `{ ran_at, processed, sent, cancelled, errors, details }`.

## Rotating production secrets

| Secret | Rotation steps |
|---|---|
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API → Reset → update Vercel env var → Redeploy |
| `RESEND_API_KEY` | Resend → API Keys → Create new → update Vercel env var → Redeploy → delete old key |
| `CRON_SECRET` | Generate fresh 64-hex → update Vercel env var → Redeploy. The next Vercel-Cron run will use the new value automatically. |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Keys → Create new → update Vercel env var → Redeploy → delete old key |
| Per-tenant `webhook_secret` | Use the in-app rotate button at `/app/settings`. The customer's form integration must be updated with the new value before its next submission, or the webhook will start returning 401. |
