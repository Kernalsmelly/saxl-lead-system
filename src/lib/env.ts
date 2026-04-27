import { z } from 'zod';

// Server-side env. Throws at import time if anything required is missing,
// so misconfiguration fails fast instead of at first request.
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  APP_BASE_URL: z.string().url(),
  RESEND_API_KEY: z.string().min(1),
  NOTIFICATIONS_FROM_EMAIL: z.string().email(),
  CRON_SECRET: z.string().min(16),
});

const clientEnvSchema = serverEnvSchema.pick({
  NEXT_PUBLIC_SUPABASE_URL: true,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: true,
  NEXT_PUBLIC_APP_URL: true,
});

const isServer = typeof window === 'undefined';

const source = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  APP_BASE_URL: process.env.APP_BASE_URL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  NOTIFICATIONS_FROM_EMAIL: process.env.NOTIFICATIONS_FROM_EMAIL,
  CRON_SECRET: process.env.CRON_SECRET,
};

type ServerEnv = z.infer<typeof serverEnvSchema>;

// The client bundle only sees NEXT_PUBLIC_* vars at runtime; the server-only
// fields are `undefined` in the browser. Typing the export as ServerEnv keeps
// server code ergonomic — always read env.* from a server context.
export const env: ServerEnv = (
  isServer ? serverEnvSchema.parse(source) : clientEnvSchema.parse(source)
) as ServerEnv;

export type Env = ServerEnv;
