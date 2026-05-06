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
    OPENROUTER_API_KEY: 'sk-or-test',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    OPENROUTER_MODEL: 'anthropic/claude-haiku-4.5',
  },
}));

// Mock the OpenAI SDK. Per-test we swap createImpl to simulate
// success / API error / timeout / malformed JSON.
const createImpl: { current: (...args: unknown[]) => Promise<unknown> } = {
  current: async () =>
    mockChatCompletion({
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

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: (...args: unknown[]) => createImpl.current(...args),
      },
    };
  },
}));

import { parseLead, __test } from './lead-parser';

/**
 * Build a chat-completion response with a single tool_call whose
 * arguments are the JSON-stringified `args` object. Pass a string
 * directly to argsRaw to simulate malformed JSON.
 */
function mockChatCompletion(args: unknown, finishReason = 'tool_calls') {
  const argumentsField = typeof args === 'string' ? args : JSON.stringify(args);
  return {
    id: 'chatcmpl_test',
    object: 'chat.completion',
    created: 0,
    model: 'anthropic/claude-haiku-4.5',
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_test',
              type: 'function',
              function: {
                name: __test.TOOL_NAME,
                arguments: argumentsField,
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

describe('parseLead — happy path', () => {
  beforeEach(() => {
    createImpl.current = async () =>
      mockChatCompletion({
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
    let captured: { messages?: Array<{ role: string; content: string }> } | null = null;
    createImpl.current = async (...args: unknown[]) => {
      captured = args[0] as typeof captured;
      return mockChatCompletion({
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
    // The user message is the second one (index 1) after the system prompt.
    const userMsg = captured!.messages![1].content;
    expect(userMsg.length).toBeLessThanOrEqual(__test.MAX_INPUT_CHARS);
  });

  it('passes channelHint through in the user message when provided', async () => {
    let captured: { messages?: Array<{ role: string; content: string }> } | null = null;
    createImpl.current = async (...args: unknown[]) => {
      captured = args[0] as typeof captured;
      return mockChatCompletion({
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
    const userMsg = captured!.messages![1].content;
    expect(userMsg).toContain('Channel: instagram_dm');
    expect(userMsg).toContain('hello');
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
      id: 'chatcmpl_x',
      object: 'chat.completion',
      created: 0,
      model: 'anthropic/claude-haiku-4.5',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'I cannot extract from this.',
            tool_calls: [],
          },
        },
      ],
    });
    const result = await parseLead({ rawText: 'foo' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(__test.TOOL_NAME);
    }
  });

  it('returns failure when tool arguments are not valid JSON', async () => {
    // Pass a raw string that's not valid JSON.
    createImpl.current = async () => mockChatCompletion('{not valid json,,,');
    const result = await parseLead({ rawText: 'foo' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not valid JSON');
    }
  });
});

describe('parseLead — defensive parsing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('coerces missing fields to null', async () => {
    createImpl.current = async () => mockChatCompletion({}); // empty object
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
      mockChatCompletion({
        name: 123,
        phone: { area: '503' },
        email: ['a@b.com'],
        service_type: '',
        city: 'Portland',
        zip: null,
        address: null,
        preferred_date: 'null',
        notes: '   ',
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
      mockChatCompletion({
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
      mockChatCompletion({
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
      mockChatCompletion({
        name: 'A',
        phone: null,
        email: null,
        service_type: null,
        city: null,
        zip: null,
        address: null,
        preferred_date: null,
        notes: null,
        parsed_confidence: 'high',
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

  it('forces tool_choice on extract_lead_fields with temperature 0', async () => {
    let captured: Record<string, unknown> | null = null;
    createImpl.current = async (...args: unknown[]) => {
      captured = args[0] as Record<string, unknown>;
      return mockChatCompletion({
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
    expect(captured!.model).toBe('anthropic/claude-haiku-4.5');
    expect(captured!.temperature).toBe(0);
    expect(captured!.tool_choice).toEqual({
      type: 'function',
      function: { name: __test.TOOL_NAME },
    });
    expect(Array.isArray(captured!.tools)).toBe(true);
  });

  it('passes the 10s timeout option', async () => {
    let capturedOptions: Record<string, unknown> | null = null;
    createImpl.current = async (...args: unknown[]) => {
      capturedOptions = args[1] as Record<string, unknown>;
      return mockChatCompletion({
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
