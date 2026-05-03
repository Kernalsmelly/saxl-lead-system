'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';
import { formatEnum } from '@/lib/format';
import type { Database } from '@/lib/db/types';

type LeadStatus = Database['public']['Enums']['lead_status'];

const STATUS_OPTIONS: readonly LeadStatus[] = [
  'new',
  'contacted',
  'quoted',
  'booked',
  'won',
  'lost',
  'cold',
] as const;

const SEARCH_DEBOUNCE_MS = 300;

interface LeadsFiltersProps {
  initialQuery: string;
  initialStatuses: LeadStatus[];
}

/**
 * Filters bar for /app/leads. State lives in URL search params so:
 *   - the page is bookmarkable / shareable
 *   - browser back/forward "just works"
 *   - server-rendered counts and result rows reflect the same filters
 *
 * Search input is debounced (300ms) to avoid a query per keystroke.
 * Status pills toggle a single param `status` that's a comma-separated
 * list ("new,contacted") — empty/missing = no filter applied.
 */
export function LeadsFilters({ initialQuery, initialStatuses }: LeadsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState(initialQuery);
  const [statuses, setStatuses] = useState<LeadStatus[]>(initialStatuses);

  // Debounce the search query → URL.
  useEffect(() => {
    if (query === initialQuery) return; // first render / param-driven sync
    const t = setTimeout(() => {
      pushParams({ q: query, status: statuses });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function pushParams(next: { q: string; status: LeadStatus[] }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.q.trim()) params.set('q', next.q.trim());
    else params.delete('q');
    if (next.status.length > 0) params.set('status', next.status.join(','));
    else params.delete('status');
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function toggleStatus(s: LeadStatus) {
    const next = statuses.includes(s)
      ? statuses.filter((x) => x !== s)
      : [...statuses, s];
    setStatuses(next);
    pushParams({ q: query, status: next });
  }

  function clearAll() {
    setQuery('');
    setStatuses([]);
    startTransition(() => router.replace(pathname));
  }

  const hasFilters = query.trim() !== '' || statuses.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, email, or notes…"
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            )}
          />
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="self-start rounded-md border px-3 py-2 text-xs text-muted-foreground hover:text-foreground sm:self-auto"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_OPTIONS.map((status) => {
          const active = statuses.includes(status);
          return (
            <button
              key={status}
              type="button"
              onClick={() => toggleStatus(status)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={active}
            >
              {formatEnum(status)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
