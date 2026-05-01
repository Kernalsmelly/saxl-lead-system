import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk',
    SUPABASE_SECRET_KEY: 'sk',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    APP_BASE_URL: 'http://localhost:3000',
    RESEND_API_KEY: 're_test',
    NOTIFICATIONS_FROM_EMAIL: 'notifications@saxllabs.com',
    CRON_SECRET: 'cron-secret-test-1234567890',
    ANTHROPIC_API_KEY: 'sk-ant-test',
  },
}));

// Mock the Anthropic SDK. Per-test we swap createImpl to simulate
// success / API error / timeout / malformed response.
const createImpl: { current: (...args: unknown[]) => Promise<unknown> } = {
  current: async () => mockToolUseResponse({
    name: 'Jordan Alvarez',
    phone: '503-555-0142',
    email: 'jordan@example.com',
    service_type: 'junk_removal',
    city: 'Portland',
    zip: '97214',
    address: null,
    preferred_date: null,
    notes: 'Wants junk removal: couch and yard debris.',
    parsed_confidence: 0.9,
  }),
};

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: (...args: unknown[]) => createImpl.current(...args),
    };
  },
}));

import { parseLead, __test } from './lead-parser';

function mockToolUseResponse(input: unknown, stopReason = 'tool_use') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: __test.MODEL,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'extract_lead_fields',
        input,
      },
    ],
  };
}

describe('parseLead — happy path', () => {
  beforeEach(() => {
    createImpl.current = async () =>
      mockToolUseResponse({
        name: 'Jordan Alvarez',
        phone: '503-555-0142',
        email: 'jordan@example.com',
        service_type: 'junk_removal',
        city: 'Portland',
        zip: '97214',
        address: '2814 SE Hawthorne Blvd',
        preferred_date: '2026-05-02',
        notes: 'Sectional couch and yard debris haul-off.',
        parsed_confidence: 0.92,
      });
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns success with all fields parsed', async () => {
    const result = await parseLead({
      rawText: 'I have a couch and yard debris. Call me at 503-555-0142.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.parsed).toEqual({
        name: 'Jordan Alvarez',
        phone: '503-555-0142',
        email: 'jordan@example.com',
        service_type: 'junk_removal',
        city: 'Portland',
        zip: '97214',
        address: '2814 SE Hawthorne Blvd',
        preferred_date: '2026-05-02',
        notes: 'Sectional couch and yard debris haul-off.',
        parsed_confidence: 0.92,
      });
    }
  });
});

describe('parseLead — input validation', () => {
  it('returns error for empty rawText', async () => {
    const result = await parseLead({ rawText: '' });
    expect(result).toEqual({ success: false, error: 'rawText is empty' });
  });

  it('returns error for whitespace-only rawText', async () => {
    const result = await parseLead({ rawText: '   \n\t  ' });
    expect(result).toEqual({ success: false, error: 'rawText is empty' });
  });

  it('truncates oversize input to MAX_INPUT_CHARS and proceeds', async () => {
    let captured: { messages?: Array<{ content: string }> } | null = null;
    createImpl.current = async (...args: unknown[]) => {
      captured = args[0] as typeof captured;
      return mockToolUseResponse({
        name: null,
        phone: null,
        email: null,
        service_type: null,
        city: null,
        zip: null,
        address: null,
        preferred_date: null,
        notes: null,
        parsed_confidence: 0,
      });
    };
    const oversize = 'a'.repeat(__test.MAX_INPUT_CHARS + 500);
    const result = await parseLead({ rawText: oversize });
    expect(result.success).toBe(true);
    expect(captured).not.toBeNull();
    const sent = captured!.messages![0].content;
    expect(sent.length).toBeLessThanOrEqual(__test.MAX_INPUT_CHARS);
  });

  it('passes channelHint through in the user message when provided', async () => {
    let captured: { messages?: Array<{ content: string }> } | null = null;
    createImpl.current = async (...args: unknown[]) => {
      captured = args[0] as typeof captured;
      return mockToolUseResponse({
        name: null,
        phone: null,
        email: null,
        service_type: null,
        city: null,
        zip: null,
        address: null,
        preferred_date: null,
        notes: null,
        parsed_confidence: 0,
      });
    };
    await parseLead({ rawText: 'hello', channelHint: 'instagram_dm' });
    expect(captured!.messages![0].content).toContain('Channel: instagram_dm');
    expect(captured!.messages![0].content).toContain('hello');
  });
});

describe('parseLead — failure modes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns failure when SDK throws (e.g. timeout, network)', async () => {
    createImpl.current = async () => {
      throw new Error('Request timed out');
    };
    const result = await parseLead({ rawText: 'foo' });
    expect(result).toMatchObject({ success: false, error: 'Request timed out' });
  });

  it('returns failure when model does not call the tool', async () => {
    createImpl.current = async () => ({
      id: 'msg_x',
      type: 'message',
      role: 'assistant',
      model: __test.MODEL,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I cannot extract from this.' }],
    });
    const result = await parseLead({ rawText: 'foo' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('extract_lead_fields');
    }
  });
});

describe('parseLead — defensive parsing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('coerces missing fields to null', async () => {
    createImpl.current = async () => mockToolUseResponse({}); // empty input
    const result = await parseLead({ rawText: 'foo' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.parsed).toEqual({
        name: null,
        phone: null,
        email: null,
        service_type: null,
        city: null,
        zip: null,
        address: null,
        preferred_date: null,
        notes: null,
        parsed_confidence: 0,
      });
    }
  });

  it('coerces wrong-shape values to null', async () => {
    createImpl.current = async () =>
      mockToolUseResponse({
        name: 123, // wrong type
        phone: { area: '503' }, // wrong type
        email: ['a@b.com'], // wrong type
        service_type: '', // empty string
        city: 'Portland',
        zip: null,
        address: null,
        preferred_date: 'null', // literal "null"
        notes: '   ', // whitespace
        parsed_confidence: 0.7,
      });
    const result = await parseLead({ rawText: 'foo' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.parsed.name).toBeNull();
      expect(result.parsed.phone).toBeNull();
      expect(result.parsed.email).toBeNull();
      expect(result.parsed.service_type).toBeNull();
      expect(result.parsed.city).toBe('Portland');
      expect(result.parsed.preferred_date).toBeNull();
      expect(result.parsed.notes).toBeNull();
      expect(result.parsed.parsed_confidence).toBe(0.7);
    }
  });

  it('clamps parsed_confidence to [0, 1]', async () => {
    createImpl.current = async () =>
      mockToolUseResponse({
        name: 'A',
        phone: null,
        email: null,
        service_type: null,
        city: null,
        zip: null,
        address: null,
        preferred_date: null,
        notes: null,
        parsed_confidence: 1.5,
      });
    let result = await parseLead({ rawText: 'foo' });
    expect(result.success && result.parsed.parsed_confidence).toBe(1);

    createImpl.current = async () =>
      mockToolUseResponse({
        name: 'A',
        phone: null,
        email: null,
        service_type: null,
        city: null,
        zip: null,
        address: null,
        preferred_date: null,
        notes: null,
        parsed_confidence: -0.3,
      });
    result = await parseLead({ rawText: 'foo' });
    expect(result.success && result.parsed.parsed_confidence).toBe(0);

    createImpl.current = async () =>
      mockToolUseResponse({
        name: 'A',
        phone: null,
        email: null,
        service_type: null,
        city: null,
        zip: null,
        address: null,
        preferred_date: null,
        notes: null,
        parsed_confidence: 'high', // wrong type
      });
    result = await parseLead({ rawText: 'foo' });
    expect(result.success && result.parsed.parsed_confidence).toBe(0);
  });

  it('handles non-object tool input', () => {
    expect(__test.coerceParsedLead(null)).toEqual({
      name: null,
      phone: null,
      email: null,
      service_type: null,
      city: null,
      zip: null,
      address: null,
      preferred_date: null,
      notes: null,
      parsed_confidence: 0,
    });
    expect(__test.coerceParsedLead('not an object').parsed_confidence).toBe(0);
    expect(__test.coerceParsedLead(42).name).toBeNull();
  });
});

describe('parseLead — request shape (regression)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forces tool_use on extract_lead_fields with temperature 0', async () => {
    let captured: Record<string, unknown> | null = null;
    createImpl.current = async (...args: unknown[]) => {
      captured = args[0] as Record<string, unknown>;
      return mockToolUseResponse({
        name: null,
        phone: null,
        email: null,
        service_type: null,
        city: null,
        zip: null,
        address: null,
        preferred_date: null,
        notes: null,
        parsed_confidence: 0,
      });
    };
    await parseLead({ rawText: 'foo' });
    expect(captured!.model).toBe(__test.MODEL);
    expect(captured!.temperature).toBe(0);
    expect(captured!.tool_choice).toEqual({ type: 'tool', name: 'extract_lead_fields' });
    expect(Array.isArray(captured!.tools)).toBe(true);
  });

  it('passes the 10s timeout option', async () => {
    let capturedOptions: Record<string, unknown> | null = null;
    createImpl.current = async (...args: unknown[]) => {
      capturedOptions = args[1] as Record<string, unknown>;
      return mockToolUseResponse({
        name: null,
        phone: null,
        email: null,
        service_type: null,
        city: null,
        zip: null,
        address: null,
        preferred_date: null,
        notes: null,
        parsed_confidence: 0,
      });
    };
    await parseLead({ rawText: 'foo' });
    expect(capturedOptions).toMatchObject({ timeout: __test.TIMEOUT_MS });
  });
});
