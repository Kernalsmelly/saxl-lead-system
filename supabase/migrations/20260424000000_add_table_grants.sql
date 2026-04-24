-- Grant table privileges to the Supabase API roles.
--
-- Why this wasn't in 20260423000000_init_schema.sql
-- ------------------------------------------------------------
-- Older Supabase projects relied on an event trigger that auto-granted
-- SELECT/INSERT/UPDATE/DELETE on every new public-schema table to the
-- anon, authenticated, and service_role roles. That auto-grant is no
-- longer applied by default on newer projects (the exact cutover is
-- not publicly documented, but saxl-lead-system-dev — created 2026-04-23 —
-- is on the stricter default).
--
-- Symptom if grants are missing: every query through the PostgREST /
-- supabase-js layer returns Postgres error code 42501 "permission denied
-- for table <x>" — even with RLS policies in place. RLS controls which
-- ROWS a role can see; it does nothing if the role has no privileges
-- on the TABLE itself. This bit the website-form webhook on first
-- real request: service_role had no grants, so the tenant lookup 500'd
-- with 42501 before RLS was ever consulted.
--
-- Rule for future fresh environments
-- ------------------------------------------------------------
-- Include explicit GRANTs whenever you create tables in the public
-- schema. Do not rely on Supabase's auto-grant event trigger — treat
-- it as gone on all new projects.
--
-- Roles
-- ------------------------------------------------------------
--   service_role  -- bypasses RLS; used by webhooks + cron jobs
--   authenticated -- subject to RLS policies; used by the dashboard
--   anon          -- DELIBERATELY NOT GRANTED. Unauthenticated traffic
--                    stays blocked at the privilege layer so a future
--                    policy mistake can't accidentally expose rows.

grant select, insert, update, delete on public.tenants          to service_role;
grant select, insert, update, delete on public.tenant_channels  to service_role;
grant select, insert, update, delete on public.leads            to service_role;
grant select, insert, update, delete on public.lead_events      to service_role;
grant select, insert, update, delete on public.follow_ups       to service_role;
grant select, insert, update, delete on public.jobs             to service_role;

grant select, insert, update, delete on public.tenants          to authenticated;
grant select, insert, update, delete on public.tenant_channels  to authenticated;
grant select, insert, update, delete on public.leads            to authenticated;
grant select, insert, update, delete on public.lead_events      to authenticated;
grant select, insert, update, delete on public.follow_ups       to authenticated;
grant select, insert, update, delete on public.jobs             to authenticated;
