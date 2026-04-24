import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from './signature';

const SECRET = 'whsec_test_secret_value';
const BODY = JSON.stringify({ name: 'Jane', phone: '555-1234' });
// Fixed "now" used across tests (2026-04-24T00:00:00Z-ish). Signatures are
// generated against this instant so tests are deterministic regardless of
// when they run.
const FIXED_NOW_MS = 1_777_000_000_000;
const FIXED_TS = Math.floor(FIXED_NOW_MS / 1000);
const now = () => FIXED_NOW_MS;

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    const header = signPayload({ body: BODY, secret: SECRET, timestamp: FIXED_TS });
    expect(verifySignature({ header, body: BODY, secret: SECRET, now })).toEqual({ ok: true });
  });

  it('rejects a missing header', () => {
    expect(verifySignature({ header: null, body: BODY, secret: SECRET, now })).toEqual({
      ok: false,
      reason: 'missing_header',
    });
    expect(verifySignature({ header: undefined, body: BODY, secret: SECRET, now })).toEqual({
      ok: false,
      reason: 'missing_header',
    });
    expect(verifySignature({ header: '', body: BODY, secret: SECRET, now })).toEqual({
      ok: false,
      reason: 'missing_header',
    });
  });

  describe('rejects malformed headers', () => {
    const cases: Array<[string, string]> = [
      ['only one part', 't=1234567890'],
      ['three parts', 't=1234567890,v1=abcd,extra=1'],
      ['non-numeric timestamp', 't=notanumber,v1=abcd1234'],
      ['non-hex signature', 't=1234567890,v1=ZZZnotHex'],
      ['unknown key', 't=1234567890,v2=abcd1234'],
      ['no equals', 't1234567890,v1=abcd1234'],
      ['empty string', ','],
    ];
    for (const [label, header] of cases) {
      it(label, () => {
        expect(verifySignature({ header, body: BODY, secret: SECRET, now })).toEqual({
          ok: false,
          reason: 'malformed_header',
        });
      });
    }
  });

  it('rejects a stale timestamp (too old)', () => {
    const stale = FIXED_TS - 10 * 60; // 10 minutes ago, tolerance is 5
    const header = signPayload({ body: BODY, secret: SECRET, timestamp: stale });
    expect(verifySignature({ header, body: BODY, secret: SECRET, now })).toEqual({
      ok: false,
      reason: 'expired_timestamp',
    });
  });

  it('rejects a future timestamp beyond tolerance', () => {
    const future = FIXED_TS + 10 * 60;
    const header = signPayload({ body: BODY, secret: SECRET, timestamp: future });
    expect(verifySignature({ header, body: BODY, secret: SECRET, now })).toEqual({
      ok: false,
      reason: 'expired_timestamp',
    });
  });

  it('accepts timestamps at the edge of tolerance', () => {
    const edge = FIXED_TS - 5 * 60;
    const header = signPayload({ body: BODY, secret: SECRET, timestamp: edge });
    expect(verifySignature({ header, body: BODY, secret: SECRET, now })).toEqual({ ok: true });
  });

  it('rejects a signature computed with a different secret', () => {
    const header = signPayload({ body: BODY, secret: 'wrong_secret', timestamp: FIXED_TS });
    expect(verifySignature({ header, body: BODY, secret: SECRET, now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects when the body has been tampered with (same header, altered body)', () => {
    const header = signPayload({ body: BODY, secret: SECRET, timestamp: FIXED_TS });
    const tamperedBody = BODY.replace('Jane', 'Attacker');
    expect(verifySignature({ header, body: tamperedBody, secret: SECRET, now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('does not throw when provided a signature of wrong length', () => {
    // A shorter-than-expected hex signature would crash timingSafeEqual
    // if we forgot to length-check first. This test pins that safety net.
    const header = `t=${FIXED_TS},v1=deadbeef`;
    const call = () => verifySignature({ header, body: BODY, secret: SECRET, now });
    expect(call).not.toThrow();
    expect(call()).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('uses a constant-time-capable code path (sanity check)', () => {
    // End-to-end check that verifySignature returns bad_signature rather
    // than throwing when the hex lengths match but bytes differ — the path
    // that actually reaches timingSafeEqual.
    const valid = signPayload({ body: BODY, secret: SECRET, timestamp: FIXED_TS });
    // Flip the final hex character to produce a same-length-but-wrong sig.
    const last = valid.at(-1)!;
    const flipped = last === '0' ? '1' : '0';
    const tampered = valid.slice(0, -1) + flipped;
    expect(verifySignature({ header: tampered, body: BODY, secret: SECRET, now })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
});

describe('signPayload', () => {
  it('produces a deterministic header for the same inputs', () => {
    const a = signPayload({ body: BODY, secret: SECRET, timestamp: FIXED_TS });
    const b = signPayload({ body: BODY, secret: SECRET, timestamp: FIXED_TS });
    expect(a).toBe(b);
  });

  it('changes the signature when the body changes', () => {
    const a = signPayload({ body: BODY, secret: SECRET, timestamp: FIXED_TS });
    const b = signPayload({ body: BODY + ' ', secret: SECRET, timestamp: FIXED_TS });
    expect(a).not.toBe(b);
  });
});
