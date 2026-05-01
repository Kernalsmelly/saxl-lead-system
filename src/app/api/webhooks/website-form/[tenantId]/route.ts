import { NextResponse, type NextRequest } from 'next/server';
import { waitUntil } from '@vercel/functions';

import { createServiceClient } from '@/lib/supabase/service';
import { verifySignature } from '@/lib/webhooks/signature';
import {
  mapPayloadToLeadColumns,
  websiteFormPayloadSchema,
} from '@/lib/webhooks/lead-mapping';
import { sendNewLeadNotification } from '@/lib/notifications/email';
import { scheduleFollowUpsOnLeadCreate } from '@/lib/follow-ups/scheduling';
import { parseLead } from '@/lib/parsing/lead-parser';

// Inbound website-form webhook.
//
// Order of checks matches project rules:
//   1. 415 — Content-Type must be application/json
//   2. 404 — tenant UUID shape / tenant row missing / channel row missing
//   3. 403 — channel row present but disabled or missing its secret
//   4. 401 — signature missing / malformed / expired / wrong
//   5. 400 — invalid JSON / schema validation / phone+email both missing
//   6. 200 — { lead_id }
//
// Tenant + channel lookups happen BEFORE signature math so obviously bad
// requests fail fast.

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: { tenantId: string } },
) {
  // 1. Content-Type gate.
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  // 2. Tenant id shape check — avoids a round-trip on garbage paths.
  const { tenantId } = params;
  if (!UUID_RE.test(tenantId)) {
    return json({ error: 'tenant not found' }, 404);
  }

  const supabase = createServiceClient();

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, owner_user_id')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantErr) {
    console.error('[webhook/website-form] tenant lookup failed', tenantErr);
    return json({ error: 'internal error' }, 500);
  }
  if (!tenant) {
    return json({ error: 'tenant not found' }, 404);
  }

  // 3. Channel row: must exist, must be enabled, must have a secret.
  const { data: channel, error: channelErr } = await supabase
    .from('tenant_channels')
    .select('enabled, config')
    .eq('tenant_id', tenantId)
    .eq('channel_type', 'website_form')
    .maybeSingle();
  if (channelErr) {
    console.error('[webhook/website-form] channel lookup failed', channelErr);
    return json({ error: 'internal error' }, 500);
  }
  if (!channel) {
    // No channel configured for this tenant = endpoint isn't wired up.
    return json({ error: 'channel not configured' }, 404);
  }
  if (!channel.enabled) {
    return json({ error: 'channel disabled' }, 403);
  }

  const config = (channel.config ?? {}) as { webhook_secret?: unknown };
  const secret =
    typeof config.webhook_secret === 'string' ? config.webhook_secret : null;
  if (!secret) {
    // Enabled but no secret set — can't authenticate the caller. Surface
    // as 403 rather than 401 since we never reached signature math.
    console.error(
      '[webhook/website-form] channel enabled but webhook_secret missing',
      { tenantId },
    );
    return json({ error: 'channel misconfigured' }, 403);
  }

  // 4. Read raw body once, verify signature before parsing JSON.
  const rawBody = await request.text();
  const verification = verifySignature({
    header: request.headers.get('x-saxl-signature'),
    body: rawBody,
    secret,
  });
  if (!verification.ok) {
    return json({ error: 'invalid signature' }, 401);
  }

  // 5. Parse + validate.
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = websiteFormPayloadSchema.safeParse(rawJson);
  if (!parsed.success) {
    return json(
      { error: 'validation failed', issues: parsed.error.issues },
      400,
    );
  }

  // 6. Insert lead (raw_payload preserves the full original input —
  // including keys not mapped to columns, e.g. photos).
  // raw_payload is typed as Json by the generated Database types; we
  // already know rawJson came from JSON.parse, so the cast is safe.
  const leadInsert = {
    tenant_id: tenantId,
    source: 'website_form' as const,
    status: 'new' as const,
    raw_payload: rawJson as import('@/lib/db/types').Json,
    ...mapPayloadToLeadColumns(parsed.data),
  };

  const { data: lead, error: insertErr } = await supabase
    .from('leads')
    .insert(leadInsert)
    .select('id, name, phone, email, service_type, city, source, received_at')
    .single();
  if (insertErr || !lead) {
    console.error('[webhook/website-form] lead insert failed', insertErr);
    return json({ error: 'internal error' }, 500);
  }

  // 7. Log capture event. Best-effort: if this fails, the lead is already
  // persisted and we don't want to surface a 5xx or retry-duplicate the
  // lead. Log loudly so we can spot event-log drift.
  const { error: eventErr } = await supabase.from('lead_events').insert({
    lead_id: lead.id,
    event_type: 'captured',
    payload: { via: 'website_form_webhook' },
  });
  if (eventErr) {
    console.error(
      '[webhook/website-form] lead_events insert failed (lead persisted)',
      { leadId: lead.id, err: eventErr },
    );
  }

  // 8. Schedule reactive follow-ups (48h response reminder + 14d cold
  // check). Both anchored to received_at so they reflect actual elapsed
  // time, not capture wall-clock. Awaited because the rows are part of
  // capture state — a 200 OK should mean "we captured the lead AND
  // scheduled its follow-ups." The helper logs but never throws, so a
  // transient Postgres error here can't 500 the prospect's request.
  await scheduleFollowUpsOnLeadCreate(supabase, {
    leadId: lead.id,
    receivedAt: lead.received_at,
  });

  // 9. Owner notification — fire-and-forget.
  // Lead capture is the critical path; the email is a nice-to-have.
  // We do NOT await the send before returning 200, so a slow/down
  // Resend never delays the prospect's form response. waitUntil()
  // declares the work as part of the request lifecycle so on Vercel
  // the function isn't suspended before the send completes — locally
  // (Node) it's effectively a no-op.
  //
  // Both success and failure are written to lead_events as
  // 'owner_notified' so we have an audit trail when Resend is
  // degraded.
  waitUntil(
    notifyOwner({
      tenantId,
      tenantName: tenant.name,
      ownerUserId: tenant.owner_user_id,
      lead,
    }),
  );

  // 10. AI parsing & enrichment — fire-and-forget, parallel with the
  // owner notification. Runs the unstructured `message` text through
  // Claude, fills in any null columns the form left blank, and logs an
  // 'ai_parsed' lead_event with the outcome. Skipped if the form
  // didn't include a message (no unstructured text to parse).
  const messageText = parsed.data.message ?? null;
  if (messageText) {
    waitUntil(
      parseAndEnrichLead({
        leadId: lead.id,
        rawText: messageText,
      }),
    );
  }

  return json({ lead_id: lead.id }, 200);
}

/**
 * Resolve the owner email, send the notification, and log a
 * lead_events row reflecting the outcome. Never throws — all
 * errors land as { success: false, error } and get persisted.
 */
async function notifyOwner(args: {
  tenantId: string;
  tenantName: string;
  ownerUserId: string;
  lead: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    service_type: string | null;
    city: string | null;
    source: string;
  };
}): Promise<void> {
  const supabase = createServiceClient();

  let result: { success: boolean; error?: string };

  try {
    // Resolve owner email via the auth admin API. The tenants table
    // doesn't store the email — owner_user_id is the only link to
    // auth.users, so identity = notification address by default.
    const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(
      args.ownerUserId,
    );
    if (userErr) throw new Error(`auth.admin.getUserById: ${userErr.message}`);
    const ownerEmail = userRes.user?.email;
    if (!ownerEmail) throw new Error('owner has no email on auth record');

    const sendResult = await sendNewLeadNotification({
      to: ownerEmail,
      tenantName: args.tenantName,
      lead: args.lead,
    });
    result = sendResult.success
      ? { success: true }
      : { success: false, error: sendResult.error };
  } catch (err) {
    result = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!result.success) {
    console.error('[webhook/website-form] owner notification failed', {
      leadId: args.lead.id,
      tenantId: args.tenantId,
      error: result.error,
    });
  }

  const { error: evtErr } = await supabase.from('lead_events').insert({
    lead_id: args.lead.id,
    event_type: 'owner_notified',
    payload: {
      success: result.success,
      error: result.error ?? null,
    },
  });
  if (evtErr) {
    console.error(
      '[webhook/website-form] owner_notified event insert failed',
      { leadId: args.lead.id, err: evtErr },
    );
  }
}

/**
 * Run the AI parser over a lead's unstructured message text, patch
 * null columns with whatever it extracted, and log an `ai_parsed`
 * lead_event with the outcome. Never throws.
 *
 * Patch rules (locked Day 7):
 *   - Structured fields (name, phone, email, service_type, city, zip,
 *     address, preferred_date): only patch when the existing column
 *     value is null AND the parsed value is non-null. Don't overwrite
 *     explicit form input with AI guesses.
 *   - notes: overwrite only when parsed.notes is non-empty AND
 *     parsed_confidence >= 0.5. The form's notes is just a copy of
 *     raw_payload.message, so we can safely upgrade it to the AI
 *     summary at the threshold; below the threshold, keep the raw
 *     message rather than risk the AI silently degrading signal.
 *   - parsed_confidence: always patch with the parsed value (or null
 *     if the parse failed) so the column reflects the most recent
 *     attempt.
 */
async function parseAndEnrichLead(args: {
  leadId: string;
  rawText: string;
}): Promise<void> {
  const supabase = createServiceClient();

  const result = await parseLead({ rawText: args.rawText, channelHint: 'website_form' });

  // On parse failure: still log the attempt; clear parsed_confidence
  // so the dashboard doesn't show a stale value from a prior attempt.
  if (!result.success) {
    console.error('[webhook/website-form] AI parse failed', {
      leadId: args.leadId,
      error: result.error,
    });
    await supabase.from('leads').update({ parsed_confidence: null }).eq('id', args.leadId);
    const { error: evtErr } = await supabase.from('lead_events').insert({
      lead_id: args.leadId,
      event_type: 'ai_parsed',
      payload: {
        success: false,
        error: result.error,
        fields_updated: [],
      },
    });
    if (evtErr) {
      console.error('[webhook/website-form] ai_parsed event insert failed', {
        leadId: args.leadId,
        err: evtErr,
      });
    }
    return;
  }

  // Read current row so we know which columns are null.
  const { data: current, error: readErr } = await supabase
    .from('leads')
    .select(
      'name, phone, email, service_type, city, zip, address, preferred_date, notes',
    )
    .eq('id', args.leadId)
    .maybeSingle();

  if (readErr || !current) {
    console.error('[webhook/website-form] AI enrich read failed', {
      leadId: args.leadId,
      error: readErr,
    });
    return;
  }

  const { parsed } = result;
  // Use the generated TablesUpdate shape so the column names + value
  // types are checked at compile time.
  const patch: import('@/lib/db/types').Database['public']['Tables']['leads']['Update'] = {};
  const fieldsUpdated: string[] = [];

  // Structured fields: fill nulls only.
  const fillIfNull = (
    key: 'name' | 'phone' | 'email' | 'service_type' | 'city' | 'zip' | 'address' | 'preferred_date',
  ) => {
    if (current[key] === null && parsed[key] !== null) {
      patch[key] = parsed[key];
      fieldsUpdated.push(key);
    }
  };
  fillIfNull('name');
  fillIfNull('phone');
  fillIfNull('email');
  fillIfNull('service_type');
  fillIfNull('city');
  fillIfNull('zip');
  fillIfNull('address');
  fillIfNull('preferred_date');

  // notes: overwrite if confident enough.
  if (parsed.notes && parsed.parsed_confidence >= 0.5) {
    patch.notes = parsed.notes;
    fieldsUpdated.push('notes');
  }

  // Always update parsed_confidence to reflect the latest attempt.
  patch.parsed_confidence = parsed.parsed_confidence;

  const { error: updateErr } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', args.leadId);
  if (updateErr) {
    console.error('[webhook/website-form] AI enrich update failed', {
      leadId: args.leadId,
      error: updateErr,
    });
    // Continue to log the event anyway so the audit trail captures
    // that we tried.
  }

  const { error: evtErr } = await supabase.from('lead_events').insert({
    lead_id: args.leadId,
    event_type: 'ai_parsed',
    payload: {
      success: true,
      parsed_confidence: parsed.parsed_confidence,
      fields_updated: fieldsUpdated,
    },
  });
  if (evtErr) {
    console.error('[webhook/website-form] ai_parsed event insert failed', {
      leadId: args.leadId,
      err: evtErr,
    });
  }
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}
