import { createClient } from '@/lib/supabase/server';

export default async function AppHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {user?.email}.
        </p>
      </div>
      <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
        Lead capture not wired up yet. Next up: website-form webhook.
      </div>
    </div>
  );
}
