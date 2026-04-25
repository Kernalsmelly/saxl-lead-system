import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/env';
import type { Database } from '@/lib/db/types';

// Server Supabase client for RSCs, Route Handlers, and Server Actions.
// Reads/writes the auth cookie via the Next.js cookies() store.
// Typed against the generated Database schema — column names and row
// shapes are checked at compile time.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll is a no-op in Server Components (read-only cookies).
            // The middleware refreshes sessions, so this path is safe.
          }
        },
      },
    },
  );
}
