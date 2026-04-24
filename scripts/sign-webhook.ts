#!/usr/bin/env node
// Fires a signed POST at a Saxl webhook endpoint.
//
// Usage:
//   pnpm sign-webhook --secret whsec_xxx --url http://localhost:3000/... \
//     --payload '{"name":"Jane"}'
//   pnpm sign-webhook --secret whsec_xxx --url http://localhost:3000/... \
//     --payload-file scripts/sample-payload.json
//
// Exits 0 on 2xx responses, 1 otherwise.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { signPayload } from '../src/lib/webhooks/signature';

function die(message: string, code = 2): never {
  console.error(`sign-webhook: ${message}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    secret: { type: 'string' },
    url: { type: 'string' },
    payload: { type: 'string' },
    'payload-file': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.log(
    [
      'Usage: pnpm sign-webhook --secret <s> --url <u> (--payload <json> | --payload-file <path>)',
      '',
      'Options:',
      '  --secret <s>         Per-tenant webhook secret (tenant_channels.config.webhook_secret)',
      '  --url <u>            Full endpoint URL including the tenant UUID',
      '  --payload <json>     Inline JSON body string',
      '  --payload-file <p>   Path to a JSON file to use as the body',
      '  -h, --help           Show this help',
    ].join('\n'),
  );
  process.exit(0);
}

if (!values.secret) die('--secret is required');
if (!values.url) die('--url is required');
if (values.payload && values['payload-file']) {
  die('pass exactly one of --payload or --payload-file, not both');
}
if (!values.payload && !values['payload-file']) {
  die('one of --payload or --payload-file is required');
}

let body: string;
if (values['payload-file']) {
  const filePath = resolve(process.cwd(), values['payload-file']);
  try {
    body = readFileSync(filePath, 'utf8');
  } catch (err) {
    die(`could not read --payload-file ${filePath}: ${(err as Error).message}`);
  }
} else {
  body = values.payload!;
}

// Sanity-parse so we fail fast before firing.
try {
  JSON.parse(body);
} catch (err) {
  die(`payload is not valid JSON: ${(err as Error).message}`);
}

// Re-serialize from parsed JSON so the on-wire body is normalized (no
// accidental whitespace changes between sign time and send time). The
// signature covers exactly what we send.
const normalizedBody = JSON.stringify(JSON.parse(body));
const timestamp = Math.floor(Date.now() / 1000);
const signature = signPayload({ body: normalizedBody, secret: values.secret, timestamp });

const headers: Record<string, string> = {
  'content-type': 'application/json',
  'x-saxl-signature': signature,
};

console.log('--- request ---');
console.log(`POST ${values.url}`);
for (const [k, v] of Object.entries(headers)) console.log(`${k}: ${v}`);
console.log('');
console.log(normalizedBody);

async function main() {
  let res: Response;
  try {
    res = await fetch(values.url!, { method: 'POST', headers, body: normalizedBody });
  } catch (err) {
    die(`request failed: ${(err as Error).message}`, 1);
  }

  const text = await res.text();
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // non-JSON body; print as-is
  }

  console.log('');
  console.log('--- response ---');
  console.log(`HTTP ${res.status} ${res.statusText}`);
  console.log(pretty);

  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('sign-webhook: unexpected error', err);
  process.exit(1);
});
