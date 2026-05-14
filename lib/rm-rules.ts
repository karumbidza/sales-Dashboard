// lib/rm-rules.ts
// Keyword-rule layer for R&M categorization. Pattern matching happens
// in Postgres via LIKE; this file owns the small bits of pure JS that
// surround it (input normalization, the two SQL constants used by the
// API routes and ingest path).

export function normalizePattern(input: string | null | undefined): string {
  if (input == null) return '';
  return String(input)
    .replace(/[%_\\]/g, '')   // strip SQL LIKE wildcards and escape char
    .replace(/\s+/g, ' ')     // collapse whitespace
    .trim()
    .toLowerCase();
}
