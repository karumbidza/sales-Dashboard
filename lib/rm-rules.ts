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

// Bulk-update SQL — picks the longest-pattern active rule that matches
// each description and flips it to source='rule'. Excludes source='override'
// (manual reclassifies always win). The IS DISTINCT FROM guard makes this
// a no-op when nothing changed. Append RETURNING 1 so callers can count
// the number of rows actually changed.
export const APPLY_RULES_SQL = `
WITH best_match AS (
  SELECT
    rdc.description_norm,
    r.category_id,
    ROW_NUMBER() OVER (
      PARTITION BY rdc.description_norm
      ORDER BY LENGTH(r.pattern) DESC, r.id
    ) AS rk
  FROM rm_description_categories rdc
  JOIN rm_keyword_rules r
    ON r.is_active = TRUE
   AND rdc.description_norm LIKE '%' || lower(r.pattern) || '%'
  WHERE rdc.source != 'override'
)
UPDATE rm_description_categories rdc
SET category_id  = bm.category_id,
    source       = 'rule',
    confidence   = 'high',
    needs_review = FALSE,
    updated_at   = NOW()
FROM best_match bm
WHERE rdc.description_norm = bm.description_norm
  AND bm.rk = 1
  AND (rdc.category_id IS DISTINCT FROM bm.category_id OR rdc.source != 'rule')
RETURNING 1
`;

// Reverts source='rule' rows whose patterns no longer exist (e.g. after
// rule deletion or toggle-off) back to 'pending', so the cron re-Claudes
// them. Reset to category 'other' as a sane default.
export const RESET_ORPHANS_SQL = `
UPDATE rm_description_categories rdc
SET source       = 'pending',
    category_id  = (SELECT id FROM rm_categories WHERE slug='other'),
    confidence   = NULL,
    needs_review = FALSE,
    updated_at   = NOW()
WHERE rdc.source = 'rule'
  AND NOT EXISTS (
    SELECT 1 FROM rm_keyword_rules r
    WHERE r.is_active = TRUE
      AND rdc.description_norm LIKE '%' || lower(r.pattern) || '%'
  )
RETURNING 1
`;
