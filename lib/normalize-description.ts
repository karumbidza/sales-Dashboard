// lib/normalize-description.ts
// Must match the GENERATED ALWAYS AS expression on rm_invoices.description_norm:
//   lower(trim(regexp_replace(description, '\s+', ' ', 'g')))
export function normalizeDescription(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
}
