// lib/categorizer-input.ts
// Pre-AI text cleaner. Strips noise that confuses Claude without
// changing what we store in the DB.
//
// The cleaner is intentionally conservative — if a strip would
// empty the string, the call site (categorizer.ts) falls back
// to the original description.

export function cleanForAI(description: string | null | undefined): string {
  if (!description) return '';
  let s = String(description);

  // 1. Strip leading site-name prefix: a short token followed by ':' or '.'
  //    Matches: 'luveve:', 'lib.', 'c.valley:', 'ARD-001:'
  //    Does NOT match free text: 'supply', 'repair' (no trailing punctuation)
  s = s.replace(/^[a-z0-9][\w.-]{0,15}[:.]\s+/i, '');

  // 2. Strip ticket / order references anywhere in the string.
  s = s.replace(/\b(?:tkt|ticket|ord(?:er)?)\s*#?\s*\d+/gi, '');

  // 3. Collapse whitespace and trim.
  return s.replace(/\s+/g, ' ').trim();
}
