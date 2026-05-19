# R&M PDF Report — Page 1 Redesign

**Date:** 2026-05-19
**Status:** Approved, ready for implementation plan
**Scope:** Page 1 ("Cost & Operational Snapshot") only. Pages 2–6 untouched in this PR. Notes-not-printing bug deferred.

## Goals

Rebuild the first page of the R&M PDF report to present a management-grade snapshot in one page. Resolves three operational issues with the current output:

1. Brand text reads "Redan Petroleum" — must be "Redan Coupon" everywhere.
2. Unicode arrows (`▲ ▼ •`) render as missing-glyph boxes in print.
3. Page 1 today is cost-only; management wants both cost and operational efficiency visible at a glance.

Page 1 also gets the redesigned layout from the approved mockup (May 2026): 4 cost tiles + 2 efficiency tiles + side-by-side Pareto/Trend + Territory Snapshot strip.

## Out of scope

- Page 2 heatmap traffic-light redesign (v2 spec §7.3) — separate PR
- Pages 4–7 (Appendix, Category Deep Dive, Notes Index, Methodology) — directional in v2 spec, not built
- Notes-not-printing bug — investigation deferred to its own task
- Dashboard UI changes — print path only

## Layout

```
┌─ HEADER ───────────────────────────────────────────────────────┐
│ REDAN COUPON · R&M REPORT       1–30 Apr 2026 · MTD            │
│ Cost & Operational Snapshot     Generated 19 May 2026          │
├─ ▎ COST PERFORMANCE ───────────────────────────────────────────┤
│ ┌─YTD──────┐ ┌─MTD──────┐ ┌─Cost/L───┐ ┌─Top Category · MTD──┐│
│ │$426.4K   │ │$84.6K    │ │0.82¢     │ │Pumps/Dispensers     ││
│ │▲4.3% LY  │ │▼22% LM   │ │▼0.06¢ LM │ │$17.4K · 21% of MTD  ││
│ │▲4.5% Bud │ │▼11% Bud  │ │          │ │──────────────────── ││
│ │          │ │          │ │          │ │TOP CONTRIBUTORS     ││
│ │          │ │          │ │          │ │ 1 ZINDOGA     $2.8K ││
│ │          │ │          │ │          │ │ 2 GLENARA     $1.5K ││
│ │          │ │          │ │          │ │ 3 CHIKWANHA   $1.5K ││
│ └──────────┘ └──────────┘ └──────────┘ └─────────────────────┘│
├─ ▎ OPERATIONAL EFFICIENCY ─────────────────────────────────────┤
│ ┌─Tickets Opened · MTD ──┐ ┌─Backlog Health ───────────────┐ │
│ │142          Avg Resp   │ │NO-ACTION    WAITING 3RD PARTY│ │
│ │             4.2h       │ │24           58               │ │
│ │             ▼1.1h LM   │ │▲2 LM        ▲5 LM            │ │
│ │────────────────────────│ │──────────────────────────────│ │
│ │TOP CONTRIBUTING SITES  │ │MOST UN-ACTIONED SITES        │ │
│ │ 1 WARREN HILLS  18 t.  │ │ 1 CHINHOYI   7 open · 3 >30d │ │
│ │ 2 CHITUNGWIZA   14 t.  │ │ 2 TRIANGLE   5 open · 2 >30d │ │
│ │ 3 CHACHACHA     11 t.  │ │ 3 MAZOWE     4 open · 1 >30d │ │
│ └────────────────────────┘ └──────────────────────────────┘ │
│ ┌─Cost Pareto · category ┐ ┌─Cost Trend · monthly ─────────┐ │
│ │  [bars + 80% line]     │ │ [bars + LY dashed + Bud line] │ │
│ └────────────────────────┘ └───────────────────────────────┘ │
│ Territory Snapshot · MTD spend & YoY                         │
│ SALIYA   ████████████████████   $24.8K   ▲12.1% YoY          │
│ BRENDON  ███████████████        $18.9K   ▼3.4% YoY           │
│ TENDAI   ████████████           $15.8K   ▲5.7% YoY           │
│ TAFARA   ██████████             $13.0K   ─0.8% YoY           │
└──────────────────────────────────────────────────────────────┘
```

Removed from current page 1: existing KPI strip (replaced by 4 cost tiles), `Top Risers / Top Droppers` block (replaced by Territory Snapshot).

Heights, padding, colours, typography per v2 engineering spec §6. Charts at 170pt height. Tile padding 8×10pt. Lens labels use a 2.5pt left border in section colour (`#1e3a5f` for cost, `#ea580c` for efficiency).

## Arrow rendering (fixes missing glyphs)

Unicode `▲ ▼ ─` are unreliable across print fonts and currently render as boxes. Replace with SVG symbols defined once at the document root and referenced via `<use>`:

```html
<svg width="0" height="0" style="position: absolute;">
  <defs>
    <symbol id="arrUp"   viewBox="0 0 8 8"><path d="M4 1 L7.5 6.5 L0.5 6.5 Z" fill="currentColor"/></symbol>
    <symbol id="arrDown" viewBox="0 0 8 8"><path d="M4 7 L0.5 1.5 L7.5 1.5 Z" fill="currentColor"/></symbol>
    <symbol id="arrFlat" viewBox="0 0 8 8"><rect x="1" y="3.5" width="6" height="1" fill="currentColor"/></symbol>
  </defs>
</svg>
```

Definition lives in `app/reports/rm/print/layout.tsx`. Usage: `<svg width="7" height="7"><use href="#arrUp"/></svg>`. Color follows the parent's `currentColor`.

Semantic colours:
- Cost up vs LY/budget → red; cost down → green
- Tickets opened up → red; avg response down → green
- No-action / waiting up → red; down → green
- Territory YoY up → red; down → green; `|YoY| < 1%` → grey flat

Edits required:
- `components/print/CostPerformancePage.tsx:34, 159, 174` — replace inline `▲ ▼ •`
- `components/print/EfficiencyPage.tsx:27` — replace inline `▲ ▼ •` (small clean-up, kept narrow)

## Data contract

### `app/api/rm/kpis-cost/route.ts` (modify, additive)

- `topCategory` now computed over the **report period** (`period_from` to `period_to` from the filters; label in the tile reads "MTD" since most reports run for a calendar month, but the scope is whatever range the user selected). Current implementation uses YTD.
- Add `topCategory.contributors: [{ rank: 1|2|3, siteName, value }]` — top 3 sites by spend within the top category, scoped to the report period
- Drop fleet-median field from `costPerLitre` (unused; preserves only `value` and `vsLM`)

### `app/api/rm/kpis-efficiency/route.ts` (modify, additive)

Add:
```ts
{
  ticketsOpened: {
    value: number;                 // tickets with created_time in period
    avgResponseHours: number;      // mean resolution_minutes / 60 (proxy until first-response field exists)
    vsLM: number;                  // hours delta vs prior month
    contributors: [{ rank, siteName, count }];   // top 3 by ticket volume
  };
  noActionOpen: {
    value: number;                 // status IN ('Open','Pending') open at period_end
    vsLM: number;                  // count delta vs same metric at prior month-end
    oldestSites: [{ rank, siteName, openCount, staleCount }];  // top 3 by openCount (no-action)
  };
  waitingThirdParty: {
    value: number;                 // status = 'Waiting on Third Party' open at period_end
    vsLM: number;
  };
}
```

Existing fields stay (the dashboard already reads some). Additive only.

### `app/api/rm/cost-trend/route.ts` (modify, additive)

Add to response:
- `priorYear: [{ month, value }]` — same months one calendar year earlier
- `budget: number` — monthly budget target

Used by the new bar+line+reference composite trend chart.

### `app/api/rm/territory-snapshot/route.ts` (new)

```ts
{
  snapshot: [
    { tmName: string; mtdSpend: number; yoyPct: number; barPctOfMax: number }
  ]
}
```

- 4 TM rows ordered by `mtdSpend` desc; include a 5th `UNASSIGNED` row only if returned by SQL
- `yoyPct` signed; `barPctOfMax = round((mtdSpend / max(mtdSpend across rows)) * 100)`

### `lib/buildReportPayload.ts` (modify)

- Add territory-snapshot fetch in parallel with existing endpoint calls
- Pull new fields from kpis-cost / kpis-efficiency into the shape consumed by the print component
- Stop reading `top-movers` for page 1 (endpoint stays; just remove the dependency)

## SQL definitions

All queries below replace the v2 spec §12 SQL, which referenced columns that do not exist in our schema (`amount`, `invoice_date`, `sla_met`, `created_at`, `period_month`).

Bind-parameter convention used in this section: `$1 = period_from`, `$2 = period_to`, `$3 = territory tm_code (nullable)`.

### Top category MTD + contributors

Top category is derived from the existing per-category aggregation already computed in `kpis-cost`. Contributors:

```sql
WITH top_cat AS (
  SELECT c.slug
  FROM rm_invoices i
  JOIN sites s ON i.site_code = s.site_code
  JOIN rm_description_categories c ON i.description_norm = c.description_norm
  WHERE i.service_date BETWEEN $1 AND $2     -- MTD window
    AND ($3::text IS NULL OR s.territory_id = (SELECT id FROM territories WHERE tm_code = $3))
  GROUP BY c.slug
  ORDER BY SUM(i.net_cost) DESC
  LIMIT 1
)
SELECT s.budget_name AS site_name, SUM(i.net_cost) AS value
FROM rm_invoices i
JOIN sites s ON i.site_code = s.site_code
JOIN rm_description_categories c ON i.description_norm = c.description_norm
JOIN top_cat ON c.slug = top_cat.slug
WHERE i.service_date BETWEEN $1 AND $2
  AND ($3::text IS NULL OR s.territory_id = (SELECT id FROM territories WHERE tm_code = $3))
GROUP BY s.budget_name
ORDER BY value DESC
LIMIT 3;
```

(Final shape may be cleaner if categorisation join is already factored into a view — implementation plan to confirm.)

### Backlog at period-end

Open-at-period-end is defined point-in-time: a ticket is open at time `T` iff `created_time <= T AND (resolved_time IS NULL OR resolved_time > T)`. This makes the report reproducible — running the same period later still shows the same backlog state.

```sql
-- No-action open (truly stuck)
SELECT COUNT(*) AS no_action_open
FROM rm_helpdesk_tickets
WHERE status IN ('Open', 'Pending')
  AND created_time <= $2::timestamptz
  AND (resolved_time IS NULL OR resolved_time > $2::timestamptz);

-- Waiting on third party (assigned but not done)
SELECT COUNT(*) AS waiting
FROM rm_helpdesk_tickets
WHERE status = 'Waiting on Third Party'
  AND created_time <= $2::timestamptz
  AND (resolved_time IS NULL OR resolved_time > $2::timestamptz);

-- Most un-actioned sites (top 3 by no-action count, with stale >30d)
SELECT s.budget_name AS site_name,
       COUNT(*) AS open_count,
       COUNT(*) FILTER (WHERE t.created_time < $2::timestamptz - INTERVAL '30 days') AS stale_count
FROM rm_helpdesk_tickets t
JOIN sites s ON t.site_code = s.site_code
WHERE t.status IN ('Open', 'Pending')
  AND t.created_time <= $2::timestamptz
  AND (t.resolved_time IS NULL OR t.resolved_time > $2::timestamptz)
  AND ($3::text IS NULL OR s.territory_id = (SELECT id FROM territories WHERE tm_code = $3))
GROUP BY s.budget_name
ORDER BY open_count DESC, stale_count DESC
LIMIT 3;
```

Period-end `$2` is `dateTo` from the report filters. `vsLM` for backlog metrics compares against the same query with `$2 = dateTo - INTERVAL '1 month'`.

### Tickets opened + contributors

```sql
-- Volume and avg response (current period)
SELECT COUNT(*) AS opened,
       AVG(resolution_minutes) / 60.0 AS avg_response_hours
FROM rm_helpdesk_tickets t
JOIN sites s ON t.site_code = s.site_code
WHERE t.created_time BETWEEN $1 AND $2
  AND ($3::text IS NULL OR s.territory_id = (SELECT id FROM territories WHERE tm_code = $3));

-- Top 3 contributors
SELECT s.budget_name AS site_name, COUNT(*) AS count
FROM rm_helpdesk_tickets t
JOIN sites s ON t.site_code = s.site_code
WHERE t.created_time BETWEEN $1 AND $2
  AND ($3::text IS NULL OR s.territory_id = (SELECT id FROM territories WHERE tm_code = $3))
GROUP BY s.budget_name
ORDER BY count DESC
LIMIT 3;
```

`avg_response_hours` uses `resolution_minutes` as a proxy for now — true first-response time isn't captured in the Freshdesk export. Acceptable for v1.

### Territory snapshot

```sql
WITH current AS (
  SELECT t.tm_name, SUM(i.net_cost) AS mtd_spend
  FROM rm_invoices i
  JOIN sites s ON i.site_code = s.site_code
  JOIN territories t ON s.territory_id = t.id
  WHERE i.service_date BETWEEN $1 AND $2
  GROUP BY t.tm_name
),
prior AS (
  SELECT t.tm_name, SUM(i.net_cost) AS prior_spend
  FROM rm_invoices i
  JOIN sites s ON i.site_code = s.site_code
  JOIN territories t ON s.territory_id = t.id
  WHERE i.service_date BETWEEN $1::date - INTERVAL '1 year'
                           AND $2::date - INTERVAL '1 year'
  GROUP BY t.tm_name
),
max_spend AS (SELECT MAX(mtd_spend) AS m FROM current)
SELECT
  c.tm_name,
  c.mtd_spend,
  ROUND(((c.mtd_spend - COALESCE(p.prior_spend, 0)) / NULLIF(p.prior_spend, 0)) * 100, 1) AS yoy_pct,
  ROUND((c.mtd_spend / NULLIF(m.m, 0)) * 100)::int AS bar_pct_of_max
FROM current c
LEFT JOIN prior p USING (tm_name)
CROSS JOIN max_spend m
ORDER BY c.mtd_spend DESC;
```

Unassigned sites (no `territory_id`) are bucketed into a synthetic `UNASSIGNED` row only if any current-period spend falls there. Up to 5 rows total.

## Brand rename

Single textual instance + filename:
- `components/exec/ReportCover.tsx` — replace `Redan Petroleum` literal with `Redan Coupon`
- `app/api/reports/rm/generate/route.ts` — change PDF filename pattern from `Redan-RM-Report-{from}_to_{to}.pdf` to `Redan-Coupon-RM-Report-{from}_to_{to}.pdf`
- Print header brand strip already says `Redan Coupon` once we rebuild `CostPerformancePage.tsx`

No global find-replace needed — only one hard-coded occurrence exists today.

## File-level changes summary

**Modify:**
- `app/api/rm/kpis-cost/route.ts` (additive)
- `app/api/rm/kpis-efficiency/route.ts` (additive)
- `app/api/rm/cost-trend/route.ts` (additive)
- `app/api/reports/rm/generate/route.ts` (filename string)
- `lib/buildReportPayload.ts` (new fetches, drop top-movers dependency)
- `app/reports/rm/print/layout.tsx` (add SVG symbol defs)
- `app/reports/rm/print/print.css` (new tile / lens / territory-bar styles)
- `components/print/CostPerformancePage.tsx` (full rewrite for new layout)
- `components/print/EfficiencyPage.tsx` (Unicode → SVG arrows only)
- `components/exec/ReportCover.tsx` (brand rename)

**Add:**
- `app/api/rm/territory-snapshot/route.ts`

**Untouched:**
- `components/print/HeatmapPage.tsx`, `TicketHeatmapPage.tsx`, `PageFrame.tsx`
- `app/api/rm/top-movers/route.ts` (endpoint stays live; just unused by page 1)
- `components/rm/*` (dashboard components — not in print path)

## Acceptance criteria

- [ ] PDF opens with no missing-glyph boxes; every arrow renders cleanly via SVG
- [ ] Header reads `REDAN COUPON · R&M REPORT`; filename is `Redan-Coupon-RM-Report-…`
- [ ] Page 1 has 4 cost tiles in row 1, 2 efficiency tiles in row 2, charts side-by-side, Territory Snapshot at bottom
- [ ] Top Category tile is MTD-scoped, names the category, and lists top 3 contributing sites
- [ ] Cost/Litre tile shows only `value` and `▼/▲ vs LM` — no fleet median
- [ ] Tickets Opened tile shows count + avg response + top 3 contributing sites
- [ ] Backlog Health tile shows no-action count on the left, waiting-3rd-party count on the right, top 3 un-actioned sites with stale-30d count
- [ ] Cost Trend chart shows bars (current year) + dashed line (prior year) + horizontal dashed line (budget); current-year bar values labelled above bars
- [ ] Territory Snapshot strip shows 4 TM rows with horizontal bar, MTD spend, and signed YoY% with appropriately coloured arrow
- [ ] Pages 2–6 render identically to current output (regression check)
- [ ] Generation completes in <5s p95 for a one-month report
- [ ] Existing dashboard at `/dashboard/rm` continues to render correctly (additive API changes only)

## Risks / open questions

1. `resolution_minutes` as a proxy for `avgResponseHours` may overstate first-response time — flag in the implementation plan and accept as v1.
2. Territory filter applied at top of page 1 should propagate to all tiles consistently; review during implementation.
3. If no spend exists in the prior-year window for a TM, YoY is `NULL` — render as `─` flat, not as `▲∞`.
4. The notes-not-printing bug remains open and may surface when generating test reports during QA; document but do not fix in this PR.
