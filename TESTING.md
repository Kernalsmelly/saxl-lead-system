# Manual test procedures

This file documents tests we run by hand. Anything that's hard to
automate but important to re-verify after schema, RLS, or auth changes
goes here.

---

## RLS isolation: a tenant cannot see another tenant's leads

**Why it matters**

The whole multi-tenant model rests on one Postgres assumption: when a
logged-in user queries `leads` (or `lead_events`, `tenant_channels`,
`follow_ups`, `jobs`) through the publishable-key client, RLS only
returns rows whose `tenant_id` belongs to a tenant where
`tenants.owner_user_id = auth.uid()`. If RLS is misconfigured, one
customer can read another's pipeline.

The dashboard pages (`/app/leads`, `/app/leads/[leadId]`) deliberately
do **not** add a manual `.eq('tenant_id', ...)` filter — that would
mask an RLS regression. We rely on RLS as the only filter and verify
that with this test.

**Setup (one-time per Supabase environment)**

Run these in the Supabase SQL editor. Use the service role implicitly
via the SQL editor — service role bypasses RLS, which is what we want
for setup.

```sql
-- 1. Create a fake "other" tenant owned by a random uuid (NOT your auth.uid()).
insert into public.tenants (name, owner_user_id)
values ('Test Foreign Tenant', '00000000-0000-0000-0000-000000000001'::uuid)
returning id;
-- copy the returned id, call it <FOREIGN_TENANT_ID>

-- 2. Insert a lead under the foreign tenant.
insert into public.leads (tenant_id, source, status, name, phone, raw_payload)
values (
  '<FOREIGN_TENANT_ID>',
  'website_form',
  'new',
  'DO NOT SHOW Foreign Lead',
  '555-000-0000',
  '{"test":"foreign-tenant lead — should never appear in my dashboard"}'::jsonb
)
returning id;
-- copy the returned id, call it <FOREIGN_LEAD_ID>
```

**Test**

1. Sign in to the dashboard as your own account (the one that owns
   the real TrashX tenant via `tenants.owner_user_id = auth.uid()`).
2. Visit `/app/leads`.
   - **Expected:** the list shows only your tenant's leads. The
     row "DO NOT SHOW Foreign Lead" must not appear.
3. Visit `/app/leads/<FOREIGN_LEAD_ID>` directly (paste the foreign
   lead id into the URL).
   - **Expected:** Next.js 404 page. The lead row exists in the
     database, but RLS hides it from your session, so the
     `maybeSingle()` query returns `null` → `notFound()`.

**Failure modes**

- **Foreign lead appears in `/app/leads`:** the `leads` SELECT policy
  is broken. Check `supabase/migrations/20260423000000_init_schema.sql`
  for the policy and confirm it joins through `tenants.owner_user_id`.
- **Foreign lead detail page renders instead of 404:** same as above —
  the SELECT policy is letting foreign rows through.
- **You see a 500 with code `42501`:** privilege grants are missing.
  Re-apply `supabase/migrations/20260424000000_add_table_grants.sql`.
  RLS doesn't get a chance to filter rows if the role has no table
  privilege.

**Cleanup**

```sql
delete from public.leads where id = '<FOREIGN_LEAD_ID>';
delete from public.tenants where id = '<FOREIGN_TENANT_ID>';
```

**When to re-run this test**

- After any change to RLS policies in `supabase/migrations/`.
- After any change to the dashboard data-loading code in
  `src/app/app/leads/**` — especially if a `.eq('tenant_id', ...)`
  clause gets added (which would mask an RLS regression).
- After bootstrapping a fresh Supabase environment (production
  in Week 6).
- Before each release that touches auth, tenants, or leads tables.

---

## Owner-notification email: end-to-end smoke test

**Why it matters**

The website-form webhook fires an owner notification email through
Resend when a new lead arrives. The send is fire-and-forget
(`waitUntil`), so the prospect's 200 OK comes back fast even if
Resend is degraded. Both success and failure are recorded as a
`lead_events` row of type `owner_notified` for audit.

**Setup (one-time per environment)**

1. Sign in to https://resend.com (use the Saxl Labs account).
2. Create an API key under Account → API Keys. Copy as `re_...`.
3. Verify the `saxllabs.com` domain in Resend (Dashboard → Domains).
   Resend will give DNS records (DKIM + return-path); add them to
   the `saxllabs.com` zone alongside the existing SPF/DMARC.
4. Put the key in `.env.local`:
   ```
   RESEND_API_KEY=re_...
   APP_BASE_URL=http://localhost:3000
   NOTIFICATIONS_FROM_EMAIL=notifications@saxllabs.com
   ```
5. Restart `pnpm dev`.

**Smoke test (no real inbox)**

Resend provides a sandbox recipient `delivered@resend.dev` that
silently accepts mail. Use it before pointing at a real address.

1. Update the tenant's owner email so the test sends to the sandbox.
   In the Supabase SQL editor, look up `auth.users.email` for the
   tenant owner and confirm it's something you control. If you want
   to redirect the smoke test, temporarily change the auth user's
   email to `delivered@resend.dev` in the dashboard, OR add a
   deliverability test by inserting a fresh tenant whose owner is a
   throwaway auth user with `delivered@resend.dev`.
2. Fire a signed webhook:
   ```
   pnpm sign-webhook \
     --secret <tenant_channels.config.webhook_secret> \
     --url http://localhost:3000/api/webhooks/website-form/<tenant_uuid> \
     --payload-file scripts/sample-payload.json
   ```
3. **Expected:** HTTP 200 with `{ "lead_id": "..." }` returned in
   under ~200ms (the email send happens after the response thanks
   to `waitUntil`). The terminal running `pnpm dev` should NOT show
   any `[webhook/website-form] owner notification failed` lines.
4. Open the lead in the dashboard. The Activity timeline should show
   two events: **Captured** and **Owner Notified**.
5. Click the lead and expand "Raw payload" → the lead row exists.
   Then in Supabase SQL editor:
   ```sql
   select event_type, payload from public.lead_events
     where lead_id = '<new_lead_id>'
     order by created_at;
   ```
   Confirm the `owner_notified` row has `payload = {"success": true, "error": null}`.

**Real-inbox test**

Once the sandbox path works, point the tenant owner email at a real
inbox you own and re-fire the webhook. Confirm the email lands within
~10s, the subject reads `New lead — <name> (<service>)`, and the
"View lead details" button links back to the right
`/app/leads/<id>` URL.

**Failure modes**

- **`owner_notified` event has `success: false, error: "domain not verified"`:**
  finish step 3 of setup (DKIM records).
- **`success: false, error: "Invalid \`from\` field"`:** the
  `NOTIFICATIONS_FROM_EMAIL` value isn't on a verified domain in
  Resend.
- **`owner_notified` event missing entirely:** the `waitUntil`
  promise didn't run. In dev (Node) this should never happen; in
  production check the Vercel function logs for the request id.
- **Lead inserted but no email and no `owner_notified` event:** the
  auth admin lookup failed — confirm `SUPABASE_SECRET_KEY` is set
  to a real `sb_secret_*` key (not the legacy service_role key) and
  that the tenant's `owner_user_id` resolves to an existing
  `auth.users` row.

**When to re-run this test**

- After any change to `src/lib/notifications/email.ts`.
- After any change to the webhook handler's notification path.
- After rotating the Resend API key or moving Resend domains.
- Before each release that ships notification-email changes.

---

## Follow-up cron: backdated lead end-to-end

**Why it matters**

The cron at `/api/cron/process-follow-ups` runs every 15 minutes on
Vercel and fires reminder emails for leads that have gone stale. We
want to manually verify the full path — schedule → due date passes →
cron picks it up → email sends → row marked `sent` → audit event
logged — without waiting 48 hours.

The trick is to backdate `received_at` and `due_at` so the row is
already "due" the moment it lands.

**Setup (one-time per dev environment)**

1. Generate a cron secret if you don't have one yet:
   ```
   openssl rand -hex 32
   ```
2. Put it in `.env.local`:
   ```
   CRON_SECRET=<the random hex>
   ```
3. Restart `pnpm dev`.

**Backdated test — full happy path**

1. Fire a normal signed webhook to capture a fresh lead:
   ```
   pnpm sign-webhook \
     --secret <tenant_channels.config.webhook_secret> \
     --url http://localhost:3000/api/webhooks/website-form/<tenant_uuid> \
     --payload-file scripts/sample-payload.json
   ```
   Note the returned `lead_id`.

2. Confirm two follow-ups were scheduled. In the SQL editor:
   ```sql
   select id, type, status, due_at
   from public.follow_ups
   where lead_id = '<lead_id>'
   order by due_at;
   ```
   Expect two rows: `48h_response` (due_at ≈ now + 48h) and
   `14d_cold_check` (due_at ≈ now + 14d), both `pending`.

3. Backdate the 48h row so it's already due:
   ```sql
   update public.follow_ups
     set due_at = now() - interval '1 minute'
     where lead_id = '<lead_id>'
       and type = '48h_response';
   ```
   (Also backdate the lead's `received_at` if you want the email copy
   to read accurately; not required for the cron logic.)

4. Trigger the cron manually (substitute your `CRON_SECRET`):
   ```
   curl "http://localhost:3000/api/cron/process-follow-ups?secret=<CRON_SECRET>"
   ```
   Expected JSON: `{ processed: 1, sent: 1, cancelled: 0, errors: 0, details: [...] }`.

5. **Expected results:**
   - Email lands in your inbox with subject like
     `Heads up — Jordan Alvarez reached out 48 hours ago`.
   - In SQL:
     ```sql
     select status, sent_at from public.follow_ups
       where lead_id = '<lead_id>' and type = '48h_response';
     ```
     Status flipped to `sent`, `sent_at` is populated.
   - Lead detail page Activity column shows a **Follow Up Sent**
     event below **Captured** and **Owner Notified**.

**Lazy-cancel path — status moved before due**

The cron's job is to cancel reminders that are no longer applicable
without sending them. Verify:

1. Capture a fresh lead (as above). Note the `lead_id`.
2. In the dashboard, change the status from **New** to **Contacted**.
3. Backdate the 48h follow-up:
   ```sql
   update public.follow_ups
     set due_at = now() - interval '1 minute'
     where lead_id = '<lead_id>' and type = '48h_response';
   ```
4. Trigger the cron with the curl above.
5. **Expected:** response shows `cancelled: 1, sent: 0`. No email.
   The follow_up row is now `cancelled`. No `follow_up_sent` event in
   the activity log (audit log is for things that happened).

**Cancel-on-terminal path**

1. Capture a lead. Confirm two pending follow-ups exist.
2. In the dashboard, change status to **Won** (or Lost / Cold).
3. Re-query `follow_ups` for that lead — both rows should be
   `cancelled`. No cron run needed; the status action did it.

**Cancel-and-replace on re-quote**

1. Capture a lead. Move it to **Quoted** in the dashboard.
2. Confirm a `7d_quote_followup` row exists, status `pending`.
3. Move status back to **Contacted**, then back to **Quoted**.
4. Re-query `follow_ups`:
   ```sql
   select type, status, due_at, created_at
   from public.follow_ups
   where lead_id = '<lead_id>' and type = '7d_quote_followup'
   order by created_at;
   ```
   Two rows: the first `cancelled`, the second `pending` with a
   newer `due_at`. Exactly one row should ever be `pending`.

**Auth check**

Calling the cron without a secret should 401:
```
curl -i http://localhost:3000/api/cron/process-follow-ups
# expect: HTTP/1.1 401 Unauthorized
```

**Failure modes**

- **`error_send_failed` in the response details:** Resend rejected the
  send. Same triage as the new-lead notification (domain verification,
  from-address, etc.). Row stays `pending` so the next 15-min tick
  retries automatically.
- **`processed: 0` when you expect rows:** the rows aren't `pending`,
  or `due_at` isn't ≤ now. Check the SQL.
- **`cancelled_lead_not_found`:** the FK `ON DELETE CASCADE` should
  prevent this; if it shows up, something deleted a lead row out from
  under us. Investigate.

**When to re-run this test**

- After any change to `src/lib/follow-ups/**` or
  `src/lib/notifications/follow-up-emails.ts`.
- After any change to the cron route or `vercel.json` schedule.
- Before each release that touches follow-up scheduling or email
  delivery.
