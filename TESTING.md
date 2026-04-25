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
