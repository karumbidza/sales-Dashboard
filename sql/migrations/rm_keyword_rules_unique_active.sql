-- Enforce: at most one ACTIVE rule per lowercased pattern.
-- Inactive rules can coexist with an active rule of the same pattern
-- so the user can re-author/disable without losing history.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rm_keyword_rules_active_pattern
  ON rm_keyword_rules (lower(pattern)) WHERE is_active = TRUE;

COMMIT;
