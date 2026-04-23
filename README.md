# Saxl Lead System

Automated multi-channel lead capture and pipeline for small service businesses (hauling, moving, pressure washing, landscaping, cleaning).

**First tenant:** TrashX (Portland-metro). v1 target: 4–6 weeks from project start.

## Stack

- Next.js 14 (App Router) · TypeScript · Tailwind v3 · shadcn/ui (new-york / zinc)
- Supabase (Postgres + Auth via `@supabase/ssr`, magic-link only in v1)
- Twilio (SMS + voice) · Meta Graph API (IG + FB DMs) · Anthropic Claude (lead parsing) · Resend (email)
- Vercel hosting · pnpm · Node 20 LTS

## Getting started

```bash
pnpm install
cp .env.example .env.local
# Fill in .env.local from the Supabase dashboard → Project Settings → API
pnpm dev
```

## Environment variables

`.env.example` is the source of truth. Update it whenever a new env var is introduced. `src/lib/env.ts` validates these at boot via zod.

Supabase uses the new key naming:
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) — browser-safe, subject to RLS
- `SUPABASE_SECRET_KEY` (`sb_secret_...`) — server-only, bypasses RLS

## Database

Migrations live in `supabase/migrations/` as raw SQL and are applied via the Supabase CLI:

```bash
pnpm dlx supabase@latest link --project-ref <ref>
pnpm dlx supabase@latest db push
```

RLS is enabled on every table. Tenant owners (`tenants.owner_user_id = auth.uid()`) can read/write their own rows through the publishable key. Webhooks and cron jobs use the secret key and bypass RLS.

## Project layout

```
src/
  app/
    login/              magic-link sign-in
    auth/callback/      OTP exchange
    auth/sign-out/
    app/                authenticated dashboard
    layout.tsx, page.tsx
  components/ui/        shadcn primitives
  lib/
    env.ts              zod-validated env
    supabase/
      client.ts         browser
      server.ts         RSC / route handlers
      middleware.ts     session refresh
      service.ts        server-only, RLS-bypass
    utils.ts
  middleware.ts
supabase/
  config.toml
  migrations/
```

## Build order (from project brief)

1. **Foundation** ← you are here
2. Twilio SMS + voice + AI parsing
3. Meta Graph API (IG + FB DMs)
4. Follow-up automation + auto-reply + weekly digest
5. Dashboard UI (leads table, Kanban, analytics, settings)
6. TrashX deployment
