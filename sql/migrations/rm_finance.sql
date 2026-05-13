-- ============================================================
-- R&M Finance with AI categorization
-- Replaces maintenance_costs with a 3-table model:
--   rm_categories            : seed taxonomy (13 rows)
--   rm_description_categories: cache + override store keyed on description text
--   rm_invoices              : one row per Dynamics ledger entry
-- ============================================================

BEGIN;

-- 1. Categories ---------------------------------------------
CREATE TABLE IF NOT EXISTS rm_categories (
  id            SERIAL PRIMARY KEY,
  slug          VARCHAR(40) UNIQUE NOT NULL,
  display_name  VARCHAR(80) NOT NULL,
  sort_order    SMALLINT NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO rm_categories (slug, display_name, sort_order) VALUES
  ('pumps_dispensers',     'Pumps / Dispensers',        1),
  ('compressors_air',      'Compressors / Air',         2),
  ('tanks_lines',          'Tanks / Lines / Bunds',     3),
  ('generators',           'Generators / Backup Power', 4),
  ('solar_ups',            'Solar / UPS',               5),
  ('electrical_lighting',  'Electrical & Lighting',     6),
  ('plumbing_water_waste', 'Plumbing / Water / Waste',  7),
  ('building_civil',       'Building / Civil',          8),
  ('canopy_signage',       'Canopy / Signage',          9),
  ('landscaping_grounds',  'Landscaping / Grounds',    10),
  ('fire_safety',          'Fire & Safety',            11),
  ('security_cctv',        'Security / CCTV',          12),
  ('other',                'Other / Uncategorised',    99)
ON CONFLICT (slug) DO NOTHING;

-- 2. Description-level categorization (cache + override) ----
CREATE TABLE IF NOT EXISTS rm_description_categories (
  id                BIGSERIAL PRIMARY KEY,
  description_norm  TEXT UNIQUE NOT NULL,
  category_id       INT REFERENCES rm_categories(id),
  confidence        VARCHAR(10),       -- 'high' | 'medium' | 'low' | NULL while pending
  source            VARCHAR(10) NOT NULL,  -- 'ai' | 'override' | 'pending'
  needs_review      BOOLEAN DEFAULT FALSE,
  ai_model          VARCHAR(40),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rdc_needs_review
  ON rm_description_categories(needs_review) WHERE needs_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_rdc_source
  ON rm_description_categories(source);

-- 3. Invoices (one row per Dynamics ledger entry) -----------
CREATE TABLE IF NOT EXISTS rm_invoices (
  id                BIGSERIAL PRIMARY KEY,
  entry_no          BIGINT UNIQUE NOT NULL,
  site_code         VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  service_date      DATE NOT NULL,
  description       TEXT NOT NULL,
  description_norm  TEXT GENERATED ALWAYS AS
                    (lower(trim(regexp_replace(description, '\s+', ' ', 'g')))) STORED,
  debit_lcy         NUMERIC(14,2) NOT NULL,
  credit_lcy        NUMERIC(14,2) DEFAULT 0,
  net_cost          NUMERIC(14,2) GENERATED ALWAYS AS (debit_lcy - credit_lcy) STORED,
  document_type     VARCHAR(20),
  document_no       VARCHAR(40),
  external_doc_no   VARCHAR(40),
  gl_account_no     VARCHAR(20),
  cost_center       VARCHAR(20) NOT NULL,
  upload_log_id     BIGINT REFERENCES upload_log(id) ON DELETE SET NULL,
  source_file       VARCHAR(255),
  ingested_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rmi_site_date    ON rm_invoices(site_code, service_date);
CREATE INDEX IF NOT EXISTS idx_rmi_service_date ON rm_invoices(service_date);
CREATE INDEX IF NOT EXISTS idx_rmi_desc_norm    ON rm_invoices(description_norm);
CREATE INDEX IF NOT EXISTS idx_rmi_cost_center  ON rm_invoices(cost_center);

-- 4. Drop the old simple table ------------------------------
DROP TABLE IF EXISTS maintenance_costs;

COMMIT;
