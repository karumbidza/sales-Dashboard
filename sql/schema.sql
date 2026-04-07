-- ============================================================
-- FUEL SALES INTELLIGENCE PLATFORM
-- PostgreSQL Schema (Neon DB)
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fuzzy text search

-- ============================================================
-- 1. REFERENCE / MASTER DATA
-- ============================================================

CREATE TABLE IF NOT EXISTS territories (
  id SERIAL PRIMARY KEY,
  tm_code VARCHAR(20) UNIQUE NOT NULL,        -- e.g. 'BRENDON'
  tm_name VARCHAR(100) NOT NULL,              -- e.g. "Brendon's Territory"
  region VARCHAR(100),                        -- e.g. 'Bulawayo'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  site_code VARCHAR(20) UNIQUE NOT NULL,      -- e.g. 'ARD-001'
  budget_name VARCHAR(100) NOT NULL,          -- MASTER identifier
  dynamics_name VARCHAR(100),
  status_report_name VARCHAR(100),
  petrotrade_name VARCHAR(100),
  territory_id INTEGER REFERENCES territories(id),
  moso VARCHAR(10),                           -- CLCO / COCO / CODO / DODO
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sites_code ON sites(site_code);
CREATE INDEX idx_sites_territory ON sites(territory_id);
CREATE INDEX idx_sites_moso ON sites(moso);

-- ============================================================
-- 2. SALES (STATUS REPORT - PRIMARY TRUTH)
-- ============================================================

CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  site_code VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  sale_date DATE NOT NULL,

  -- Diesel
  diesel_opening_dip NUMERIC(12,3),
  diesel_delivery NUMERIC(12,3) DEFAULT 0,
  diesel_sales_volume NUMERIC(12,3) DEFAULT 0,
  diesel_closing_dip NUMERIC(12,3),
  diesel_gain_loss NUMERIC(12,3),
  diesel_sales_value NUMERIC(14,2) DEFAULT 0,

  -- Blend (50ppm)
  blend_opening_dip NUMERIC(12,3),
  blend_delivery NUMERIC(12,3) DEFAULT 0,
  blend_sales_volume NUMERIC(12,3) DEFAULT 0,
  blend_closing_dip NUMERIC(12,3),
  blend_gain_loss NUMERIC(12,3),
  blend_sales_value NUMERIC(14,2) DEFAULT 0,

  -- ULP (Petrol)
  ulp_opening_dip NUMERIC(12,3),
  ulp_delivery NUMERIC(12,3) DEFAULT 0,
  ulp_sales_volume NUMERIC(12,3) DEFAULT 0,
  ulp_closing_dip NUMERIC(12,3),
  ulp_gain_loss NUMERIC(12,3),
  ulp_sales_value NUMERIC(14,2) DEFAULT 0,

  -- Flex (where applicable)
  flex_blend_volume NUMERIC(12,3) DEFAULT 0,
  flex_blend_value NUMERIC(14,2) DEFAULT 0,
  flex_diesel_volume NUMERIC(12,3) DEFAULT 0,
  flex_diesel_value NUMERIC(14,2) DEFAULT 0,

  -- Totals (computed columns for performance)
  total_volume NUMERIC(12,3) GENERATED ALWAYS AS (
    COALESCE(diesel_sales_volume, 0) +
    COALESCE(blend_sales_volume, 0) +
    COALESCE(ulp_sales_volume, 0) +
    COALESCE(flex_blend_volume, 0) +
    COALESCE(flex_diesel_volume, 0)
  ) STORED,

  total_revenue NUMERIC(14,2) GENERATED ALWAYS AS (
    COALESCE(diesel_sales_value, 0) +
    COALESCE(blend_sales_value, 0) +
    COALESCE(ulp_sales_value, 0) +
    COALESCE(flex_blend_value, 0) +
    COALESCE(flex_diesel_value, 0)
  ) STORED,

  -- Cash & Payments
  cash_sale_value NUMERIC(14,2),
  cash_count NUMERIC(14,2),
  cash_difference NUMERIC(14,2),

  -- Coupon/Card split
  blend_coupon_qty NUMERIC(12,3) DEFAULT 0,
  blend_coupon_value NUMERIC(14,2) DEFAULT 0,
  blend_card_qty NUMERIC(12,3) DEFAULT 0,
  blend_card_value NUMERIC(14,2) DEFAULT 0,
  diesel_coupon_qty NUMERIC(12,3) DEFAULT 0,
  diesel_coupon_value NUMERIC(14,2) DEFAULT 0,
  diesel_card_qty NUMERIC(12,3) DEFAULT 0,
  diesel_card_value NUMERIC(14,2) DEFAULT 0,
  ulp_coupon_qty NUMERIC(12,3) DEFAULT 0,
  ulp_coupon_value NUMERIC(14,2) DEFAULT 0,
  ulp_card_qty NUMERIC(12,3) DEFAULT 0,
  ulp_card_value NUMERIC(14,2) DEFAULT 0,

  source_file VARCHAR(255),
  ingested_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(site_code, sale_date)
);

CREATE INDEX idx_sales_date ON sales(sale_date);
CREATE INDEX idx_sales_site_date ON sales(site_code, sale_date);
CREATE INDEX idx_sales_date_site ON sales(sale_date DESC, site_code);

-- ============================================================
-- 3. PETROTRADE VOLUMES (tracked separately)
-- ============================================================

CREATE TABLE IF NOT EXISTS petrotrade_sales (
  id BIGSERIAL PRIMARY KEY,
  site_code VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  sale_date DATE NOT NULL,
  volume_litres NUMERIC(12,3) DEFAULT 0,
  margin_per_litre NUMERIC(8,5) DEFAULT 0.05,  -- fixed $0.05/litre
  gross_margin NUMERIC(14,2) GENERATED ALWAYS AS (volume_litres * margin_per_litre) STORED,
  reference VARCHAR(100),
  description TEXT,
  source_file VARCHAR(255),
  ingested_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(site_code, sale_date, reference)
);

CREATE INDEX idx_petrotrade_date ON petrotrade_sales(sale_date);
CREATE INDEX idx_petrotrade_site_date ON petrotrade_sales(site_code, sale_date);

-- ============================================================
-- 4. MARGIN / INVOICED DATA (Financial Position)
-- ============================================================

CREATE TABLE IF NOT EXISTS margin_data (
  id BIGSERIAL PRIMARY KEY,
  site_code VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  period_month DATE NOT NULL,                  -- first day of the month
  inv_volume NUMERIC(12,3) DEFAULT 0,
  avg_selling_price NUMERIC(10,6),
  avg_cost_per_litre NUMERIC(10,6),
  unit_gross_margin NUMERIC(10,6),
  gross_margin NUMERIC(14,2),
  unit_transport_cost NUMERIC(10,6),
  net_gross_margin NUMERIC(10,6),
  total_sales_value NUMERIC(14,2),
  source_file VARCHAR(255),
  ingested_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(site_code, period_month)
);

CREATE INDEX idx_margin_period ON margin_data(period_month);

-- ============================================================
-- 5. BUDGET & TARGETS
-- ============================================================

CREATE TABLE IF NOT EXISTS volume_budget (
  id SERIAL PRIMARY KEY,
  site_code VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  budget_month DATE NOT NULL,                  -- first day of month
  budget_volume NUMERIC(12,3) DEFAULT 0,
  stretch_volume NUMERIC(12,3),
  margin_budget NUMERIC(8,5),
  ugm_system NUMERIC(10,6),
  source_file VARCHAR(255),
  ingested_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(site_code, budget_month)
);

CREATE INDEX idx_budget_month ON volume_budget(budget_month);
CREATE INDEX idx_budget_site_month ON volume_budget(site_code, budget_month);

-- ============================================================
-- 6. RECONCILIATION LOG (Control Gap Tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS reconciliation_log (
  id BIGSERIAL PRIMARY KEY,
  site_code VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  period_month DATE NOT NULL,
  status_volume NUMERIC(12,3),          -- from status report
  invoiced_volume NUMERIC(12,3),        -- from margin/dynamics
  variance NUMERIC(12,3) GENERATED ALWAYS AS (
    COALESCE(status_volume, 0) - COALESCE(invoiced_volume, 0)
  ) STORED,
  variance_pct NUMERIC(8,4),
  is_flagged BOOLEAN DEFAULT FALSE,
  gap_threshold NUMERIC(5,2) DEFAULT 2.0,  -- flag if >2% variance
  notes TEXT,
  reconciled_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recon_period ON reconciliation_log(period_month);
CREATE INDEX idx_recon_flagged ON reconciliation_log(is_flagged) WHERE is_flagged = TRUE;

-- ============================================================
-- 7. AGGREGATED SUMMARIES (Pre-computed for performance)
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_site_summary (
  id BIGSERIAL PRIMARY KEY,
  site_code VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  summary_date DATE NOT NULL,
  total_volume NUMERIC(12,3) DEFAULT 0,
  total_revenue NUMERIC(14,2) DEFAULT 0,
  diesel_volume NUMERIC(12,3) DEFAULT 0,
  blend_volume NUMERIC(12,3) DEFAULT 0,
  ulp_volume NUMERIC(12,3) DEFAULT 0,
  petrotrade_volume NUMERIC(12,3) DEFAULT 0,
  avg_price NUMERIC(10,4),
  cash_value NUMERIC(14,2),
  computed_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(site_code, summary_date)
);

CREATE INDEX idx_daily_summary_date ON daily_site_summary(summary_date DESC);
CREATE INDEX idx_daily_summary_site_date ON daily_site_summary(site_code, summary_date);

CREATE TABLE IF NOT EXISTS monthly_site_summary (
  id BIGSERIAL PRIMARY KEY,
  site_code VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  summary_month DATE NOT NULL,           -- first day of month
  total_volume NUMERIC(12,3) DEFAULT 0,
  total_revenue NUMERIC(14,2) DEFAULT 0,
  diesel_volume NUMERIC(12,3) DEFAULT 0,
  blend_volume NUMERIC(12,3) DEFAULT 0,
  ulp_volume NUMERIC(12,3) DEFAULT 0,
  petrotrade_volume NUMERIC(12,3) DEFAULT 0,
  avg_price NUMERIC(10,4),
  budget_volume NUMERIC(12,3),
  stretch_volume NUMERIC(12,3),
  days_trading INTEGER,
  computed_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(site_code, summary_month)
);

CREATE INDEX idx_monthly_summary_month ON monthly_site_summary(summary_month DESC);

-- ============================================================
-- 8. UPLOAD AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS upload_log (
  id            BIGSERIAL PRIMARY KEY,
  file_name     VARCHAR(255) NOT NULL,
  file_size_bytes BIGINT,
  period_month  DATE,                          -- the period this upload covers
  status        VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | success | failed
  row_counts    JSONB,                         -- { name_index: 77, status_report: 50613, ... }
  error_message TEXT,
  duration_ms   INTEGER,
  uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_upload_log_uploaded_at ON upload_log(uploaded_at DESC);
CREATE INDEX idx_upload_log_status ON upload_log(status);

-- ============================================================
-- 9. REPORTS & COMMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_name VARCHAR(255) NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  territory_filter VARCHAR(50),            -- NULL = all territories
  product_filter VARCHAR(20),
  generated_by VARCHAR(100),
  pdf_url TEXT,
  report_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_comments (
  id BIGSERIAL PRIMARY KEY,
  report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  author VARCHAR(100),
  comment_type VARCHAR(20) DEFAULT 'general',  -- general | kpi | site | territory
  ref_site_code VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_report ON report_comments(report_id);

-- ============================================================
-- 9. MATERIALIZED VIEWS (Analytics Fast Path)
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_site_monthly_performance AS
SELECT
  s.site_code,
  s.budget_name                    AS site_name,
  s.moso,
  t.tm_code                        AS territory_code,
  t.tm_name                        AS territory_name,
  DATE_TRUNC('month', sl.sale_date)::DATE AS month,
  SUM(sl.total_volume)             AS actual_volume,
  SUM(sl.total_revenue)            AS actual_revenue,
  COUNT(DISTINCT sl.sale_date)     AS days_traded,
  AVG(sl.total_volume)             AS avg_daily_volume,
  CASE WHEN SUM(sl.total_volume) > 0
    THEN SUM(sl.total_revenue) / SUM(sl.total_volume)
    ELSE 0 END                     AS avg_price,
  CASE WHEN SUM(sl.total_revenue) > 0
    THEN SUM(sl.cash_sale_value) / SUM(sl.total_revenue)
    ELSE 0 END                     AS cash_ratio
FROM sales sl
JOIN sites s ON sl.site_code = s.site_code
LEFT JOIN territories t ON s.territory_id = t.id
GROUP BY s.site_code, s.budget_name, s.moso, t.tm_code, t.tm_name,
         DATE_TRUNC('month', sl.sale_date)::DATE;

CREATE UNIQUE INDEX idx_mv_site_monthly ON mv_site_monthly_performance(site_code, month);
CREATE INDEX idx_mv_monthly_month ON mv_site_monthly_performance(month DESC);
CREATE INDEX idx_mv_monthly_territory ON mv_site_monthly_performance(territory_code, month);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_territory_monthly AS
SELECT
  t.tm_code                        AS territory_code,
  t.tm_name                        AS territory_name,
  DATE_TRUNC('month', sl.sale_date)::DATE AS month,
  SUM(sl.total_volume)             AS actual_volume,
  SUM(sl.total_revenue)            AS actual_revenue,
  COUNT(DISTINCT s.site_code)      AS site_count,
  AVG(sl.total_volume / NULLIF(
    (SELECT COUNT(*) FROM sales s2 WHERE s2.site_code = sl.site_code
     AND DATE_TRUNC('month', s2.sale_date) = DATE_TRUNC('month', sl.sale_date)), 0)
  )                                AS avg_daily_per_site
FROM sales sl
JOIN sites s ON sl.site_code = s.site_code
JOIN territories t ON s.territory_id = t.id
GROUP BY t.tm_code, t.tm_name, DATE_TRUNC('month', sl.sale_date)::DATE;

CREATE UNIQUE INDEX idx_mv_territory_monthly ON mv_territory_monthly(territory_code, month);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_site_monthly_performance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_territory_monthly;
END;
$$;

-- ============================================================
-- 10. HELPER FUNCTIONS
-- ============================================================

-- Growth calculation
CREATE OR REPLACE FUNCTION calc_growth_pct(current_val NUMERIC, prior_val NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  IF prior_val IS NULL OR prior_val = 0 THEN RETURN NULL; END IF;
  RETURN ROUND(((current_val - prior_val) / prior_val) * 100, 2);
END;
$$;

-- Budget vs Actual
CREATE OR REPLACE FUNCTION calc_budget_pct(actual_val NUMERIC, budget_val NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  IF budget_val IS NULL OR budget_val = 0 THEN RETURN NULL; END IF;
  RETURN ROUND((actual_val / budget_val) * 100, 2);
END;
$$;

-- Trigger: auto-update updated_at on comments
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_comments_updated_at
  BEFORE UPDATE ON report_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 11. SEED: Territory Managers
-- ============================================================

INSERT INTO territories (tm_code, tm_name, region) VALUES
  ('BRENDON', 'Brendon''s Territory', 'Bulawayo'),
  ('TAFARA',  'Tafara''s Territory',  'Manicaland'),
  ('SALIYA',  'Saliya''s Territory',  'Harare'),
  ('TENDAI',  'Tendai''s Territory',  'Mashonaland')
ON CONFLICT (tm_code) DO NOTHING;

-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON TABLE sites IS 'Master site reference - all datasets must join here via site_code';
COMMENT ON TABLE sales IS 'STATUS REPORT: Primary source of truth for fuel sales volumes';
COMMENT ON TABLE petrotrade_sales IS 'Petrotrade coupon volumes (fixed $0.05/litre margin) - tracked separately';
COMMENT ON TABLE margin_data IS 'Dynamics/accounting system: invoiced volumes for reconciliation';
COMMENT ON TABLE reconciliation_log IS 'Control gap: Status Report vs Invoiced Volume discrepancies';
COMMENT ON MATERIALIZED VIEW mv_site_monthly_performance IS 'Pre-computed monthly site KPIs - refresh after each ingestion';
