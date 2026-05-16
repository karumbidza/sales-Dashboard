-- ============================================================
-- rm_site_notes — analyst commentary per site per report period.
-- Read by both the R&M Command Center heatmap and the server-side
-- PDF generator.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS rm_site_notes (
  id            BIGSERIAL PRIMARY KEY,
  site_code     VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  period_from   DATE NOT NULL,
  period_to     DATE NOT NULL,
  note_text     TEXT NOT NULL,
  author        VARCHAR(120),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_code, period_from, period_to)
);

CREATE INDEX IF NOT EXISTS idx_rm_site_notes_period
  ON rm_site_notes(period_from, period_to);

COMMIT;
