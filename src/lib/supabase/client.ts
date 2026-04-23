import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

// Browser Supabase client. Safe to import in Client Components.
export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
