-- ============================================================
-- Site lifecycle / submission monitoring
-- ============================================================
-- Source of truth: a site is "active" once it appears in `sales`,
-- and stays active as long as it keeps reporting daily.
--
-- Cadence: status reports are daily. Shift cycle is 06:00–06:00,
-- so yesterday's report lands by ~12:00 today. Weekend reports
-- catch up on Monday → tolerance is 3 days before flagging late.
--
-- Status thresholds (days since last sale):
--   active   ≤ 3
--   late     4–7
--   stale    8–30
--   dormant  > 30
--   prospective: in `sites`, never appeared in `sales`
-- ============================================================

CREATE OR REPLACE VIEW site_activity AS
SELECT
  s.site_code,
  s.budget_name      AS site_name,
  s.moso,
  s.territory_id,
  t.tm_code          AS territory_code,
  t.tm_name          AS territory_name,
  agg.first_sale_date,
  agg.last_sale_date,
  agg.days_reported,
  CASE
    WHEN agg.last_sale_date IS NULL THEN NULL
    ELSE (CURRENT_DATE - agg.last_sale_date)
  END AS days_since_last,
  CASE
    WHEN agg.last_sale_date IS NULL                       THEN 'prospective'
    WHEN (CURRENT_DATE - agg.last_sale_date) <= 3         THEN 'active'
    WHEN (CURRENT_DATE - agg.last_sale_date) <= 7         THEN 'late'
    WHEN (CURRENT_DATE - agg.last_sale_date) <= 30        THEN 'stale'
    ELSE 'dormant'
  END AS status
FROM sites s
LEFT JOIN territories t ON s.territory_id = t.id
LEFT JOIN (
  SELECT site_code,
         MIN(sale_date)              AS first_sale_date,
         MAX(sale_date)              AS last_sale_date,
         COUNT(DISTINCT sale_date)   AS days_reported
  FROM sales
  GROUP BY site_code
) agg ON agg.site_code = s.site_code;

COMMENT ON VIEW site_activity IS
  'Per-site lifecycle derived from sales submissions. Single source of truth for site status, first/last reported date, and reporting cadence checks.';
