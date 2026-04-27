import 'server-only';
import { Resend } from 'resend';

import { env } from '@/lib/env';
import { formatEnum } from '@/lib/format';

// Owner-notification email for newly captured leads.
//
// Two exports:
//   - renderNewLeadEmail() — pure function, returns { subject, html, text }.
//     Pure-by-design so it's unit-testable without spinning up Resend.
//   - sendNewLeadNotification() — wraps Resend, never throws. Returns
//     { success, error? } so the caller (webhook handler) can log a
//     lead_event row reflecting delivery success/failure.
//
// HTML is intentionally minimal — inline styles, no template engine.
// Owner inboxes are mostly Gmail/Apple Mail/Outlook; basic table-free
// HTML renders fine and stays readable on phones.

export interface NewLeadEmailLead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  service_type: string | null;
  city: string | null;
  source: string;
}

export interface RenderNewLeadEmailArgs {
  tenantName: string;
  lead: NewLeadEmailLead;
  /**
   * Base URL the dashboard link in the email should point at, with no
   * trailing slash (e.g. "https://app.saxllabs.com" or "http://localhost:3000").
   */
  appBaseUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Build the rendered email payload (subject + html + text) for a new
 * lead notification. Pure function — no side effects, no I/O.
 */
export function renderNewLeadEmail(args: RenderNewLeadEmailArgs): RenderedEmail {
  const { tenantName, lead, appBaseUrl } = args;

  const displayName = lead.name?.trim() || 'A new prospect';
  const serviceLabel = formatEnum(lead.service_type);
  const sourceLabel = formatEnum(lead.source);
  const dashboardUrl = `${appBaseUrl}/app/leads/${lead.id}`;

  const subject = `New lead — ${displayName} (${serviceLabel})`;

  // Plain-text version — also used as preview/fallback by some clients.
  const text = [
    `${displayName} submitted a request through your website.`,
    '',
    `Phone: ${lead.phone ?? '—'}`,
    `Email: ${lead.email ?? '—'}`,
    `Service: ${serviceLabel}`,
    `City: ${lead.city ?? '—'}`,
    `Source: ${sourceLabel}`,
    '',
    `View lead details: ${dashboardUrl}`,
    '',
    '—',
    `${tenantName} · Saxl Labs Lead System`,
  ].join('\n');

  // Inline-styled HTML. No <table>, no media queries — relies on the
  // viewport meta + max-width to behave on mobile.
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
      <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:24px;">
        <h1 style="margin:0 0 12px;font-size:18px;font-weight:600;letter-spacing:-0.01em;">
          New lead for ${escapeHtml(tenantName)}
        </h1>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#3f3f46;">
          ${escapeHtml(displayName)} submitted a request through your website.
        </p>
        <dl style="margin:0 0 20px;font-size:14px;line-height:1.6;">
          ${renderRow('Phone', lead.phone)}
          ${renderRow('Email', lead.email)}
          ${renderRow('Service', serviceLabel)}
          ${renderRow('City', lead.city)}
          ${renderRow('Source', sourceLabel)}
        </dl>
        <p style="margin:0 0 8px;">
          <a href="${escapeHtml(dashboardUrl)}"
             style="display:inline-block;padding:10px 16px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">
            View lead details →
          </a>
        </p>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#71717a;text-align:center;">
        ${escapeHtml(tenantName)} · Saxl Labs Lead System
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

function renderRow(label: string, value: string | null | undefined): string {
  const display = value && value.trim() ? value : '—';
  return `
    <div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #f4f4f5;">
      <dt style="flex:0 0 80px;color:#71717a;">${escapeHtml(label)}</dt>
      <dd style="margin:0;color:#18181b;">${escapeHtml(display)}</dd>
    </div>`;
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

export interface SendNewLeadNotificationArgs {
  /** Recipient address — typically tenant.owner_email (looked up via auth.users). */
  to: string;
  tenantName: string;
  lead: NewLeadEmailLead;
}

export type SendResult = { success: true; id: string } | { success: false; error: string };

// Lazily construct the Resend client so importing this module in
// non-server contexts (e.g. accidental client import) fails predictably
// and so unit tests can mock the Resend constructor at module level.
let _client: Resend | null = null;
function client(): Resend {
  if (!_client) _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

/**
 * Send the new-lead notification email.
 *
 * Never throws. All errors — Resend API errors, network errors,
 * malformed inputs — are caught and returned as
 * { success: false, error }. The webhook handler logs a
 * lead_event row reflecting the result so we have an audit trail
 * even when Resend is degraded.
 */
export async function sendNewLeadNotification(
  args: SendNewLeadNotificationArgs,
): Promise<SendResult> {
  try {
    const { subject, html, text } = renderNewLeadEmail({
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
