import 'server-only';
import OpenAI from 'openai';

import { env } from '@/lib/env';

// AI parser for unstructured lead text.
//
// Used today by the website-form webhook on `message` field text.
// In later sessions the same parser will run over Meta DM bodies
// and SMS transcripts.
//
// Provider: OpenRouter via the OpenAI-compatible /v1/chat/completions
// endpoint. The official `openai` SDK is pointed at OpenRouter's base
// URL and given an OpenRouter API key — Anthropic models, OpenAI
// models, Gemini, etc. all reachable through one wire format.
//
// Design choices
// ---------------------------------------------------------------
//   - Function calling for structured output, not raw JSON parsing.
//     We define a function whose parameters JSON Schema matches the
//     desired output shape and force tool_choice to it. The model
//     can't return free prose; we just read the function arguments.
//   - Default model is Haiku 4.5 via OpenRouter (anthropic/
//     claude-haiku-4.5). Configurable via OPENROUTER_MODEL.
//   - Pure-by-design failure modes: never throws. Every code path
//     funnels into { success: false, error }.
//   - Defensive parsing: arguments come back as a JSON STRING from
//     the OpenAI surface (unlike Anthropic's structured tool_use
//     blocks), so the JSON.parse step is wrapped in try/catch and
//     the result run through coerceParsedLead — every field is
//     treated as potentially missing or wrong-shape.
//   - Hard 10-second timeout via the SDK's `timeout` option.
//   - Hard 4000-character cap on input. Anything longer is
//     truncated with a warning so we can spot drift.

const MAX_INPUT_CHARS = 4000;
const TIMEOUT_MS = 10_000;
const MAX_TOKENS = 1024;
const TOOL_NAME = 'extract_lead_fields';

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
  `- Respond ONLY by calling the ${TOOL_NAME} tool. Never write prose.`,
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
  type: 'function' as const,
  function: {
    name: TOOL_NAME,
    description:
      'Record the structured lead data extracted from the prospect text. Always call this tool exactly once.',
    parameters: {
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
  },
};

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: env.OPENROUTER_BASE_URL,
      // OpenRouter recommends an HTTP-Referer + X-Title header so they
      // can attribute traffic to your project on their dashboard. Both
      // are optional; we set generic values here.
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/Kernalsmelly/saxl-lead-system',
        'X-Title': 'Saxl Lead System',
      },
    });
  }
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

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await client().chat.completions.create(
      {
        model: env.OPENROUTER_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        tools: [LEAD_EXTRACTION_TOOL],
        tool_choice: { type: 'function', function: { name: TOOL_NAME } },
      },
      { timeout: TIMEOUT_MS },
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Locate the tool call. Defensive: any provider quirk that causes
  // a missing or wrong-named tool call falls into the failure path.
  const choice = response.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (
    !toolCall ||
    toolCall.type !== 'function' ||
    toolCall.function?.name !== TOOL_NAME
  ) {
    return {
      success: false,
      error: `model did not call ${TOOL_NAME} (finish_reason=${choice?.finish_reason ?? 'unknown'})`,
    };
  }

  // OpenAI/OpenRouter returns function arguments as a JSON string.
  // Wrap parse in try/catch — we've seen models occasionally emit
  // trailing commas or unquoted keys despite schema constraints.
  let argsJson: unknown;
  try {
    argsJson = JSON.parse(toolCall.function.arguments ?? '{}');
  } catch (err) {
    return {
      success: false,
      error: `tool arguments not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsed = coerceParsedLead(argsJson);
  return { success: true, parsed };
}

/**
 * Defensive coercion of tool arguments into a ParsedLead.
 *
 * Each field is checked individually and falls back to null if
 * missing or wrong-shape. Confidence is clamped to [0, 1] and
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
  TOOL_NAME,
  coerceParsedLead,
};
