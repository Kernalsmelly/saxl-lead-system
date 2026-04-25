import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated users away from /app.
  // This second check is a belt-and-suspenders guard in case middleware
  // is skipped (e.g. during local development with matcher changes).
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/app" className="text-sm font-semibold tracking-tight">
              Saxl Labs
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/app/leads" className="hover:text-foreground">
                Leads
              </Link>
              <Link href="/app/settings" className="hover:text-foreground">
                Settings
              </Link>
            </nav>
          </div>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
