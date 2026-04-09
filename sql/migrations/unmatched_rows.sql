-- ============================================================
-- Capture rows that ingest dropped because their site_code isn't
-- in the NAME INDEX master. Without this, manager typos and
-- not-yet-registered stations are silently lost on every upload.
-- ============================================================

CREATE TABLE IF NOT EXISTS unmatched_status_rows (
  id              BIGSERIAL PRIMARY KEY,
  raw_site_code   VARCHAR(50),                  -- exactly what was in the sheet
  sale_date       DATE,
  sheet_name      VARCHAR(50) NOT NULL,         -- 'STATUS REPORT' | 'PETROTRADE' | 'MARGIN'
  source_file     VARCHAR(255),
  upload_log_id   BIGINT REFERENCES upload_log(id) ON DELETE SET NULL,
  ingested_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_raw_code  ON unmatched_status_rows(raw_site_code);
CREATE INDEX IF NOT EXISTS idx_unmatched_sheet     ON unmatched_status_rows(sheet_name);
CREATE INDEX IF NOT EXISTS idx_unmatched_upload    ON unmatched_status_rows(upload_log_id);
CREATE INDEX IF NOT EXISTS idx_unmatched_ingested  ON unmatched_status_rows(ingested_at DESC);

COMMENT ON TABLE unmatched_status_rows IS
  'Rows the ingest dropped because their SITE CODE was not present in NAME INDEX. Surface these in the UI so silent data loss never happens.';
