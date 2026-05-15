-- ============================================================
-- R&M Helpdesk tickets — Freshdesk export.
-- description_norm is the SAME normalisation used by rm_invoices,
-- so tickets and invoices SHARE the rm_description_categories cache.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS rm_helpdesk_tickets (
  id                  BIGSERIAL PRIMARY KEY,
  ticket_id           BIGINT UNIQUE NOT NULL,
  site_code           VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  subject             TEXT NOT NULL,
  description_norm    TEXT GENERATED ALWAYS AS
                      (lower(trim(regexp_replace(subject, '\s+', ' ', 'g')))) STORED,
  -- Short labels stored as TEXT — Freshdesk emits values like
  -- 'Waiting on Third Party' (22 chars) that overflow tight VARCHAR caps.
  status              TEXT NOT NULL,
  priority            TEXT,
  source              TEXT,
  ticket_group        VARCHAR(40),
  agent               VARCHAR(80),
  equipment           VARCHAR(40),
  service_provider    VARCHAR(80),
  created_time        TIMESTAMPTZ NOT NULL,
  due_time            TIMESTAMPTZ,
  resolved_time       TIMESTAMPTZ,
  closed_time         TIMESTAMPTZ,
  resolution_minutes  INTEGER,
  resolution_status   TEXT,
  upload_log_id       BIGINT REFERENCES upload_log(id) ON DELETE SET NULL,
  source_file         VARCHAR(255),
  ingested_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_helpdesk_site_created ON rm_helpdesk_tickets(site_code, created_time);
CREATE INDEX IF NOT EXISTS idx_helpdesk_status      ON rm_helpdesk_tickets(status);
CREATE INDEX IF NOT EXISTS idx_helpdesk_desc_norm   ON rm_helpdesk_tickets(description_norm);
CREATE INDEX IF NOT EXISTS idx_helpdesk_priority    ON rm_helpdesk_tickets(priority);

COMMIT;
