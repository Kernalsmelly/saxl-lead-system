import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';

import { createClient } from '@/lib/supabase/server';
import { formatEnum } from '@/lib/format';
import { StatusForm } from './status-form';

// Lead detail. Server-rendered, with a single editable control
// (status) wired up via a server action.
//
// RLS scopes both queries to the authenticated user's tenant. If the
// lead id belongs to another tenant (or doesn't exist), maybeSingle()
// returns null and we render notFound() — same path for both. We
// deliberately do NOT add a manual tenant_id check; an RLS regression
// must surface as "row not visible," not "filtered in app code."
//
// Layout: two-column on md+ (lead data 2/3, Activity timeline 1/3),
// stacked on mobile. Activity events are newest-first to match the
// dashboard idiom (most recent action at the top — the thing you
// usually came here to check).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = 'force-dynamic';

export default async function LeadDetailPage({
  params,
}: {
  params: { leadId: string };
}) {
  if (!UUID_RE.test(params.leadId)) {
    notFound();
  }

  const supabase = createClient();

  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*')
    .eq('id', params.leadId)
    .maybeSingle();

  if (leadErr) {
    console.error('[lead-detail] lead query failed', leadErr);
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
        Could not load lead ({leadErr.code ?? 'unknown'}): {leadErr.message}
      </div>
    );
  }

  if (!lead) {
    notFound();
  }

  const { data: events, error: eventsErr } = await supabase
    .from('lead_events')
    .select('id, event_type, payload, created_at')
    .eq('lead_id', lead.id)
    .order('created_at', { ascending: false });

  if (eventsErr) {
    // Don't fail the whole page just because the timeline query died.
    console.error('[lead-detail] events query failed', eventsErr);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/app/leads"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to leads
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {lead.name ?? 'Unnamed lead'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Received{' '}
            <time dateTime={lead.received_at} title={new Date(lead.received_at).toLocaleString()}>
              {formatDistanceToNow(new Date(lead.received_at), { addSuffix: true })}
            </time>{' '}
            via {formatEnum(lead.source)}
          </p>
        </div>
        <StatusForm
          leadId={lead.id}
          currentStatus={lead.status}
          lastUpdatedAt={lead.last_updated_at}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Lead data — 2/3 on desktop */}
        <div className="space-y-6 md:col-span-2">
          <Section title="Contact">
            <Field label="Name" value={lead.name} />
            <Field label="Phone" value={lead.phone} />
            <Field label="Email" value={lead.email} />
          </Section>

          <Section title="Job">
            <Field label="Service" value={formatEnum(lead.service_type)} />
            <Field
              label="Preferred date"
              value={lead.preferred_date ? format(new Date(lead.preferred_date), 'PPP') : null}
            />
            <Field label="Address" value={lead.address} />
            <Field label="City" value={lead.city} />
            <Field label="Zip" value={lead.zip} />
          </Section>

          <Section title="Notes">
            {lead.notes ? (
              <p className="whitespace-pre-wrap text-sm">{lead.notes}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No notes captured.</p>
            )}
          </Section>

          <Section title="Raw payload">
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Show raw JSON (debug)
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(lead.raw_payload, null, 2)}
              </pre>
            </details>
          </Section>
        </div>

        {/* Activity timeline — 1/3 on desktop */}
        <aside className="md:col-span-1">
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Activity</h2>
          {events && events.length > 0 ? (
            <ol className="space-y-3">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="rounded-md border bg-card p-3 text-sm shadow-sm"
                >
                  <div className="font-medium">{formatEnum(event.event_type)}</div>
                  <EventDetail event={event} />
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    <time
                      dateTime={event.created_at}
                      title={new Date(event.created_at).toLocaleString()}
                    >
                      {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border p-4">
      <h2 className="mb-3 text-sm font-semibold tracking-tight">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2">
        {value ? value : <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function EventDetail({
  event,
}: {
  event: { event_type: string; payload: unknown };
}) {
  if (event.event_type === 'status_changed' && event.payload && typeof event.payload === 'object') {
    const p = event.payload as { from?: unknown; to?: unknown };
    if (typeof p.from === 'string' && typeof p.to === 'string') {
      return (
        <div className="text-xs text-muted-foreground">
          {formatEnum(p.from)} → {formatEnum(p.to)}
        </div>
      );
    }
  }
  return null;
}
