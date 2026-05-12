-- ============================================================
-- R&M (Repairs & Maintenance) costs per site/category.
-- One row per maintenance event. Cost/Litre is computed at
-- query time by joining against the sales table on site+month.
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance_costs (
  id              BIGSERIAL PRIMARY KEY,
  site_code       VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  service_date    DATE NOT NULL,
  cost            NUMERIC(14,2) NOT NULL,
  category        VARCHAR(100) NOT NULL,
  upload_log_id   BIGINT REFERENCES upload_log(id) ON DELETE SET NULL,
  source_file     VARCHAR(255),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maint_site_date     ON maintenance_costs (site_code, service_date);
CREATE INDEX IF NOT EXISTS idx_maint_service_date  ON maintenance_costs (service_date);
CREATE INDEX IF NOT EXISTS idx_maint_category      ON maintenance_costs (category);

COMMENT ON TABLE maintenance_costs IS
  'Repairs & maintenance costs per site/category. Joined against sales for cost-per-litre metrics.';

COMMENT ON COLUMN unmatched_status_rows.sheet_name IS
  'Source of the unmatched row: STATUS REPORT | PETROTRADE | MARGIN | MAINTENANCE.';
