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
import type { Database } from '@/lib/db/types';
import { LeadsFilters } from './filters';

type LeadStatus = Database['public']['Enums']['lead_status'];

const ALL_STATUSES: readonly LeadStatus[] = [
  'new',
  'contacted',
  'quoted',
  'booked',
  'won',
  'lost',
  'cold',
] as const;

// Leads index. Server-rendered.
//
// RLS does the tenant filtering: the authenticated session client only
// returns rows from `leads` where the user's auth.uid() matches
// tenants.owner_user_id. We deliberately do NOT add a manual
// `.eq('tenant_id', ...)` clause — that would mask an RLS regression.
//
// Filters live in URL search params (?q=...&status=new,contacted) so
// the page is bookmarkable, shareable, and browser back/forward
// "just works". The filters component is a client component that
// pushes URL changes; this page re-renders against the new params.

export const dynamic = 'force-dynamic'; // session-scoped, never cache

interface SearchParams {
  q?: string;
  status?: string;
}

export default async function LeadsIndexPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = createClient();

  const query = (searchParams.q ?? '').trim();
  const statuses = parseStatuses(searchParams.status);
  const hasFilters = query !== '' || statuses.length > 0;

  let leadsQuery = supabase
    .from('leads')
    .select('id, name, phone, email, source, service_type, status, received_at, notes')
    .order('received_at', { ascending: false });

  if (statuses.length > 0) {
    leadsQuery = leadsQuery.in('status', statuses);
  }

  if (query) {
    // Substring search across the four fields most likely to match.
    // PostgREST `or` takes a string of comma-separated filters; ilike
    // is case-insensitive, * is the LIKE wildcard. We escape the
    // user input so commas and parentheses don't break the filter
    // syntax.
    const escaped = escapeOrFilter(query);
    leadsQuery = leadsQuery.or(
      `name.ilike.*${escaped}*,phone.ilike.*${escaped}*,email.ilike.*${escaped}*,notes.ilike.*${escaped}*`,
    );
  }

  const { data: leads, error } = await leadsQuery;

  if (error) {
    console.error('[leads-index] query failed', error);
    return (
      <PageWrap>
        <Header />
        <LeadsFilters initialQuery={query} initialStatuses={statuses} />
        <ErrorBlock>
          Could not load leads ({error.code ?? 'unknown'}): {error.message}
        </ErrorBlock>
      </PageWrap>
    );
  }

  const count = leads?.length ?? 0;

  return (
    <PageWrap>
      <Header count={count} hasFilters={hasFilters} />
      <LeadsFilters initialQuery={query} initialStatuses={statuses} />
      {count === 0 ? (
        <EmptyState hasFilters={hasFilters} />
      ) : (
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
              {leads!.map((lead) => (
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
      )}
    </PageWrap>
  );
}

function PageWrap({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

function Header({ count, hasFilters = false }: { count?: number; hasFilters?: boolean }) {
  let subtitle: string;
  if (count === undefined) {
    subtitle = 'All inbound leads for your account.';
  } else if (hasFilters) {
    subtitle = `${count} match${count === 1 ? '' : 'es'}.`;
  } else {
    subtitle = `${count} lead${count === 1 ? '' : 's'}, newest first.`;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">
      {hasFilters
        ? 'No leads match the current filters.'
        : "No leads yet — when one comes in, it'll show here."}
    </div>
  );
}

function ErrorBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
      {children}
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

/** Parse a comma-separated list of statuses; filter out unknown values. */
function parseStatuses(raw: string | undefined): LeadStatus[] {
  if (!raw) return [];
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const valid = new Set<string>(ALL_STATUSES);
  return parts.filter((p): p is LeadStatus => valid.has(p));
}

/**
 * Escape a value for use inside a PostgREST `or(...)` filter.
 * Commas and parentheses are reserved syntax in `or` lists; we
 * strip them rather than try to escape, since substring search on
 * those characters is rarely meaningful and escape rules are
 * version-dependent. Trailing/leading whitespace is already trimmed
 * upstream.
 */
function escapeOrFilter(s: string): string {
  return s.replace(/[(),]/g, '');
}
