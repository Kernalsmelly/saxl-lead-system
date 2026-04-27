import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk',
    SUPABASE_SECRET_KEY: 'sk',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    APP_BASE_URL: 'http://localhost:3000',
    RESEND_API_KEY: 're_test_key',
    NOTIFICATIONS_FROM_EMAIL: 'notifications@saxllabs.com',
    CRON_SECRET: 'cron-secret-test-value-1234567890',
  },
}));

const sendImpl: { current: (...args: unknown[]) => Promise<unknown> } = {
  current: async () => ({ data: { id: 'msg_default' }, error: null }),
};
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: (...args: unknown[]) => sendImpl.current(...args),
    };
  },
}));

import {
  renderFollowUpEmail,
  sendFollowUpReminder,
  type FollowUpEmailLead,
} from './follow-up-emails';

const sampleLead: FollowUpEmailLead = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Jordan Alvarez',
  service_type: 'junk_removal',
  city: 'Portland',
  status: 'new',
};

describe('renderFollowUpEmail', () => {
  it('48h subject names the lead and frames it as a heads-up', () => {
    const { subject } = renderFollowUpEmail({
      type: '48h_response',
      tenantName: 'TrashX',
      lead: sampleLead,
      appBaseUrl: 'http://localhost:3000',
    });
    expect(subject).toContain('Jordan Alvarez');
    expect(subject.toLowerCase()).toContain('48 hours');
  });

  it('7d subject references the quote check-in', () => {
    const { subject } = renderFollowUpEmail({
      type: '7d_quote_followup',
      tenantName: 'TrashX',
      lead: { ...sampleLead, status: 'quoted' },
      appBaseUrl: 'http://localhost:3000',
    });
    expect(subject).toContain('Jordan Alvarez');
    expect(subject.toLowerCase()).toContain('quote');
  });

  it('14d subject calls out cold/closure', () => {
    const { subject } = renderFollowUpEmail({
      type: '14d_cold_check',
      tenantName: 'TrashX',
      lead: { ...sampleLead, status: 'contacted' },
      appBaseUrl: 'http://localhost:3000',
    });
    expect(subject).toContain('Jordan Alvarez');
    expect(subject.toLowerCase()).toContain('cold');
  });

  it('html and text contain dashboard link and tenant name in all variants', () => {
    for (const type of ['48h_response', '7d_quote_followup', '14d_cold_check'] as const) {
      const { html, text } = renderFollowUpEmail({
        type,
        tenantName: 'TrashX',
        lead: { ...sampleLead, status: type === '7d_quote_followup' ? 'quoted' : 'new' },
        appBaseUrl: 'http://localhost:3000',
      });
      const link = `http://localhost:3000/app/leads/${sampleLead.id}`;
      expect(html).toContain(link);
      expect(text).toContain(link);
      expect(html).toContain('TrashX');
      expect(text).toContain('TrashX');
    }
  });

  it('falls back to "A prospect" when lead has no name', () => {
    const { text } = renderFollowUpEmail({
      type: '48h_response',
      tenantName: 'TrashX',
      lead: { ...sampleLead, name: null },
      appBaseUrl: 'http://localhost:3000',
    });
    expect(text).toContain('A prospect');
  });

  it('escapes HTML in lead name and tenant name', () => {
    const { html } = renderFollowUpEmail({
      type: '48h_response',
      tenantName: 'A & B',
      lead: { ...sampleLead, name: '<img src=x>' },
      appBaseUrl: 'http://localhost:3000',
    });
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('A &amp; B');
  });
});

describe('sendFollowUpReminder', () => {
  beforeEach(() => {
    sendImpl.current = async () => ({ data: { id: 'msg_ok' }, error: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success with id on accept', async () => {
    sendImpl.current = async () => ({ data: { id: 'msg_42' }, error: null });
    const result = await sendFollowUpReminder({
      type: '48h_response',
      to: 'owner@example.com',
      tenantName: 'TrashX',
      lead: sampleLead,
    });
    expect(result).toEqual({ success: true, id: 'msg_42' });
  });

  it('returns failure on Resend API error', async () => {
    sendImpl.current = async () => ({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'Too many requests' },
    });
    const result = await sendFollowUpReminder({
      type: '48h_response',
      to: 'owner@example.com',
      tenantName: 'TrashX',
      lead: sampleLead,
    });
    expect(result).toEqual({ success: false, error: 'Too many requests' });
  });

  it('returns failure when SDK throws', async () => {
    sendImpl.current = async () => {
      throw new Error('network blip');
    };
    const result = await sendFollowUpReminder({
      type: '14d_cold_check',
      to: 'owner@example.com',
      tenantName: 'TrashX',
      lead: sampleLead,
    });
    expect(result).toMatchObject({ success: false, error: 'network blip' });
  });
});
