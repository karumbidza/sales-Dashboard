-- ============================================================
-- Replace margin_data with monthly site_margins
-- ============================================================
-- New MARGIN sheet shape (like VOLUME BUDGET): one row per site,
-- monthly columns Jan..Dec each holding the margin per litre.
-- ============================================================

DROP TABLE IF EXISTS margin_data CASCADE;

CREATE TABLE IF NOT EXISTS site_margins (
  id SERIAL PRIMARY KEY,
  site_code VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  period_month DATE NOT NULL,                    -- first day of month
  margin_per_litre NUMERIC(10,6) NOT NULL,       -- $/litre net margin
  source_file VARCHAR(255),
  ingested_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(site_code, period_month)
);

CREATE INDEX IF NOT EXISTS idx_site_margins_period ON site_margins(period_month);
CREATE INDEX IF NOT EXISTS idx_site_margins_site_period ON site_margins(site_code, period_month);

COMMENT ON TABLE site_margins IS
  'Monthly $/litre net margin per site (from MARGIN sheet). Multiply by actual monthly sales volume to get net margin $.';
