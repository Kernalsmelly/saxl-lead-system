import 'server-only';
import { Resend } from 'resend';

import { env } from '@/lib/env';
import { formatEnum } from '@/lib/format';
import type { Database } from '@/lib/db/types';

// Follow-up reminder emails. Three templates today:
//   - 48h_response  — "you haven't reached back yet"
//   - 7d_quote_followup  — "you quoted X a week ago"
//   - 14d_cold_check  — "this lead's gone cold"
//
// Same shape as the new-lead notification: pure renderer + thin sender.
// Renderer is unit-testable; sender catches everything and returns
// { success, error }.

type FollowUpType = Database['public']['Enums']['follow_up_type'];
type LeadStatus = Database['public']['Enums']['lead_status'];

export interface FollowUpEmailLead {
  id: string;
  name: string | null;
  service_type: string | null;
  city: string | null;
  status: LeadStatus;
}

export interface RenderFollowUpEmailArgs {
  type: Exclude<FollowUpType, 'custom'>;
  tenantName: string;
  lead: FollowUpEmailLead;
  appBaseUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Copy {
  subject: string;
  headline: string;
  body: string;
}

function copyFor(args: {
  type: Exclude<FollowUpType, 'custom'>;
  displayName: string;
  serviceLabel: string;
  cityLabel: string;
  statusLabel: string;
}): Copy {
  switch (args.type) {
    case '48h_response':
      return {
        subject: `Heads up — ${args.displayName} reached out 48 hours ago`,
        headline: `${args.displayName} is still waiting to hear back.`,
        body:
          `It's been 48 hours since ${args.displayName} submitted a request, and ` +
          `the lead is still marked New. ${args.serviceLabel} job in ${args.cityLabel}. ` +
          `Worth a quick reply now — speed of response is the single biggest ` +
          `predictor of whether a lead converts.`,
      };
    case '7d_quote_followup':
      return {
        subject: `Quick reminder — quote sent to ${args.displayName} a week ago`,
        headline: `${args.displayName} hasn't replied to your quote yet.`,
        body:
          `It's been 7 days since you quoted ${args.displayName} for a ` +
          `${args.serviceLabel} job in ${args.cityLabel}. A short check-in ` +
          `("just making sure this didn't get lost in your inbox") usually ` +
          `gets a yes or a no — both better than silence.`,
      };
    case '14d_cold_check':
      return {
        subject: `${args.displayName} has gone cold — close it out?`,
        headline: `${args.displayName} reached out 14 days ago and is still ${args.statusLabel}.`,
        body:
          `Two weeks in, ${args.displayName} is still marked ${args.statusLabel}. ` +
          `Worth one more attempt — or mark it lost/cold so it stops cluttering ` +
          `your active pipeline.`,
      };
  }
}

/**
 * Build subject + html + text for a follow-up reminder. Pure.
 */
export function renderFollowUpEmail(args: RenderFollowUpEmailArgs): RenderedEmail {
  const displayName = args.lead.name?.trim() || 'A prospect';
  const serviceLabel = args.lead.service_type ? formatEnum(args.lead.service_type) : 'service';
  const cityLabel = args.lead.city?.trim() || 'their area';
  const statusLabel = formatEnum(args.lead.status);
  const dashboardUrl = `${args.appBaseUrl}/app/leads/${args.lead.id}`;

  const copy = copyFor({ type: args.type, displayName, serviceLabel, cityLabel, statusLabel });

  const text = [
    copy.headline,
    '',
    copy.body,
    '',
    `View lead: ${dashboardUrl}`,
    '',
    '—',
    `${args.tenantName} · Saxl Labs Lead System`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(copy.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
      <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:24px;">
        <h1 style="margin:0 0 12px;font-size:18px;font-weight:600;letter-spacing:-0.01em;">
          ${escapeHtml(copy.headline)}
        </h1>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f3f46;">
          ${escapeHtml(copy.body)}
        </p>
        <p style="margin:0 0 8px;">
          <a href="${escapeHtml(dashboardUrl)}"
             style="display:inline-block;padding:10px 16px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">
            View lead →
          </a>
        </p>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#71717a;text-align:center;">
        ${escapeHtml(args.tenantName)} · Saxl Labs Lead System
      </p>
    </div>
  </body>
</html>`;

  return { subject: copy.subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------

export interface SendFollowUpReminderArgs {
  type: Exclude<FollowUpType, 'custom'>;
  to: string;
  tenantName: string;
  lead: FollowUpEmailLead;
}

export type SendResult = { success: true; id: string } | { success: false; error: string };

let _client: Resend | null = null;
function client(): Resend {
  if (!_client) _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

/**
 * Fire a follow-up reminder email. Never throws.
 */
export async function sendFollowUpReminder(
  args: SendFollowUpReminderArgs,
): Promise<SendResult> {
  try {
    const { subject, html, text } = renderFollowUpEmail({
      type: args.type,
      tenantName: args.tenantName,
      lead: args.lead,
      appBaseUrl: env.APP_BASE_URL.replace(/\/+$/, ''),
    });

    const result = await client().emails.send({
      from: env.NOTIFICATIONS_FROM_EMAIL,
      to: args.to,
      subject,
      html,
      text,
    });

    if (result.error) {
      return { success: false, error: result.error.message ?? 'unknown Resend error' };
    }
    if (!result.data?.id) {
      return { success: false, error: 'Resend returned no message id' };
    }
    return { success: true, id: result.data.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
