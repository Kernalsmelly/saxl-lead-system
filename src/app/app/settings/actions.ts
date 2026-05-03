'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/db/types';

type ChannelType = Database['public']['Enums']['channel_type'];

const VALID_CHANNEL_TYPES: readonly ChannelType[] = [
  'website_form',
  'sms',
  'voice',
  'meta_dm',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SettingsActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

/**
 * Rotate a tenant_channels row's webhook_secret.
 *
 * Generates a fresh `whsec_<64-hex>` and writes it into config. Any
 * existing form integration breaks until the new secret is pasted
 * into the source app's webhook config — the UI confirms this
 * before invoking the action.
 *
 * RLS on tenant_channels scopes the update to channels owned by the
 * authenticated user; a hijacked channel id from another tenant will
 * find no row to update.
 */
export async function rotateWebhookSecret(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const channelId = String(formData.get('channel_id') ?? '');
  if (!UUID_RE.test(channelId)) {
    return { status: 'error', message: 'Invalid channel id.' };
  }

  const supabase = createClient();

  // Read the current config so we don't clobber other keys someone
  // adds later (e.g. per-channel rate limits, allowlists).
  const { data: current, error: readErr } = await supabase
    .from('tenant_channels')
    .select('config')
    .eq('id', channelId)
    .maybeSingle();

  if (readErr) {
    console.error('[rotateWebhookSecret] read failed', readErr);
    return { status: 'error', message: 'Could not load channel.' };
  }
  if (!current) {
    return { status: 'error', message: 'Channel not found.' };
  }

  const existingConfig =
    current.config && typeof current.config === 'object' && !Array.isArray(current.config)
      ? (current.config as Record<string, unknown>)
      : {};

  const newSecret = `whsec_${randomBytes(32).toString('hex')}`;
  const newConfig = { ...existingConfig, webhook_secret: newSecret };

  const { error: updateErr } = await supabase
    .from('tenant_channels')
    .update({ config: newConfig })
    .eq('id', channelId);

  if (updateErr) {
    console.error('[rotateWebhookSecret] update failed', updateErr);
    return { status: 'error', message: 'Could not save new secret.' };
  }

  revalidatePath('/app/settings');
  return { status: 'success', message: 'Webhook secret rotated. Update your form integration with the new value.' };
}

/**
 * Flip a tenant_channels row's `enabled` flag. The webhook handler
 * already returns 403 on disabled channels — this just gives the
 * operator a way to drive that switch from the dashboard.
 */
export async function toggleChannelEnabled(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const channelId = String(formData.get('channel_id') ?? '');
  const desired = formData.get('desired') === 'true';
  if (!UUID_RE.test(channelId)) {
    return { status: 'error', message: 'Invalid channel id.' };
  }

  const supabase = createClient();

  const { error } = await supabase
    .from('tenant_channels')
    .update({ enabled: desired })
    .eq('id', channelId);

  if (error) {
    console.error('[toggleChannelEnabled] update failed', error);
    return { status: 'error', message: 'Could not update channel.' };
  }

  revalidatePath('/app/settings');
  return { status: 'success', message: desired ? 'Channel enabled.' : 'Channel disabled.' };
}

/**
 * Create a tenant_channels row for a given channel_type. Useful when
 * a tenant exists but no channels are configured yet (e.g. fresh
 * onboarding, or someone wants to enable Meta DMs later).
 *
 * For website_form, generates an initial webhook_secret. For other
 * channel types, leaves config empty — those channels need
 * channel-specific config that will land in later sessions.
 */
export async function createChannel(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const tenantId = String(formData.get('tenant_id') ?? '');
  const channelTypeRaw = String(formData.get('channel_type') ?? '');

  if (!UUID_RE.test(tenantId)) {
    return { status: 'error', message: 'Invalid tenant id.' };
  }
  if (!VALID_CHANNEL_TYPES.includes(channelTypeRaw as ChannelType)) {
    return { status: 'error', message: 'Invalid channel type.' };
  }
  const channelType = channelTypeRaw as ChannelType;

  const supabase = createClient();

  const config: Record<string, string> = {};
  if (channelType === 'website_form') {
    config.webhook_secret = `whsec_${randomBytes(32).toString('hex')}`;
  }

  const { error } = await supabase.from('tenant_channels').insert({
    tenant_id: tenantId,
    channel_type: channelType,
    enabled: true,
    config,
  });

  if (error) {
    // Most common failure is the unique (tenant_id, channel_type) constraint —
    // surface it as a friendly message.
    if (error.code === '23505') {
      return { status: 'error', message: 'A channel of that type already exists.' };
    }
    console.error('[createChannel] insert failed', error);
    return { status: 'error', message: 'Could not create channel.' };
  }

  revalidatePath('/app/settings');
  return { status: 'success', message: 'Channel created.' };
}
