-- ============================================================
-- MIGRATION: Add LPG as a new product line
-- Run this in Neon SQL Editor when ready to enable LPG tracking
-- ============================================================

-- Step 1: Add LPG columns to the sales table
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS lpg_opening_dip    NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS lpg_delivery        NUMERIC(12,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lpg_sales_volume    NUMERIC(12,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lpg_closing_dip     NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS lpg_gain_loss       NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS lpg_sales_value     NUMERIC(14,2) DEFAULT 0;

-- Step 2: Add LPG to volume_budget so targets can be set
ALTER TABLE volume_budget
  ADD COLUMN IF NOT EXISTS lpg_budget_volume NUMERIC(12,3);

-- Step 3: Rebuild total_volume and total_revenue generated columns
--   (PostgreSQL does not allow modifying generated columns in-place;
--    must drop and recreate)
ALTER TABLE sales DROP COLUMN IF EXISTS total_volume;
ALTER TABLE sales DROP COLUMN IF EXISTS total_revenue;

ALTER TABLE sales
  ADD COLUMN total_volume NUMERIC(12,3) GENERATED ALWAYS AS (
    COALESCE(diesel_sales_volume, 0) +
    COALESCE(blend_sales_volume,  0) +
    COALESCE(ulp_sales_volume,    0) +
    COALESCE(flex_blend_volume,   0) +
    COALESCE(flex_diesel_volume,  0) +
    COALESCE(lpg_sales_volume,    0)   -- LPG included in network total
  ) STORED,
  ADD COLUMN total_revenue NUMERIC(14,2) GENERATED ALWAYS AS (
    COALESCE(diesel_sales_value, 0) +
    COALESCE(blend_sales_value,  0) +
    COALESCE(ulp_sales_value,    0) +
    COALESCE(flex_blend_value,   0) +
    COALESCE(flex_diesel_value,  0) +
    COALESCE(lpg_sales_value,    0)
  ) STORED;

-- Step 4: Refresh materialized views to include LPG
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_site_monthly_performance;
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_territory_monthly;

-- Step 5: Add upload_log table (if not yet created)
CREATE TABLE IF NOT EXISTS upload_log (
  id              BIGSERIAL PRIMARY KEY,
  file_name       VARCHAR(255) NOT NULL,
  file_size_bytes BIGINT,
  period_month    DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  row_counts      JSONB,
  error_message   TEXT,
  duration_ms     INTEGER,
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_upload_log_uploaded_at ON upload_log(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_log_status      ON upload_log(status);

-- ============================================================
-- After running this migration:
--   1. Uncomment the 'lpg' entry in lib/db.ts → PRODUCTS
--   2. Add LPG column mappings in scripts/ingest.py → ingest_status_report()
--      Look for the # LPG section placeholder
--   3. Redeploy — the dashboard filter dropdown adds LPG automatically
-- ============================================================
