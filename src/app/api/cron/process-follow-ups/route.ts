import { NextResponse, type NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { decideFollowUpAction } from '@/lib/follow-ups/decide';
import { sendFollowUpReminder } from '@/lib/notifications/follow-up-emails';

// Follow-up cron processor.
//
// Vercel Cron will hit this every 15 minutes with an
//   Authorization: Bearer <CRON_SECRET>
// header. For local manual testing the same secret can be passed as
// a ?secret=... query string.
//
// Each invocation:
//   1. Verifies the caller (Bearer header OR ?secret= query).
//   2. Selects all follow_ups where status='pending' AND due_at <= now,
//      joined to the lead so we have the current status.
//   3. For each row:
//        - decideFollowUpAction() picks an outcome from a discriminated
//          union — exhaustive switch makes new types/skip-reasons a
//          compile error.
//        - 'send'  -> resolve owner email, send reminder, mark row
//                     'sent', log a follow_up_sent event with the
//                     send result.
//        - any 'skip_*' -> mark the row 'cancelled' with no event log
//                          (audit log is for things that happened, not
//                          for things that didn't).
//   4. Returns { processed, sent, cancelled, errors, details } so a
//      human reading Vercel logs can spot drift.
//
// Each row is wrapped in its own try/catch so one failure doesn't
// kill the batch. Concurrency: at v1 volume (handful of rows per
// 15-minute tick) we don't bother with SELECT FOR UPDATE — overlapping
// cron invocations would be a real bug to investigate, not a
// double-send to silence with row locks.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RowDetail {
  follow_up_id: string;
  lead_id: string;
  type: string;
  outcome:
    | 'sent'
    | 'cancelled_lead_not_found'
    | 'cancelled_terminal_status'
    | 'cancelled_status_no_longer_applicable'
    | 'error_send_failed'
    | 'error_unexpected';
  error?: string;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  // Pull pending rows that are due. Embed the lead's current state and
  // the tenant's name for the email template; tenant.owner_user_id is
  // resolved server-side via the auth admin API below.
  const { data: rows, error: queryErr } = await supabase
    .from('follow_ups')
    .select(
      `
      id,
      lead_id,
      type,
      due_at,
      lead:leads!inner (
        id,
        status,
        name,
        service_type,
        city,
        tenant:tenants!inner (
          id,
          name,
          owner_user_id
        )
      )
    `,
    )
    .eq('status', 'pending')
    .lte('due_at', now);

  if (queryErr) {
    console.error('[cron/follow-ups] query failed', queryErr);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }

  const details: RowDetail[] = [];
  let sentCount = 0;
  let cancelledCount = 0;
  let errorCount = 0;

  for (const row of rows ?? []) {
    try {
      const lead = row.lead;
      const tenant = lead?.tenant;

      const action = decideFollowUpAction(
        { id: row.id, lead_id: row.lead_id, type: row.type },
        lead ? { id: lead.id, status: lead.status } : null,
      );

      switch (action.kind) {
        case 'send': {
          // 7d_quote_followup is the only type that requires a non-null
          // tenant — but practically all three do, since we need the
          // owner_user_id. If we somehow have a row without a tenant,
          // skip with an error rather than send a malformed email.
          if (!tenant || !lead) {
            await markCancelled(row.id);
            details.push({
              follow_up_id: row.id,
              lead_id: row.lead_id,
              type: row.type,
              outcome: 'cancelled_lead_not_found',
            });
            cancelledCount++;
            break;
          }

          if (row.type === 'custom') {
            // Renderer doesn't know how to render 'custom'; skip until
            // the v2 UI defines copy for it. Mark cancelled so we
            // don't loop on it.
            await markCancelled(row.id);
            details.push({
              follow_up_id: row.id,
              lead_id: row.lead_id,
              type: row.type,
              outcome: 'cancelled_status_no_longer_applicable',
            });
            cancelledCount++;
            break;
          }

          // Resolve owner email. If this fails, we treat it as a send
          // error — leave the row pending so the next tick can retry
          // (e.g. transient auth admin blip).
          const { data: userRes, error: userErr } =
            await supabase.auth.admin.getUserById(tenant.owner_user_id);
          if (userErr || !userRes.user?.email) {
            const message = userErr?.message ?? 'owner has no email';
            await logFollowUpSent(row.id, row.lead_id, row.type, false, message);
            details.push({
              follow_up_id: row.id,
              lead_id: row.lead_id,
              type: row.type,
              outcome: 'error_send_failed',
              error: message,
            });
            errorCount++;
            break;
          }

          const send = await sendFollowUpReminder({
            type: row.type,
            to: userRes.user.email,
            tenantName: tenant.name,
            lead: {
              id: lead.id,
              name: lead.name,
              service_type: lead.service_type,
              city: lead.city,
              status: lead.status,
            },
          });

          if (!send.success) {
            // Leave row 'pending' so a future tick retries. Log the
            // attempt as a follow_up_sent event with success=false so
            // the audit trail is complete.
            await logFollowUpSent(row.id, row.lead_id, row.type, false, send.error);
            details.push({
              follow_up_id: row.id,
              lead_id: row.lead_id,
              type: row.type,
              outcome: 'error_send_failed',
              error: send.error,
            });
            errorCount++;
            break;
          }

          await markSent(row.id);
          await logFollowUpSent(row.id, row.lead_id, row.type, true);
          details.push({
            follow_up_id: row.id,
            lead_id: row.lead_id,
            type: row.type,
            outcome: 'sent',
          });
          sentCount++;
          break;
        }

        case 'skip_lead_not_found': {
          await markCancelled(row.id);
          details.push({
            follow_up_id: row.id,
            lead_id: row.lead_id,
            type: row.type,
            outcome: 'cancelled_lead_not_found',
          });
          cancelledCount++;
          break;
        }

        case 'skip_terminal_status': {
          await markCancelled(row.id);
          details.push({
            follow_up_id: row.id,
            lead_id: row.lead_id,
            type: row.type,
            outcome: 'cancelled_terminal_status',
          });
          cancelledCount++;
          break;
        }

        case 'skip_status_no_longer_applicable': {
          await markCancelled(row.id);
          details.push({
            follow_up_id: row.id,
            lead_id: row.lead_id,
            type: row.type,
            outcome: 'cancelled_status_no_longer_applicable',
          });
          cancelledCount++;
          break;
        }

        default: {
          // Exhaustiveness check — if a new action.kind is added, this
          // line stops compiling.
          const _exhaustive: never = action;
          void _exhaustive;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[cron/follow-ups] row failed', { id: row.id, error: message });
      details.push({
        follow_up_id: row.id,
        lead_id: row.lead_id,
        type: row.type,
        outcome: 'error_unexpected',
        error: message,
      });
      errorCount++;
    }
  }

  return NextResponse.json(
    {
      ran_at: now,
      processed: rows?.length ?? 0,
      sent: sentCount,
      cancelled: cancelledCount,
      errors: errorCount,
      details,
    },
    { status: 200 },
  );

  async function markSent(id: string) {
    const { error } = await supabase
      .from('follow_ups')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', id);
    if (error) console.error('[cron/follow-ups] markSent failed', { id, error });
  }

  async function markCancelled(id: string) {
    const { error } = await supabase
      .from('follow_ups')
      .update({ status: 'cancelled' })
      .eq('id', id);
    if (error) console.error('[cron/follow-ups] markCancelled failed', { id, error });
  }

  async function logFollowUpSent(
    followUpId: string,
    leadId: string,
    type: string,
    success: boolean,
    errorMessage?: string,
  ) {
    const { error } = await supabase.from('lead_events').insert({
      lead_id: leadId,
      event_type: 'follow_up_sent',
      payload: {
        follow_up_id: followUpId,
        type,
        success,
        error: errorMessage ?? null,
      },
    });
    if (error) {
      console.error('[cron/follow-ups] follow_up_sent event insert failed', {
        followUpId,
        error,
      });
    }
  }
}

/**
 * Authorize the caller. Vercel Cron sends:
 *   Authorization: Bearer <CRON_SECRET>
 * For manual local testing, ?secret=<CRON_SECRET> works equivalently.
 *
 * Both paths use timingSafeEqual on a SHA-256 hash so the comparison
 * doesn't leak length or content via timing.
 */
function isAuthorized(request: NextRequest): boolean {
  const expected = env.CRON_SECRET;

  const authz = request.headers.get('authorization');
  const headerSecret =
    authz && authz.toLowerCase().startsWith('bearer ')
      ? authz.slice('bearer '.length).trim()
      : null;

  const querySecret = request.nextUrl.searchParams.get('secret');

  const presented = headerSecret ?? querySecret;
  if (!presented) return false;

  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}
