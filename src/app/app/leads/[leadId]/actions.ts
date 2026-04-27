'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import {
  cancelAllPendingFollowUps,
  scheduleQuoteFollowUp,
} from '@/lib/follow-ups/scheduling';
import type { Database } from '@/lib/db/types';

type LeadStatus = Database['public']['Enums']['lead_status'];

const VALID_STATUSES: readonly LeadStatus[] = [
  'new',
  'contacted',
  'quoted',
  'booked',
  'won',
  'lost',
  'cold',
] as const;

export type UpdateStatusState =
  | { status: 'idle' }
  | { status: 'success'; newStatus: LeadStatus }
  | { status: 'error'; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Server action: update a lead's status and log a status_changed event.
 *
 * Flow:
 *   1. Read current row through the SSR client (RLS-scoped to the
 *      authenticated user's tenant). If the lead isn't visible — either
 *      it doesn't exist or it belongs to another tenant — fail with a
 *      "not found" error. RLS does the auth check; we never look at
 *      cookies or user ids directly.
 *   2. Stale-write guard: compare the form's last_updated_at against
 *      the DB's current value. If they don't match, another writer
 *      changed the row since the page rendered — bail with a clear
 *      message instead of silently overwriting.
 *   3. No-op short-circuit: if from === to, succeed without writing
 *      anything (no event row, no UPDATE). Avoids audit-log noise from
 *      accidental same-value submits.
 *   4. UPDATE leads.status. The set_last_updated_at() trigger bumps
 *      last_updated_at automatically.
 *   5. INSERT lead_events row of type 'status_changed' with from/to
 *      payload. Best-effort: if the event insert fails, the status
 *      change has already persisted — log but don't surface a 500.
 *   6. revalidatePath the detail page and the index so both reflect
 *      the change without a hard reload.
 */
export async function updateLeadStatus(
  _prev: UpdateStatusState,
  formData: FormData,
): Promise<UpdateStatusState> {
  const leadId = String(formData.get('lead_id') ?? '');
  const newStatusRaw = String(formData.get('new_status') ?? '');
  const expectedLastUpdated = String(formData.get('last_updated_at') ?? '');

  if (!UUID_RE.test(leadId)) {
    return { status: 'error', message: 'Invalid lead id.' };
  }
  if (!VALID_STATUSES.includes(newStatusRaw as LeadStatus)) {
    return { status: 'error', message: 'Invalid status value.' };
  }
  const newStatus = newStatusRaw as LeadStatus;

  const supabase = createClient();

  // 1. Read current row (RLS-scoped).
  const { data: current, error: readErr } = await supabase
    .from('leads')
    .select('status, last_updated_at')
    .eq('id', leadId)
    .maybeSingle();

  if (readErr) {
    console.error('[updateLeadStatus] read failed', readErr);
    return { status: 'error', message: 'Could not load lead.' };
  }
  if (!current) {
    return { status: 'error', message: 'Lead not found.' };
  }

  // 2. Stale-write guard.
  if (expectedLastUpdated && current.last_updated_at !== expectedLastUpdated) {
    return {
      status: 'error',
      message: 'This lead was updated elsewhere, refresh and try again.',
    };
  }

  const fromStatus = current.status;

  // 3. No-op short-circuit.
  if (fromStatus === newStatus) {
    return { status: 'success', newStatus };
  }

  // 4. Update.
  const { error: updateErr } = await supabase
    .from('leads')
    .update({ status: newStatus })
    .eq('id', leadId);

  if (updateErr) {
    console.error('[updateLeadStatus] update failed', updateErr);
    return { status: 'error', message: 'Could not save status.' };
  }

  // 5. Log event (best-effort).
  const { error: eventErr } = await supabase.from('lead_events').insert({
    lead_id: leadId,
    event_type: 'status_changed',
    payload: { from: fromStatus, to: newStatus },
  });
  if (eventErr) {
    console.error(
      '[updateLeadStatus] event insert failed (status persisted)',
      { leadId, eventErr },
    );
  }

  // 6. Reactive follow-up scheduling.
  //   - quoted        -> cancel-and-replace 7d_quote_followup
  //   - won/lost/cold -> cancel ALL pending follow-ups (terminal status)
  // Other transitions (e.g. new -> contacted) are handled lazily by the
  // cron processor's pre-flight check; we don't need to mutate the
  // follow_ups table on every step. Helpers log but never throw.
  if (newStatus === 'quoted') {
    await scheduleQuoteFollowUp(supabase, { leadId });
  } else if (newStatus === 'won' || newStatus === 'lost' || newStatus === 'cold') {
    await cancelAllPendingFollowUps(supabase, { leadId });
  }

  // 7. Revalidate.
  revalidatePath(`/app/leads/${leadId}`);
  revalidatePath('/app/leads');

  return { status: 'success', newStatus };
}
