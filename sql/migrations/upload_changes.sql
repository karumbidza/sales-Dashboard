-- Tracks per-row field overwrites during ingestion.
CREATE TABLE IF NOT EXISTS upload_changes (
  id            BIGSERIAL PRIMARY KEY,
  upload_log_id BIGINT REFERENCES upload_log(id) ON DELETE CASCADE,
  site_code     VARCHAR(20),
  sale_date     DATE,
  field_name    VARCHAR(50),
  old_value     TEXT,
  new_value     TEXT,
  changed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_changes_log  ON upload_changes(upload_log_id);
CREATE INDEX IF NOT EXISTS idx_upload_changes_site ON upload_changes(site_code, sale_date);
