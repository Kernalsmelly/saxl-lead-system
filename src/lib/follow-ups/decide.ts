import type { Database } from '@/lib/db/types';

// Pure decision logic for the follow-up cron processor.
//
// Why this is split out:
//   - The cron route handler does a lot of I/O (auth check, DB read,
//     email send, DB write). Per-row "should I send this?" logic is
//     the easiest part to reason about wrong, so we lift it out as a
//     pure function and unit-test every branch.
//   - The discriminated-union return type forces the caller to handle
//     each outcome explicitly. Adding a new follow-up type or a new
//     skip reason becomes a compile error in every consumer until they
//     wire it up — no silently-ignored cases.

export type LeadStatus = Database['public']['Enums']['lead_status'];
export type FollowUpType = Database['public']['Enums']['follow_up_type'];

export interface FollowUpRow {
  id: string;
  lead_id: string;
  type: FollowUpType;
}

export interface LeadSnapshot {
  id: string;
  status: LeadStatus;
}

/**
 * What the cron processor should do with a single pending follow-up.
 *
 *   send                              — preconditions still hold; fire the email
 *   skip_lead_not_found               — orphan row (shouldn't happen with
 *                                       FK ON DELETE CASCADE, but defensive)
 *   skip_terminal_status              — lead is won/lost/cold; reminder is moot
 *   skip_status_no_longer_applicable  — type-specific precondition has lapsed
 *                                       (e.g. 48h_response but lead is no
 *                                       longer 'new')
 */
export type FollowUpAction =
  | { kind: 'send' }
  | { kind: 'skip_lead_not_found' }
  | { kind: 'skip_terminal_status'; currentStatus: LeadStatus }
  | {
      kind: 'skip_status_no_longer_applicable';
      type: FollowUpType;
      currentStatus: LeadStatus;
    };

const TERMINAL_STATUSES: readonly LeadStatus[] = ['won', 'lost', 'cold'] as const;

/**
 * Decide what to do with a pending follow-up given the lead's current
 * snapshot. Pure; no side effects.
 *
 * Pass `lead = null` if the lead row was not found (deleted or hidden
 * from the caller's RLS scope) — the function will tell you to skip it.
 */
export function decideFollowUpAction(
  followUp: FollowUpRow,
  lead: LeadSnapshot | null,
): FollowUpAction {
  if (!lead) {
    return { kind: 'skip_lead_not_found' };
  }

  if (TERMINAL_STATUSES.includes(lead.status)) {
    return { kind: 'skip_terminal_status', currentStatus: lead.status };
  }

  switch (followUp.type) {
    case '48h_response':
      // Reminder is "you haven't responded yet" — only valid while still 'new'.
      if (lead.status !== 'new') {
        return {
          kind: 'skip_status_no_longer_applicable',
          type: followUp.type,
          currentStatus: lead.status,
        };
      }
      return { kind: 'send' };

    case '7d_quote_followup':
      // "Time to check in on a sent quote" — only valid while still 'quoted'.
      if (lead.status !== 'quoted') {
        return {
          kind: 'skip_status_no_longer_applicable',
          type: followUp.type,
          currentStatus: lead.status,
        };
      }
      return { kind: 'send' };

    case '14d_cold_check':
      // "This lead's gone cold" — valid while still 'new' or 'contacted'.
      if (lead.status !== 'new' && lead.status !== 'contacted') {
        return {
          kind: 'skip_status_no_longer_applicable',
          type: followUp.type,
          currentStatus: lead.status,
        };
      }
      return { kind: 'send' };

    case 'custom':
      // v1 doesn't define preconditions for custom follow-ups; if anyone
      // schedules one, it fires on its due date. (No UI to create these
      // yet — placeholder for v2.)
      return { kind: 'send' };

    default:
      return assertNever(followUp.type);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled follow-up type: ${String(value)}`);
}
