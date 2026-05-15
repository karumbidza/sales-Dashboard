# R&M Command Center — Design

**Date:** 2026-05-15
**Status:** Approved, ready for implementation plan
**Context:** Visual + structural rebuild of the maintenance area. Unifies the Cost Analysis, Helpdesk, and Maintenance pages into a single `/dashboard/rm` "Command Center" page with two parallel lenses (Cost + Efficiency) that share filters but never mix metrics in a single chart.

This document adapts the user-supplied engineering spec to the live schema. Refer to the engineering spec for full UI/UX detail; this doc captures only the deltas needed to ship against the current database.

## Goals

- Single `/dashboard/rm` page with **Cost Lens** (top) and **Efficiency Lens** (bottom).
- Global filter bar (date range, territory, site, category) drives all KPIs and charts atomically.
- 8 KPI cards: 4 Cost (YTD cost, MTD cost, $/L, Top Category) + 4 Efficiency (Open tickets, MTTR, SLA hit, Repeats).
- 6 visualizations: Cost Pareto, Cost Trend YTD-vs-LY, Site×Category Heatmap, Ticket Aging, Recurring Issues, plus the heatmap drill-down.
- No chart mixes cost data with ticket data. Lenses share filters only.
- Visual language per spec: navy/orange section dividers, 0.5px tertiary borders, 12px card padding, 19px/500-weight KPI numbers, color-encoded heatmap.

## Non-goals (revised from engineering spec)

- **NOT deprecating** `/dashboard/maintenance`, `/dashboard/helpdesk`, `/dashboard/cost-analysis`. The new page ships alongside the existing three. User decides later whether to retire them.
- **NOT** migrating `rm_invoices` schema to add `category`, `is_anomaly`, `anomaly_reason` columns — current `description_norm` join model and z-score computation work fine.
- **NOT** creating `mv_rm_site_month` materialised view — queries are fast enough on 3-5K invoice rows.
- **NOT** adding `sla_hours` column to tickets — existing `resolution_status` (`Within SLA` / `SLA Violated` / etc.) already classifies SLA outcome.
- **NOT** rewriting any of: Sales Dashboard, Rules page, Monthly Report, Data Management, auth.

## Schema adaptations

| Engineering spec proposed | Live schema reality | Adaptation |
|---|---|---|
| `rm_invoices.category` column | Join `rm_invoices` → `rm_description_categories` → `rm_categories` via `description_norm` | Use the join in every query |
| `rm_invoices.invoice_date` | `service_date` | Use `service_date` |
| `rm_invoices.is_anomaly` | Not stored | Compute z-score client-side (matches existing Cost Analysis pattern) |
| `helpdesk_tickets` table | `rm_helpdesk_tickets` table | Use real name |
| `helpdesk_tickets.sla_hours`, `sla_met`, `resolution_hours` | `resolution_minutes`, `resolution_status` (text) | Use `resolution_status='Within SLA'` for hit rate, `resolution_minutes / 60.0 / 24.0` for MTTR days |
| `rm_budget` table populated from upload | $1500/mo per site from first sale date | Implement as a SQL VIEW computing budget rows live |
| `mv_rm_site_month` materialised view | Not present | Skip — query CTEs directly |

## `rm_budget` view definition

```sql
CREATE OR REPLACE VIEW rm_budget AS
SELECT
  sa.site_code,
  gs.month::DATE AS budget_month,
  NULL::VARCHAR(50) AS category,            -- fleet-wide budget; no per-category split
  1500.00::NUMERIC(14,2) AS budget_amount
FROM site_activity sa
CROSS JOIN LATERAL generate_series(
  DATE_TRUNC('month', sa.first_sale_date),
  DATE_TRUNC('month', CURRENT_DATE),
  '1 month'::INTERVAL
) AS gs(month)
WHERE sa.first_sale_date IS NOT NULL;
```

Rationale: $1500/month per active site is a deterministic rule; storing it as a view means the budget auto-extends as new months arrive and as new sites come online, with zero maintenance.

## API endpoints (final set)

All accept `dateFrom`, `dateTo`, `territory`, `siteCode`, `category` filters.

| Endpoint | Returns |
|---|---|
| `GET /api/rm/filters` | Territories, sites, categories for the global filter bar |
| `GET /api/rm/kpis-cost` | 4 cost KPIs with vs-LY + vs-Budget sub-lines computed server-side |
| `GET /api/rm/cost-pareto?dimension=category\|site` | Sorted bars + cumulative % |
| `GET /api/rm/cost-trend` | Monthly series for current year + prior year |
| `GET /api/rm/cost-heatmap` | Site × Category matrix with z-scores |
| `GET /api/rm/kpis-efficiency` | 4 efficiency KPIs |
| `GET /api/rm/ticket-aging` | Aging buckets 0-30, 31-60, 61-90, 90+ |
| `GET /api/rm/recurring-issues?limit=4` | Top recurring subjects with site count |

Drill-down on heatmap cell reuses the existing `InvoiceDrawer` component (no new endpoint needed — drawer fetches `/api/maintenance/invoices` with filters).

## KPI formulas (against live schema)

### Cost
- **YTD Cost** = `SUM(net_cost) WHERE service_date BETWEEN year_start AND period_end`
- **vs LY** = `(curr_ytd - prior_ytd_same_days) / prior_ytd_same_days * 100` — same number of elapsed days into year
- **vs Budget** = `(curr_ytd - budget_ytd) / budget_ytd * 100` where `budget_ytd = SUM(budget_amount) FROM rm_budget WHERE budget_month BETWEEN year_start AND last_complete_month`
- **MTD Cost** = `SUM(net_cost) WHERE service_date BETWEEN month_start AND period_end`
- **MTD vs prior month** = same-elapsed-days comparison
- **MTD vs budget** = pro-rated `1500 * active_sites_count * (days_elapsed / days_in_month)`
- **Cost per Litre** = `ytd_cost / SUM(sales.total_volume WHERE sale_date in same window)`
- **Fleet median $/L** = median across all per-site ratios in same window
- **Top Category** = max `SUM(net_cost) GROUP BY category_slug` for YTD

### Efficiency
- **Open Tickets** = `COUNT(*) WHERE status NOT IN ('Closed','Resolved')`
- **Urgent open** = same with `priority = 'Urgent'`
- **MTTR** = `AVG(resolution_minutes) / 60 / 24` for tickets resolved in period
- **MTTR prior month** = same for prior month
- **SLA Hit Rate** = `COUNT(*) WHERE resolution_status='Within SLA' / COUNT(*) WHERE resolution_status IS NOT NULL * 100`
- **Breaches** = `COUNT(*) WHERE resolution_status='SLA Violated'`
- **Repeat Issues** = count of (site_code, description_norm) pairs with ≥3 tickets in last 90 days

## UI structure

```
/dashboard/rm
├── Navy header strip (matches existing dashboard chrome)
│   ├── Title: "R&M Command Center" · subtitle: "cost & efficiency · tracked separately"
│   └── Filter chips (active filter summary) — clicking opens filter drawer
├── Global filter bar (date range, territory, site, category)
├── Sticky anchor links top-right: "Cost Lens" · "Efficiency Lens"
├── COST LENS section (navy left-border divider)
│   ├── 4 KPI cards (YTD, MTD, $/L, Top Category)
│   ├── 2-up: Pareto chart | Trend chart
│   └── Site × Category heatmap (full-width)
├── 18px gap + 0.5px separator
└── EFFICIENCY LENS section (orange left-border divider)
    ├── 4 KPI cards (Open, MTTR, SLA, Repeats)
    └── 2-up: Aging chart | Recurring panel
```

## Visual tokens (from engineering spec)

- **Navy** `#1e3a5f` — Cost lens accent, dark heatmap cells, primary chrome
- **Orange** `#ea580c` — Efficiency lens accent
- **Success green** `#15803d` — below budget / below LY
- **Warning red** `#b91c1c` — above budget / SLA breaches
- **Heatmap blue ramp** (4-step): `#dbeafe → #93c5fd → #3b82f6 → #1e3a5f` (whites text on q3+q4)
- **Aging bar colors**: green `#86efac` / amber `#fcd34d` / orange `#fb923c` / red `#ef4444`
- **KPI value type**: 19px, weight 500
- **KPI label**: 10px uppercase, letter-spacing 0.3px
- **Card padding**: 12px · KPI gap: 8px · radius: `var(--border-radius-md)`

## File map

**Create:**
- `sql/migrations/rm_budget_view.sql` — the view
- `app/api/rm/filters/route.ts`
- `app/api/rm/kpis-cost/route.ts`
- `app/api/rm/cost-pareto/route.ts`
- `app/api/rm/cost-trend/route.ts`
- `app/api/rm/cost-heatmap/route.ts`
- `app/api/rm/kpis-efficiency/route.ts`
- `app/api/rm/ticket-aging/route.ts`
- `app/api/rm/recurring-issues/route.ts`
- `app/dashboard/rm/page.tsx` — main page
- `components/rm/RMFilterBar.tsx`
- `components/rm/CostKpiStrip.tsx`
- `components/rm/CostParetoChart.tsx`
- `components/rm/CostTrendChart.tsx`
- `components/rm/CostHeatmap.tsx`
- `components/rm/EfficiencyKpiStrip.tsx`
- `components/rm/TicketAgingChart.tsx`
- `components/rm/RecurringIssuesPanel.tsx`

**Modify (single-line tab additions on 6 sister pages):**
- `app/dashboard/page.tsx`
- `app/dashboard/maintenance/page.tsx`
- `app/dashboard/maintenance/rules/page.tsx`
- `app/dashboard/helpdesk/page.tsx`
- `app/dashboard/cost-analysis/page.tsx`
- `app/dashboard/monthly-report/page.tsx`

## Edge cases

1. **Sites with no first_sale_date** (`prospective`) → excluded from `rm_budget`. They contribute zero cost anyway, so no impact.
2. **No tickets resolved in period** → MTTR = `—`, SLA = `—`. Don't divide by zero.
3. **Filter narrows to a single site with no invoices** → KPIs show zeros, charts show empty states.
4. **Heatmap with one site** → z-score requires ≥2 cells per category; degenerate columns show absolute spend only, no anomaly markers.
5. **Filter category** narrows BOTH cost and ticket queries (per spec — apples-to-apples).
6. **YTD spans multiple years** when user picks a window like `2025-06-01 → 2026-06-01` → use `period_end` to derive `year_start`. Prior-year window is the matching window shifted back 365 days.

## Migration / rollout

- Single migration: `rm_budget_view.sql` (view, no data writes, fully reversible).
- No data backfill — view computes from existing `site_activity` view.
- Three existing pages keep working. `/dashboard/rm` is additive.

## Out of scope

- Auto-deprecation / 301 redirects from old pages (deferred until user validates new page).
- Budget upload UI (deferred — current $1500/site rule is sufficient).
- `/api/rm/site/:code` drill-down endpoint (heatmap drill reuses existing `InvoiceDrawer`).
- `/api/rm/open-tickets` paginated list (efficiency lens doesn't need full list — KPI count + aging chart cover the need).
- `/api/rm/anomalies` separate endpoint (heatmap z-score covers this — no separate "action queue").
- Materialised view caching.
- PDF section for Monthly Report integration.
