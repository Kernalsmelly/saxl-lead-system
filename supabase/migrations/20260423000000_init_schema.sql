-- Initial schema for Saxl Lead System.
--
-- Tables: tenants, tenant_channels, leads, lead_events, follow_ups, jobs.
-- Multi-tenant via tenant_id on every row. RLS: a user may access a tenant
-- iff they are its owner (tenants.owner_user_id = auth.uid()). Team-member
-- support is deliberately out of scope for v1.

set search_path = public;

--
-- Enums
--

create type lead_source as enum (
  'website_form',
  'phone_call',
  'sms',
  'instagram_dm',
  'facebook_dm',
  'other'
);

create type lead_status as enum (
  'new',
  'contacted',
  'quoted',
  'booked',
  'won',
  'lost',
  'cold',
  'unparsed'
);

create type channel_type as enum (
  'website_form',
  'sms',
  'voice',
  'meta_dm'
);

create type lead_event_type as enum (
  'captured',
  'owner_notified',
  'auto_reply_sent',
  'status_changed',
  'follow_up_sent',
  'note_added'
);

create type follow_up_type as enum (
  '48h_response',
  '7d_quote_followup',
  '14d_cold_check',
  'custom'
);

create type follow_up_status as enum (
  'pending',
  'sent',
  'cancelled',
  'completed'
);

create type job_status as enum (
  'scheduled',
  'in_progress',
  'completed',
  'rescheduled',
  'cancelled'
);

--
-- Utility: updated_at trigger
--

create or replace function public.set_last_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.last_updated_at = now();
  return new;
end;
$$;

--
-- tenants
--

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  name text not null,
  owner_email text not null,
  owner_phone text,
  website text,
  timezone text not null default 'America/Los_Angeles',
  created_at timestamptz not null default now()
);

create index tenants_owner_user_id_idx on public.tenants (owner_user_id);

--
-- tenant_channels
--

create table public.tenant_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel_type channel_type not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index tenant_channels_tenant_id_idx on public.tenant_channels (tenant_id);
create unique index tenant_channels_tenant_channel_unique
  on public.tenant_channels (tenant_id, channel_type);

--
-- leads
--

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  source lead_source not null,
  status lead_status not null default 'new',
  service_type text,
  name text,
  phone text,
  email text,
  instagram_handle text,
  city text,
  zip text,
  address text,
  preferred_date date,
  notes text,
  quote_amount numeric(10, 2),
  job_date date,
  revenue numeric(10, 2),
  raw_payload jsonb not null default '{}'::jsonb,
  parsed_confidence real check (parsed_confidence is null or (parsed_confidence >= 0 and parsed_confidence <= 1)),
  received_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  assigned_to uuid references auth.users (id) on delete set null
);

create index leads_tenant_id_idx on public.leads (tenant_id);
create index leads_tenant_status_idx on public.leads (tenant_id, status);
create index leads_tenant_received_at_idx on public.leads (tenant_id, received_at desc);

create trigger leads_set_last_updated_at
  before update on public.leads
  for each row
  execute function public.set_last_updated_at();

--
-- lead_events
--

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  event_type lead_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index lead_events_lead_id_idx on public.lead_events (lead_id, created_at desc);

--
-- follow_ups
--

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  type follow_up_type not null,
  due_at timestamptz not null,
  status follow_up_status not null default 'pending',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index follow_ups_due_pending_idx
  on public.follow_ups (due_at)
  where status = 'pending';
create index follow_ups_lead_id_idx on public.follow_ups (lead_id);

--
-- jobs
--

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  scheduled_date date,
  completed_date date,
  status job_status not null default 'scheduled',
  revenue numeric(10, 2),
  notes text,
  created_at timestamptz not null default now()
);

create index jobs_tenant_id_idx on public.jobs (tenant_id);
create index jobs_lead_id_idx on public.jobs (lead_id);

--
-- Row-Level Security
--
-- v1 access model: the tenant owner is the only user who can read/write
-- their rows. Webhooks and background jobs use the service-role key and
-- bypass RLS entirely.

alter table public.tenants        enable row level security;
alter table public.tenant_channels enable row level security;
alter table public.leads          enable row level security;
alter table public.lead_events    enable row level security;
alter table public.follow_ups     enable row level security;
alter table public.jobs           enable row level security;

-- tenants: owner reads/updates their own tenant row.
create policy tenants_owner_select on public.tenants
  for select to authenticated
  using (owner_user_id = auth.uid());

create policy tenants_owner_update on public.tenants
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- tenant_channels: owner of the parent tenant.
create policy tenant_channels_owner_all on public.tenant_channels
  for all to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = tenant_channels.tenant_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = tenant_channels.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

-- leads: owner of the parent tenant.
create policy leads_owner_all on public.leads
  for all to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = leads.tenant_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = leads.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

-- lead_events: owner of the tenant that owns the parent lead.
create policy lead_events_owner_all on public.lead_events
  for all to authenticated
  using (
    exists (
      select 1
      from public.leads l
      join public.tenants t on t.id = l.tenant_id
      where l.id = lead_events.lead_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.leads l
      join public.tenants t on t.id = l.tenant_id
      where l.id = lead_events.lead_id
        and t.owner_user_id = auth.uid()
    )
  );

-- follow_ups: same pattern.
create policy follow_ups_owner_all on public.follow_ups
  for all to authenticated
  using (
    exists (
      select 1
      from public.leads l
      join public.tenants t on t.id = l.tenant_id
      where l.id = follow_ups.lead_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.leads l
      join public.tenants t on t.id = l.tenant_id
      where l.id = follow_ups.lead_id
        and t.owner_user_id = auth.uid()
    )
  );

-- jobs: owner of the parent tenant.
create policy jobs_owner_all on public.jobs
  for all to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = jobs.tenant_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = jobs.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );
