-- ============================================================
-- rm_helpdesk_exclusions — keep-but-hide list for tickets that
-- belong to other departments (Sales, IT) sharing Freshdesk.
--
-- Keyed by the Freshdesk ticket_id (stable across re-imports
-- and even across a TRUNCATE of rm_helpdesk_tickets), so once a
-- ticket is excluded it stays excluded forever — even if you
-- wipe + reimport the main table.
--
-- Excluded tickets are NOT deleted from rm_helpdesk_tickets;
-- they're just hidden from every read query via a NOT EXISTS
-- clause. Un-checking an exclusion re-includes the ticket
-- immediately, no data loss.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS rm_helpdesk_exclusions (
  ticket_id    BIGINT PRIMARY KEY,
  excluded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluded_by  TEXT,                -- email of whoever ticked the box
  reason       TEXT                 -- 'Sales' / 'IT' / 'Test' / 'Other' / free text
);

COMMENT ON TABLE rm_helpdesk_exclusions IS
  'Tickets that should be hidden from all R&M reports/dashboards. '
  'Persists across rm_helpdesk_tickets re-imports.';

CREATE INDEX IF NOT EXISTS idx_rm_helpdesk_exclusions_reason
  ON rm_helpdesk_exclusions(reason);

-- View used by all read-side queries that don't need to surface excluded
-- tickets (i.e. anywhere outside the helpdesk dashboard validation view).
-- Single point to maintain — any new endpoint reading helpdesk tickets
-- should join this view rather than the base table.
CREATE OR REPLACE VIEW rm_helpdesk_tickets_active AS
SELECT t.*
  FROM rm_helpdesk_tickets t
 WHERE NOT EXISTS (
         SELECT 1 FROM rm_helpdesk_exclusions x
          WHERE x.ticket_id = t.ticket_id
       );

COMMIT;
