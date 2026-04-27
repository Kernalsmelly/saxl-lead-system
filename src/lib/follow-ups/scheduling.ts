import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/db/types';

// Helpers for managing follow_ups rows. Reactive scheduling:
//   - On lead create (webhook handler): schedule 48h_response + 14d_cold_check.
//   - On status -> 'quoted' (status action): cancel-and-replace 7d_quote_followup.
//   - On status -> won/lost/cold (status action): cancel ALL pending.
//
// All helpers take a Supabase client as a parameter so the caller can
// pick the right auth context — the webhook uses the service client
// (no user session), the status action uses the SSR client (RLS-scoped
// to the tenant). Both work as long as the caller already passed the
// usual auth/tenant gates.
//
// Helpers never throw on Postgres errors — they log and return so the
// hot path (lead capture, status update) is never blocked. The cron
// processor is the audit/retry mechanism, not these schedulers.

type DbClient = SupabaseClient<Database>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Schedule the two follow-ups that always fire from the moment a lead
 * is captured: a 48-hour response reminder and a 14-day cold check.
 * Both are anchored to the lead's received_at so the cadence reflects
 * actual elapsed time, not capture wall-clock.
 */
export async function scheduleFollowUpsOnLeadCreate(
  supabase: DbClient,
  args: { leadId: string; receivedAt: string },
): Promise<void> {
  const received = new Date(args.receivedAt);
  const due48h = new Date(received.getTime() + 48 * HOUR_MS).toISOString();
  const due14d = new Date(received.getTime() + 14 * DAY_MS).toISOString();

  const { error } = await supabase.from('follow_ups').insert([
    { lead_id: args.leadId, type: '48h_response', due_at: due48h, status: 'pending' },
    { lead_id: args.leadId, type: '14d_cold_check', due_at: due14d, status: 'pending' },
  ]);
  if (error) {
    console.error('[follow-ups/schedule] lead-create insert failed', {
      leadId: args.leadId,
      error,
    });
  }
}

/**
 * Cancel-and-replace pattern for the 7-day quote followup.
 *
 * If a lead bounces quoted -> contacted -> quoted, we don't want two
 * pending 7-day reminders. Cancel any pending 7d_quote_followup for
 * this lead first, then insert a fresh one anchored to NOW.
 *
 * Idempotent: calling twice in a row leaves exactly one pending row,
 * with due_at on the most recent call.
 */
export async function scheduleQuoteFollowUp(
  supabase: DbClient,
  args: { leadId: string; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  const dueAt = new Date(now.getTime() + 7 * DAY_MS).toISOString();

  const { error: cancelErr } = await supabase
    .from('follow_ups')
    .update({ status: 'cancelled' })
    .eq('lead_id', args.leadId)
    .eq('type', '7d_quote_followup')
    .eq('status', 'pending');
  if (cancelErr) {
    console.error('[follow-ups/schedule] cancel-prev 7d failed', {
      leadId: args.leadId,
      error: cancelErr,
    });
    // Continue anyway — at worst we end up with two pending rows; the
    // cron processor will fire two reminders, which is a minor annoyance,
    // not data corruption.
  }

  const { error: insertErr } = await supabase.from('follow_ups').insert({
    lead_id: args.leadId,
    type: '7d_quote_followup',
    due_at: dueAt,
    status: 'pending',
  });
  if (insertErr) {
    console.error('[follow-ups/schedule] insert 7d failed', {
      leadId: args.leadId,
      error: insertErr,
    });
  }
}

/**
 * Cancel all pending follow-ups for a lead. Called from the status
 * action when a lead moves to a terminal status (won/lost/cold) — at
 * that point no further reminders make sense.
 */
export async function cancelAllPendingFollowUps(
  supabase: DbClient,
  args: { leadId: string },
): Promise<void> {
  const { error } = await supabase
    .from('follow_ups')
    .update({ status: 'cancelled' })
    .eq('lead_id', args.leadId)
    .eq('status', 'pending');
  if (error) {
    console.error('[follow-ups/schedule] cancel-all failed', {
      leadId: args.leadId,
      error,
    });
  }
}
