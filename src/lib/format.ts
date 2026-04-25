// Display formatters for enum-shaped string values.
//
// Most of our enum values come back from Postgres as snake_case
// ("website_form", "junk_removal", "in_progress"). We want them
// rendered as Title Case With Spaces in the UI ("Website Form",
// "Junk Removal", "In Progress").

/**
 * Title-case + de-underscore an enum-ish string for display.
 *
 *   formatEnum('website_form')   // 'Website Form'
 *   formatEnum('junk_removal')   // 'Junk Removal'
 *   formatEnum('in_progress')    // 'In Progress'
 *   formatEnum(null)             // '—'
 *   formatEnum('')               // '—'
 *
 * Returns an em-dash for null/empty so callers can use it directly
 * in JSX without a ternary at every call site.
 */
export function formatEnum(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
