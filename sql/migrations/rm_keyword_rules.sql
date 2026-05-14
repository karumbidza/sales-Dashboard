-- ============================================================
-- Keyword rules layer for R&M categorization.
-- Each rule maps a case-insensitive substring pattern to a
-- category. Matching happens via LIKE '%' || lower(pattern) || '%'
-- on rm_description_categories.description_norm. Longest pattern
-- wins on conflict.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS rm_keyword_rules (
  id          BIGSERIAL PRIMARY KEY,
  pattern     TEXT NOT NULL,
  category_id INT NOT NULL REFERENCES rm_categories(id),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rm_keyword_rules_active
  ON rm_keyword_rules(is_active) WHERE is_active = TRUE;

COMMIT;
