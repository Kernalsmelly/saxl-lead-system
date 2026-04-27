import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 'server-only' throws on import outside server context — neutralize it
// for tests so we can exercise the module under Node directly.
vi.mock('server-only', () => ({}));

// Mock @/lib/env so importing email.ts doesn't require real env vars.
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk',
    SUPABASE_SECRET_KEY: 'sk',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    APP_BASE_URL: 'http://localhost:3000',
    RESEND_API_KEY: 're_test_key',
    NOTIFICATIONS_FROM_EMAIL: 'notifications@saxllabs.com',
  },
}));

// Mock the Resend SDK. We swap the implementation per-test via the
// `sendImpl` ref so we can simulate success / API error / thrown error.
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
  renderNewLeadEmail,
  sendNewLeadNotification,
} from './email';

const sampleLead = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Jordan Alvarez',
  phone: '503-555-0142',
  email: 'jordan@example.com',
  service_type: 'junk_removal',
  city: 'Portland',
  source: 'website_form',
};

describe('renderNewLeadEmail', () => {
  it('subject includes the lead name and formatted service', () => {
    const { subject } = renderNewLeadEmail({
      tenantName: 'TrashX',
      lead: sampleLead,
      appBaseUrl: 'http://localhost:3000',
    });
    expect(subject).toBe('New lead — Jordan Alvarez (Junk Removal)');
  });

  it('html and text bodies contain phone, email, service, city, source, and dashboard link', () => {
    const { html, text } = renderNewLeadEmail({
      tenantName: 'TrashX',
      lead: sampleLead,
      appBaseUrl: 'http://localhost:3000',
    });
    const expected = [
      'Jordan Alvarez',
      '503-555-0142',
      'jordan@example.com',
      'Junk Removal',
      'Portland',
      'Website Form',
      `http://localhost:3000/app/leads/${sampleLead.id}`,
      'TrashX',
    ];
    for (const needle of expected) {
      expect(html).toContain(needle);
      expect(text).toContain(needle);
    }
  });

  it('handles missing optional fields with em-dashes', () => {
    const { text } = renderNewLeadEmail({
      tenantName: 'TrashX',
      lead: { ...sampleLead, name: null, phone: null, email: null, city: null, service_type: null },
      appBaseUrl: 'http://localhost:3000',
    });
    expect(text).toContain('A new prospect submitted a request');
    expect(text).toContain('Phone: —');
    expect(text).toContain('Email: —');
    expect(text).toContain('Service: —');
    expect(text).toContain('City: —');
  });

  it('escapes HTML in tenant name and lead fields', () => {
    const { html } = renderNewLeadEmail({
      tenantName: 'A & B <Co>',
      lead: { ...sampleLead, name: '<script>alert(1)</script>' },
      appBaseUrl: 'http://localhost:3000',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A &amp; B &lt;Co&gt;');
  });

  it('strips trailing slash from appBaseUrl is the caller responsibility (renderer is verbatim)', () => {
    // Renderer doesn't strip — sender does. Lock the verbatim behavior.
    const { html } = renderNewLeadEmail({
      tenantName: 'TrashX',
      lead: sampleLead,
      appBaseUrl: 'http://localhost:3000/',
    });
    expect(html).toContain('http://localhost:3000//app/leads/');
  });
});

describe('sendNewLeadNotification', () => {
  beforeEach(() => {
    sendImpl.current = async () => ({ data: { id: 'msg_ok' }, error: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success with id when Resend accepts the message', async () => {
    sendImpl.current = async () => ({ data: { id: 'msg_42' }, error: null });
    const result = await sendNewLeadNotification({
      to: 'owner@example.com',
      tenantName: 'TrashX',
      lead: sampleLead,
    });
    expect(result).toEqual({ success: true, id: 'msg_42' });
  });

  it('returns { success: false, error } when Resend returns an API error', async () => {
    sendImpl.current = async () => ({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'Too many requests' },
    });
    const result = await sendNewLeadNotification({
      to: 'owner@example.com',
      tenantName: 'TrashX',
      lead: sampleLead,
    });
    expect(result).toEqual({ success: false, error: 'Too many requests' });
  });

  it('returns { success: false, error } when the SDK throws', async () => {
    sendImpl.current = async () => {
      throw new Error('network down');
    };
    const result = await sendNewLeadNotification({
      to: 'owner@example.com',
      tenantName: 'TrashX',
      lead: sampleLead,
    });
    expect(result.success).toBe(false);
    expect(result).toMatchObject({ success: false, error: 'network down' });
  });

  it('returns { success: false } when Resend returns no message id', async () => {
    sendImpl.current = async () => ({ data: null, error: null });
    const result = await sendNewLeadNotification({
      to: 'owner@example.com',
      tenantName: 'TrashX',
      lead: sampleLead,
    });
    expect(result.success).toBe(false);
  });

  it('uses the configured NOTIFICATIONS_FROM_EMAIL as the from address', async () => {
    let captured: { from?: string } | null = null;
    sendImpl.current = async (...args: unknown[]) => {
      captured = args[0] as { from?: string };
      return { data: { id: 'msg_ok' }, error: null };
    };
    await sendNewLeadNotification({
      to: 'owner@example.com',
      tenantName: 'TrashX',
      lead: sampleLead,
    });
    expect(captured).not.toBeNull();
    expect(captured!.from).toBe('notifications@saxllabs.com');
  });
});
