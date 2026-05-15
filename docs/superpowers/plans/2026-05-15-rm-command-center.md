# R&M Command Center — Implementation Plan

**Goal:** Ship `/dashboard/rm` with Cost + Efficiency lenses, 8 KPIs, 6 charts, against current schema.

**Architecture:** New page additive to existing maintenance pages (no deprecation). 8 new API endpoints under `/api/rm/*`. 8 new components under `components/rm/`. Single SQL view for budget. No schema migrations beyond the view.

**Tech Stack:** Next.js App Router · Postgres (Neon) · Recharts · Tailwind · html2pdf.js (existing).

---

## Task 1 — Foundation: rm_budget view + filters endpoint + nav tab

**Files:**
- Create: `sql/migrations/rm_budget_view.sql`
- Create: `app/api/rm/filters/route.ts`
- Modify: 6 sister pages (one-line tab add)

**Why first:** Budget view is required by cost KPIs. Filters endpoint feeds the dropdowns. Nav tab makes the new page discoverable.

**Deliverables:**
1. Apply migration to Neon (creates `rm_budget` view).
2. Filters endpoint returns `{ territories, sites, categories }`.
3. "R&M Command Center" tab added to all 6 sister pages, links to `/dashboard/rm`.

**Verify:** `SELECT * FROM rm_budget WHERE site_code='ZIN-074' LIMIT 5;` returns 5 rows (one per month from first sale). `curl /api/rm/filters` returns 3 arrays.

## Task 2 — Page shell + global filter bar + section dividers

**Files:**
- Create: `app/dashboard/rm/page.tsx`
- Create: `components/rm/RMFilterBar.tsx`

**Why second:** All subsequent components need a place to live. Filter bar provides global state.

**Deliverables:**
- `/dashboard/rm` renders with navy header, filter bar, both lens dividers (Cost = navy / Efficiency = orange), and placeholder slots for each section.
- Filter bar manages `{ dateFrom, dateTo, territory, siteCode, category }` state.
- Default date range: `YYYY-01-01` → today.

**Verify:** Visit `/dashboard/rm` locally — page renders without errors, filters update state, both section dividers visible.

## Task 3 — Cost KPIs endpoint + CostKpiStrip component

**Files:**
- Create: `app/api/rm/kpis-cost/route.ts`
- Create: `components/rm/CostKpiStrip.tsx`

**Returns:**
```typescript
{
  ytd:        { current: number, priorYear: number, deltaPctLY: number | null, budget: number, deltaPctBudget: number | null },
  mtd:        { current: number, priorMonth: number, deltaPctMoM: number | null, budget: number, deltaPctBudget: number | null },
  costPerLitre: { current: number | null, fleetMedian: number | null },
  topCategory:  { displayName: string, total: number, pctOfTotal: number } | null,
}
```

**KPI strip renders:** 4 cards per spec §5, 19px/500-weight value, dual sub-line for YTD/MTD (`▲ 9.5% vs LY · ▼ 3.0% vs Bud`).

## Task 4 — Cost Pareto endpoint + CostParetoChart

**Files:**
- Create: `app/api/rm/cost-pareto/route.ts`
- Create: `components/rm/CostParetoChart.tsx`

**Query param:** `dimension=category|site` (default `category`).

**Returns:** `Array<{ label, cost, cumulativePct, tier: 1|2|3|4 }>` sorted desc.

**Chart:** Recharts ComposedChart — bars (color by tier) + cumulative % line in red (`#dc2626`) + dashed 80% reference line.

## Task 5 — Cost Trend endpoint + CostTrendChart

**Files:**
- Create: `app/api/rm/cost-trend/route.ts`
- Create: `components/rm/CostTrendChart.tsx`

**Returns:** `{ currentYear: [{month, cost}], priorYear: [{month, cost}] }` — both Jan-Dec.

**Chart:** Recharts LineChart with two lines — current year solid navy `#1e3a5f`, prior year dashed gray `#94a3b8` (`stroke-dasharray="3 2"`). Legend top-right.

## Task 6 — Cost Heatmap endpoint + CostHeatmap

**Files:**
- Create: `app/api/rm/cost-heatmap/route.ts`
- Create: `components/rm/CostHeatmap.tsx`

**Returns:** `{ sites: [...], categories: [...], matrix: { [siteCode]: { [categorySlug]: { cost, zScore } } } }`.

**Table:** site rows × category columns. Toggle `$ YTD | $/L | z-score`. Blue ramp for `$ YTD`, diverging red/blue for z-score. `⚠` markers for `z > 2σ`, `⚠⚠` for `z > 2σ AND no tickets in same cell`. Click cell → `InvoiceDrawer` (existing component).

## Task 7 — Efficiency KPIs endpoint + EfficiencyKpiStrip

**Files:**
- Create: `app/api/rm/kpis-efficiency/route.ts`
- Create: `components/rm/EfficiencyKpiStrip.tsx`

**Returns:**
```typescript
{
  openTickets:  { total: number, urgent: number },
  mttr:         { days: number | null, priorMonthDays: number | null },
  slaHit:       { hitPct: number | null, breachCount: number },
  repeats:      { siteCount: number },
}
```

## Task 8 — Ticket Aging endpoint + TicketAgingChart

**Files:**
- Create: `app/api/rm/ticket-aging/route.ts`
- Create: `components/rm/TicketAgingChart.tsx`

**Returns:** `Array<{ bucket: '0-30'|'31-60'|'61-90'|'90+', count: number, byPriority: Record<string, number> }>`.

**Chart:** Horizontal stacked bars, one per bucket. Colors green/amber/orange/red per spec. Caption: oldest-ticket days.

## Task 9 — Recurring Issues endpoint + RecurringIssuesPanel

**Files:**
- Create: `app/api/rm/recurring-issues/route.ts`
- Create: `components/rm/RecurringIssuesPanel.tsx`

**Returns:** `Array<{ description: string, sampleSubject: string, count: number, siteCount: number, categoryName: string | null }>` — top 4 by count over last 90 days, ≥3 tickets each.

**Panel:** 2-column list (subject left, count right).

## Task 10 — PR + production smoke test

- Push branch, open PR with link to spec.
- After merge, visit `/dashboard/rm` on production.
- Verify filters update all 8 KPIs and all 6 charts atomically.
- Verify heatmap cell click opens InvoiceDrawer.
- Verify 1280px viewport — no horizontal scroll.

---

## Execution notes

- Each task is one implementer subagent. Use `haiku` for tasks 1-9 (mechanical, complete specs). Use `sonnet` for task 2 (page shell — touches multiple components and needs integration judgment).
- All endpoints respect global filters identically: every WHERE clause includes the date range + optional territory/site/category narrowing.
- Visual spec is binding — implementer prompts must include exact color hex codes, font sizes, and spacing from the engineering spec.
- Each commit message: `feat(rm): <task summary>`.
