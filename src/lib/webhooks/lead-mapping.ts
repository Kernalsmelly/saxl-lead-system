import { z } from 'zod';

// Accepted inbound fields from a website quote form. Unknown keys are
// allowed at the JSON layer (the handler stores the full body in
// leads.raw_payload) but do not appear on the parsed object — only the
// keys below are mapped to typed lead columns.
//
// Trim + coerce empty strings to undefined so downstream "at least one of
// phone or email" checks are meaningful on the parsed shape.

const emptyToUndef = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const optionalString = z.preprocess(
  emptyToUndef,
  z
    .string()
    .trim()
    .optional(),
);

const optionalEmail = z.preprocess(
  emptyToUndef,
  z.string().trim().email().optional(),
);

const optionalIsoDate = z.preprocess(
  emptyToUndef,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'preferred_date must be ISO YYYY-MM-DD')
    .optional(),
);

const optionalStringArray = z.preprocess(
  (v) => (v == null ? undefined : v),
  z.array(z.string()).optional(),
);

export const websiteFormPayloadSchema = z
  .object({
    name: optionalString,
    phone: optionalString,
    email: optionalEmail,
    service: optionalString,
    message: optionalString,
    city: optionalString,
    zip: optionalString,
    address: optionalString,
    preferred_date: optionalIsoDate,
    photos: optionalStringArray,
  })
  .refine((v) => Boolean(v.phone) || Boolean(v.email), {
    message: 'At least one of phone or email is required.',
    path: ['phone'],
  });

export type WebsiteFormPayload = z.infer<typeof websiteFormPayloadSchema>;

// Maps a parsed, validated payload onto the subset of `leads` columns this
// channel can populate. Other columns (source, status, tenant_id,
// raw_payload, received_at defaults) are set by the caller.
export function mapPayloadToLeadColumns(p: WebsiteFormPayload) {
  return {
    name: p.name,
    phone: p.phone,
    email: p.email,
    service_type: p.service,
    notes: p.message,
    city: p.city,
    zip: p.zip,
    address: p.address,
    preferred_date: p.preferred_date,
  };
}
