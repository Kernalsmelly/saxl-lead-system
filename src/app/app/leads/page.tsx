import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

import { createClient } from '@/lib/supabase/server';
import { formatEnum } from '@/lib/format';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Leads index. Server-rendered.
//
// RLS does the tenant filtering: the authenticated session client only
// returns rows from `leads` where the user's auth.uid() matches
// tenants.owner_user_id. We deliberately do NOT add a manual
// `.eq('tenant_id', ...)` clause — that would mask an RLS regression.
// If RLS is misconfigured, this page should return zero rows for a
// foreign user, not "the wrong rows but filtered in app code."

export const dynamic = 'force-dynamic'; // session-scoped, never cache

export default async function LeadsIndexPage() {
  const supabase = createClient();

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, phone, email, source, service_type, status, received_at')
    .order('received_at', { ascending: false });

  if (error) {
    // Surface clearly during dev — production will get a friendlier
    // boundary later. RLS misses appear here as 42501.
    console.error('[leads-index] query failed', error);
    return (
      <div className="space-y-4">
        <Header />
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          Could not load leads ({error.code ?? 'unknown'}): {error.message}
        </div>
      </div>
    );
  }

  if (!leads || leads.length === 0) {
    return (
      <div className="space-y-4">
        <Header />
        <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
          No leads yet — when one comes in, it&rsquo;ll show here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header count={leads.length} />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden sm:table-cell">Source</TableHead>
              <TableHead className="hidden md:table-cell">Service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id} className="cursor-pointer">
                <TableCell className="font-medium">
                  <Link href={`/app/leads/${lead.id}`} className="block">
                    {lead.name ?? <span className="text-muted-foreground">—</span>}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/app/leads/${lead.id}`} className="block">
                    {lead.phone ?? <span className="text-muted-foreground">—</span>}
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Link href={`/app/leads/${lead.id}`} className="block">
                    {lead.email ?? <span className="text-muted-foreground">—</span>}
                  </Link>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Link href={`/app/leads/${lead.id}`} className="block">
                    <SourceBadge source={lead.source} />
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Link href={`/app/leads/${lead.id}`} className="block">
                    {lead.service_type ? (
                      formatEnum(lead.service_type)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/app/leads/${lead.id}`} className="block">
                    <StatusBadge status={lead.status} />
                  </Link>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  <Link href={`/app/leads/${lead.id}`} className="block">
                    <time dateTime={lead.received_at} title={new Date(lead.received_at).toLocaleString()}>
                      {formatDistanceToNow(new Date(lead.received_at), { addSuffix: true })}
                    </time>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
      <p className="text-sm text-muted-foreground">
        {count === undefined
          ? 'All inbound leads for your account.'
          : `${count} lead${count === 1 ? '' : 's'}, newest first.`}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
      {formatEnum(status)}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {formatEnum(source)}
    </span>
  );
}
