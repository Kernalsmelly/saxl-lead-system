import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

import { env } from '@/lib/env';

// AI parser for unstructured lead text.
//
// Used today by the website-form webhook on `message` field text.
// In later sessions the same parser will run over Meta DM bodies
// and SMS transcripts.
//
// Design choices
// ---------------------------------------------------------------
//   - Tool use, not raw JSON. We define a tool whose input_schema
//     matches the desired output shape and force Claude to call it.
//     The model can't return free prose; we just read the tool input.
//   - Haiku 4.5 — fast and cheap; structured extraction doesn't
//     need Opus-class reasoning.
//   - Pure-by-design failure modes: never throws. Every code path
//     funnels into { success: false, error } so the webhook handler
//     can audit the result without try/catching the parser.
//   - Defensive parsing: every field in the tool's response is
//     treated as potentially missing or wrong-shape. Invalid values
//     fall back to null rather than throw.
//   - Hard 10-second timeout via the SDK's `timeout` option.
//   - Hard 4000-character cap on input. Anything longer is
//     truncated; we log a warning so we can spot drift if it starts
//     happening regularly.

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_INPUT_CHARS = 4000;
const TIMEOUT_MS = 10_000;
const MAX_TOKENS = 1024;

export type ChannelHint = 'website_form' | 'instagram_dm' | 'facebook_dm' | 'sms';

export interface ParsedLead {
  name: string | null;
  phone: string | null;
  email: string | null;
  service_type: string | null;
  city: string | null;
  zip: string | null;
  address: string | null;
  preferred_date: string | null;
  notes: string | null;
  parsed_confidence: number;
}

export type ParseResult =
  | { success: true; parsed: ParsedLead }
  | { success: false; error: string };

export interface ParseLeadInput {
  rawText: string;
  channelHint?: ChannelHint;
}

const SYSTEM_PROMPT = [
  'You extract structured lead data from unstructured text submitted to small service businesses (hauling, junk removal, moving, pressure washing, landscaping, cleaning, demolition).',
  '',
  'Hard rules:',
  '- Respond ONLY by calling the extract_lead_fields tool. Never write prose.',
  '- For each field: extract verbatim only if the value is clearly stated in the text. Otherwise output null.',
  '- Never invent or guess. "Probably means..." is not extraction.',
  '- service_type values use snake_case from this set when they fit: junk_removal, moving, pressure_washing, landscaping, cleaning, demolition, hauling, other. Pick the most specific match. If none fit, emit null.',
  '- preferred_date: ISO 8601 date (YYYY-MM-DD) only when an unambiguous calendar date is stated. Relative phrases ("next Saturday", "ASAP", "this weekend") → null.',
  '- notes: 1-2 sentences summarizing what the prospect actually wants. Be concrete and specific. Drop greetings, signatures, and filler. If there is no usable intent in the text, output null.',
  '- parsed_confidence: 0.0-1.0 reflecting how clearly the text supported your extractions.',
  '    >0.8 — every non-null field was directly stated, unambiguous',
  '    0.5-0.8 — some fields required minor inference (e.g. parsing a phone number out of a sentence)',
  '    <0.5 — the text was vague or you guessed at most fields',
].join('\n');

const LEAD_EXTRACTION_TOOL = {
  name: 'extract_lead_fields',
  description:
    'Record the structured lead data extracted from the prospect text. Always call this tool exactly once.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: { type: ['string', 'null'], description: "The prospect's full name, or null if not stated." },
      phone: { type: ['string', 'null'], description: 'Phone number as written in the source text.' },
      email: { type: ['string', 'null'], description: 'Email address.' },
      service_type: {
        type: ['string', 'null'],
        description:
          'Snake_case service category. Prefer one of: junk_removal, moving, pressure_washing, landscaping, cleaning, demolition, hauling, other.',
      },
      city: { type: ['string', 'null'] },
      zip: { type: ['string', 'null'] },
      address: { type: ['string', 'null'] },
      preferred_date: {
        type: ['string', 'null'],
        description: 'ISO 8601 date (YYYY-MM-DD) only if an unambiguous calendar date is stated.',
      },
      notes: {
        type: ['string', 'null'],
        description: '1-2 sentence summary of the prospect intent. Concrete and specific.',
      },
      parsed_confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence in the extractions, 0.0-1.0.',
      },
    },
    required: [
      'name',
      'phone',
      'email',
      'service_type',
      'city',
      'zip',
      'address',
      'preferred_date',
      'notes',
      'parsed_confidence',
    ],
  },
};

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

/**
 * Extract structured lead data from unstructured prospect text.
 * Never throws — all errors land as { success: false, error }.
 */
export async function parseLead(input: ParseLeadInput): Promise<ParseResult> {
  const trimmed = (input.rawText ?? '').trim();
  if (!trimmed) {
    return { success: false, error: 'rawText is empty' };
  }

  // Truncate long inputs. Log a warning so we can spot drift.
  let text = trimmed;
  if (text.length > MAX_INPUT_CHARS) {
    console.warn('[lead-parser] truncating rawText', {
      originalLength: trimmed.length,
      truncatedTo: MAX_INPUT_CHARS,
    });
    text = text.slice(0, MAX_INPUT_CHARS);
  }

  const userContent = input.channelHint
    ? `Channel: ${input.channelHint}\n\nText:\n${text}`
    : text;

  let response: Anthropic.Message;
  try {
    response = await client().messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [LEAD_EXTRACTION_TOOL],
        tool_choice: { type: 'tool', name: 'extract_lead_fields' },
        messages: [{ role: 'user', content: userContent }],
      },
      { timeout: TIMEOUT_MS },
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Find the tool_use block. Defensive: if Claude somehow returned text
  // instead, or the block shape is wrong, treat as parse failure.
  const toolUseBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'extract_lead_fields',
  );
  if (!toolUseBlock) {
    return {
      success: false,
      error: `model did not call extract_lead_fields (stop_reason=${response.stop_reason})`,
    };
  }

  const parsed = coerceParsedLead(toolUseBlock.input);
  return { success: true, parsed };
}

/**
 * Defensive coercion of the tool_use input into a ParsedLead.
 *
 * The schema was sent to Claude, but we don't trust the output to
 * match. Each field is checked individually and falls back to null
 * if missing or wrong-shape. Confidence is clamped to [0, 1] and
 * defaults to 0 if missing or invalid.
 */
function coerceParsedLead(input: unknown): ParsedLead {
  const obj = (input && typeof input === 'object' ? (input as Record<string, unknown>) : {}) ?? {};

  return {
    name: stringOrNull(obj.name),
    phone: stringOrNull(obj.phone),
    email: stringOrNull(obj.email),
    service_type: stringOrNull(obj.service_type),
    city: stringOrNull(obj.city),
    zip: stringOrNull(obj.zip),
    address: stringOrNull(obj.address),
    preferred_date: stringOrNull(obj.preferred_date),
    notes: stringOrNull(obj.notes),
    parsed_confidence: numberZeroToOneOrZero(obj.parsed_confidence),
  };
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  // Some models occasionally output the literal string "null" instead of
  // a JSON null. Treat those as null too.
  if (trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

function numberZeroToOneOrZero(v: unknown): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Exported for tests so we can verify the prompt + tool definition haven't drifted. */
export const __test = {
  SYSTEM_PROMPT,
  LEAD_EXTRACTION_TOOL,
  MAX_INPUT_CHARS,
  TIMEOUT_MS,
  MODEL,
  coerceParsedLead,
};
