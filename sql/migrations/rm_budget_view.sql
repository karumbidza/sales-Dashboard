-- ============================================================
-- rm_budget VIEW — $1500/month per site from first sale date.
--
-- Budget is a deterministic rule, not stored data:
--   - Every site that has ever sold gets $1500/month allocated
--   - Starting from the calendar month of its first sale
--   - Through the current calendar month
--   - Category is NULL (fleet-wide budget; no per-category split)
--
-- Implemented as a VIEW so it auto-extends as new months arrive
-- and as new sites come online — zero maintenance.
-- ============================================================

CREATE OR REPLACE VIEW rm_budget AS
SELECT
  sa.site_code,
  gs.month::DATE                     AS budget_month,
  NULL::VARCHAR(50)                  AS category,
  1500.00::NUMERIC(14,2)             AS budget_amount
FROM site_activity sa
CROSS JOIN LATERAL generate_series(
  DATE_TRUNC('month', sa.first_sale_date),
  DATE_TRUNC('month', CURRENT_DATE),
  '1 month'::INTERVAL
) AS gs(month)
WHERE sa.first_sale_date IS NOT NULL;

COMMENT ON VIEW rm_budget IS
  'Computed monthly R&M budget: $1500 per active site from its first sale month through current month. Used by R&M Command Center cost KPIs.';
