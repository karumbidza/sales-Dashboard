-- ============================================================
-- Widen rm_helpdesk_tickets short enum columns to TEXT.
-- Freshdesk emits values like "Waiting on Third Party" (22 chars)
-- which overflow VARCHAR(20). Postgres treats VARCHAR and TEXT
-- identically performance-wise — there is no benefit to the
-- length cap for small enums.
-- ============================================================

BEGIN;

ALTER TABLE rm_helpdesk_tickets
  ALTER COLUMN status            TYPE TEXT,
  ALTER COLUMN priority          TYPE TEXT,
  ALTER COLUMN source            TYPE TEXT,
  ALTER COLUMN resolution_status TYPE TEXT;

COMMIT;
