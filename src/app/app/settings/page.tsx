import { redirect } from 'next/navigation';

import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { formatEnum } from '@/lib/format';
import {
  WebhookSecretControls,
  ChannelEnabledToggle,
} from './webhook-controls';

// Settings — show the operator their tenant config and let them
// rotate webhook secrets / toggle channels.
//
// All queries go through the SSR client (RLS-scoped). The user's
// own auth row gives us their email; tenants + tenant_channels are
// scoped by the RLS policy that requires
// `auth.uid() = tenants.owner_user_id`.
//
// v1 only renders the first tenant a user owns. Multi-tenant
// per-user is out of scope; if you own two TrashX-style accounts
// you'd sign in with two different auth users.

export const dynamic = 'force-dynamic';

interface ChannelRow {
  id: string;
  channel_type: string;
  enabled: boolean;
  config: unknown;
}

export default async function SettingsPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login'); // belt-and-suspenders, layout already guards this

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (tenantErr) {
    console.error('[settings] tenant query failed', tenantErr);
    return (
      <PageWrap>
        <ErrorBlock>
          Could not load tenant ({tenantErr.code ?? 'unknown'}): {tenantErr.message}
        </ErrorBlock>
      </PageWrap>
    );
  }

  if (!tenant) {
    return (
      <PageWrap>
        <ErrorBlock>
          No tenant linked to your account yet. Reach out to support — this
          row should have been created during onboarding.
        </ErrorBlock>
      </PageWrap>
    );
  }

  const { data: channels, error: channelsErr } = await supabase
    .from('tenant_channels')
    .select('id, channel_type, enabled, config')
    .eq('tenant_id', tenant.id)
    .order('channel_type', { ascending: true });

  if (channelsErr) {
    console.error('[settings] channels query failed', channelsErr);
  }

  return (
    <PageWrap>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Tenant config and integration credentials.
        </p>
      </div>

      <Section title="Account">
        <Field label="Owner email" value={user.email ?? '—'} />
        <Field label="Tenant name" value={tenant.name} />
        <Field label="Tenant id" value={tenant.id} mono />
      </Section>

      <Section title="Channels">
        {!channels || channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No channels configured. Reach out to support to wire one up.
          </p>
        ) : (
          <div className="space-y-6">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel as ChannelRow}
                tenantId={tenant.id}
              />
            ))}
          </div>
        )}
      </Section>
    </PageWrap>
  );
}

function ChannelCard({ channel, tenantId }: { channel: ChannelRow; tenantId: string }) {
  const config =
    channel.config && typeof channel.config === 'object' && !Array.isArray(channel.config)
      ? (channel.config as Record<string, unknown>)
      : {};
  const secret = typeof config.webhook_secret === 'string' ? config.webhook_secret : null;

  const webhookUrl = `${env.APP_BASE_URL.replace(/\/+$/, '')}/api/webhooks/${slugFor(channel.channel_type)}/${tenantId}`;

  return (
    <div className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{formatEnum(channel.channel_type)}</h3>
          <p className="text-xs text-muted-foreground">{channelDescription(channel.channel_type)}</p>
        </div>
        <ChannelEnabledToggle channelId={channel.id} enabled={channel.enabled} />
      </div>

      {channel.channel_type === 'website_form' ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Webhook URL</p>
            <code className="block select-all rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">
              {webhookUrl}
            </code>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Webhook secret</p>
            <WebhookSecretControls channelId={channel.id} secret={secret} />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Configuration for this channel type lands in a future session.
        </p>
      )}
    </div>
  );
}

function channelDescription(channelType: string): string {
  switch (channelType) {
    case 'website_form':
      return 'Receive leads from your website contact form via signed webhook.';
    case 'sms':
      return 'Inbound SMS lead capture (paid add-on; not enabled in v1).';
    case 'voice':
      return 'Inbound phone call tracking (paid add-on; not enabled in v1).';
    case 'meta_dm':
      return 'Receive Instagram and Facebook DMs as leads.';
    default:
      return '';
  }
}

function slugFor(channelType: string): string {
  // The api/webhooks/<slug>/[tenantId] path uses these slugs.
  // Today only website-form is wired up.
  switch (channelType) {
    case 'website_form':
      return 'website-form';
    case 'meta_dm':
      return 'meta-dm';
    case 'sms':
      return 'sms';
    case 'voice':
      return 'voice';
    default:
      return channelType;
  }
}

function PageWrap({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <div className="rounded-md border p-4">{children}</div>
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1 text-sm first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`col-span-2 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function ErrorBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
      {children}
    </div>
  );
}
