-- Pro-rata budget calculation infrastructure.

CREATE TABLE IF NOT EXISTS budget_calendar (
  id            SERIAL PRIMARY KEY,
  period_month  DATE UNIQUE NOT NULL,
  calendar_days INTEGER NOT NULL,
  month_label   VARCHAR(20)
);

INSERT INTO budget_calendar (period_month, calendar_days, month_label)
SELECT
  generate_series::DATE,
  EXTRACT(DAY FROM (generate_series + INTERVAL '1 month' - INTERVAL '1 day'))::INTEGER,
  TO_CHAR(generate_series, 'Mon YYYY')
FROM generate_series('2025-01-01'::DATE, '2026-12-01'::DATE, '1 month')
ON CONFLICT (period_month) DO NOTHING;

CREATE OR REPLACE VIEW vw_daily_budget_rate AS
SELECT
  vb.site_code,
  vb.budget_month,
  bc.calendar_days,
  bc.month_label,
  vb.budget_volume,
  vb.stretch_volume,
  ROUND(vb.budget_volume / bc.calendar_days, 4) AS daily_budget_rate,
  ROUND(COALESCE(vb.stretch_volume, vb.budget_volume * 1.1)
        / bc.calendar_days, 4)                  AS daily_stretch_rate
FROM volume_budget vb
JOIN budget_calendar bc ON vb.budget_month = bc.period_month;
