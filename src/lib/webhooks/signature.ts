import { createHmac, timingSafeEqual } from 'node:crypto';

// Stripe-style HMAC signing for inbound webhooks.
//
// Header format: X-Saxl-Signature: t=<unix-seconds>,v1=<sha256-hex>
// Signed payload: "<timestamp>.<raw-body>"
// Timestamp tolerance: ±5 min by default (reject stale / clock-skewed requests).

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export type SignatureFailure =
  | 'missing_header'
  | 'malformed_header'
  | 'expired_timestamp'
  | 'bad_signature';

export type SignatureVerificationResult =
  | { ok: true }
  | { ok: false; reason: SignatureFailure };

export interface VerifySignatureParams {
  header: string | null | undefined;
  body: string;
  secret: string;
  toleranceSeconds?: number;
  // Injected for tests. Returns current time in ms (same shape as Date.now).
  now?: () => number;
}

export function verifySignature(params: VerifySignatureParams): SignatureVerificationResult {
  const {
    header,
    body,
    secret,
    toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
    now = Date.now,
  } = params;

  if (!header) return { ok: false, reason: 'missing_header' };

  const parsed = parseHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  const nowSeconds = Math.floor(now() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'expired_timestamp' };
  }

  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestamp}.${body}`, 'utf8')
    .digest('hex');

  // timingSafeEqual throws if buffers differ in length — guard first so a
  // length-mismatched signature returns a clean bad_signature rather than
  // throwing. Bail early but still via the same return path: no observable
  // short-circuit that leaks signature length to the caller.
  if (expected.length !== parsed.signature.length) {
    return { ok: false, reason: 'bad_signature' };
  }

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parsed.signature, 'utf8');
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true };
}

function parseHeader(header: string): { timestamp: number; signature: string } | null {
  const parts = header.split(',').map((p) => p.trim());
  if (parts.length !== 2) return null;

  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) return null;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') {
      if (!/^\d+$/.test(value)) return null;
      timestamp = Number.parseInt(value, 10);
    } else if (key === 'v1') {
      if (!/^[0-9a-f]+$/.test(value)) return null;
      signature = value;
    } else {
      return null;
    }
  }

  if (timestamp === null || signature === null) return null;
  return { timestamp, signature };
}

// Used by tests and future dev tooling (a script that generates valid
// signatures for manual webhook testing against local/staging).
export function signPayload(params: { body: string; secret: string; timestamp: number }): string {
  const { body, secret, timestamp } = params;
  const hex = createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${hex}`;
}
