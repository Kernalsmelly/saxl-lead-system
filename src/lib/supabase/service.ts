import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from '@/lib/db/types';

// Service-role Supabase client. Bypasses RLS. Use ONLY in:
//   - webhook handlers verifying their own signature
//   - cron / background jobs
//   - server-side admin operations
// Never import this from a Client Component or expose it to the browser.
export function createServiceClient() {
  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
