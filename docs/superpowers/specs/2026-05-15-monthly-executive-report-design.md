# Monthly Executive Report — Design

**Date:** 2026-05-15
**Status:** Design approved, ready for implementation plan
**Context:** Follow-on to the Cost Analysis page (Project B). Management wants a polished monthly PDF report they can email — covering cost justification, helpdesk performance, site efficiency, and follow-up action items in a single document.

The existing interactive dashboards (Maintenance, Helpdesk, Cost Analysis) are tuned for browsing and drilling. A monthly report is a different surface: standardized, summary-level, period-bounded, designed for asynchronous consumption by upper management.

## Goals

- Single page `/dashboard/monthly-report` with a month picker and **Generate PDF** button.
- Five fixed sections covering cost, helpdesk, sites, and action items.
- A 5-page A4-portrait PDF named `Redan-Monthly-Report-YYYY-MM.pdf` downloaded on click.
- Period-over-period deltas (MoM) so improvement/regression is visible at a glance.
- Same template every month, so management can learn to read it consistently.

## Non-goals

- Auto-scheduled generation (cron-emailed reports). User clicks Generate.
- Email delivery from the app. User downloads then emails manually.
- Customizable templates (rejected as Option B in brainstorming).
- Cross-month aggregation (Q1, YTD). Future variant if demand emerges.
- Comparison to budget / target. No budget data system.
- Year-over-year comparison. Tickets only have 6 months of history. Defer.
- Per-site one-pagers. Distinct future feature.
- Watermarks (DRAFT/CONFIDENTIAL).

## Architecture

### Data flow

```
User picks month
   ↓
GET /api/executive/monthly?month=YYYY-MM
   ↓
Single endpoint returns ALL 5 sections in one payload:
{
  cover:       { period, kpis, prior_month_deltas }
  cost:        { trend12m, percentOfRevenue, topCategories }
  helpdesk:    { slaHit, avgResolution, topContractors, openAtMonthEnd, topRecurring }
  sites:       { topEfficient, bottomEfficient, preventiveOnly, unbilledOnly }
  actionItems: { outliers, longOpenTickets, slaViolatedThisMonth }
}
   ↓
Page renders 5 React sections from the payload
   ↓
"Generate PDF" → html2pdf.js snapshots #exec-report-root
   ↓
Browser downloads Redan-Monthly-Report-YYYY-MM.pdf
```

### Why one endpoint

The report is one document. Splitting into 5 endpoints would mean 5 parallel fetches, 5 error states, possible inconsistency if month-end timing differs across requests, and more roundtrips. One endpoint = one snapshot of "as-of-now" data for one month.

### Period semantics

A month is the calendar month `[YYYY-MM-01, YYYY-MM-01 + 1 month)` (half-open). Filters by source:
- Sales: `sale_date`
- Invoices: `service_date`
- Tickets: `created_time::DATE`

Default month is the previous calendar month (most recent fully-closed period).

### Data sources

- `sales` — volume + revenue, 5+ years of history.
- `rm_invoices` — R&M cost + category, ~16 months of history.
- `rm_helpdesk_tickets` — ticket counts + SLA, 6 months of history.
- `rm_description_categories` + `rm_categories` — shared categorization cache.
- `sites` — site master for names + territory.

## Report content

### Section 1 — Cover + KPI summary (1 page)

Title block with the month name and generated-at timestamp. Then 4 KPI cards:

| Card | Source | Delta basis |
|---|---|---|
| Volume L | `SUM(sales.total_volume)` | vs prior calendar month |
| Revenue $ | `SUM(sales.total_revenue)` | vs prior calendar month |
| R&M Cost $ | `SUM(rm_invoices.net_cost) WHERE cost_center='retail'` | vs prior calendar month |
| Tickets | `COUNT(rm_helpdesk_tickets)` | vs prior calendar month |

Each KPI shows the current month value and a small delta indicator (▲/▼ + percentage) vs the prior month. Below the cards, a single highlight: `R&M as % of revenue: 0.146% (▼ from 0.172% prior month)`.

Direction styling: green for "good direction" (revenue/volume up, R&M cost down, SLA up), red for "bad direction", neutral for ambiguous (tickets up could mean better visibility or more breakdowns).

### Section 2 — Cost justification (1 page)

Two charts and a top-categories table:

- **R&M Cost Trend (12 months)** — Recharts line chart. Current month highlighted with a dot. Includes the prior 11 months.
- **R&M as % of Revenue (12 months)** — line chart of the ratio over time.
- **Top categories this month** — table with category, current spend, MoM change, and a "biggest driver" annotation when a category's MoM increase >15% is dominated by a single site.

The "biggest driver" heuristic: if `top_category_mom_change > 15%` AND `(single_site_share_of_increase) > 0.5`, annotate with the site name. Cheap to compute, useful when it triggers.

### Section 3 — Helpdesk performance (1 page)

| Metric | Computation | Comparison |
|---|---|---|
| SLA Hit Rate | `COUNT(resolution_status='Within SLA') / COUNT(resolution_status IS NOT NULL)` | vs prior **90-day rolling avg** (not just prior month — SLA is noisy month-to-month) |
| Avg Resolution Time | `AVG(resolution_minutes) FILTER (resolution_minutes IS NOT NULL)` | vs prior month |
| Open at Month-End | `COUNT(status NOT IN ('Closed','Resolved') AND created_time < month_end)` | absolute count, broken down by priority |

Plus two tables:
- **Top 5 contractors** by ticket count, with avg resolution time and SLA hit rate.
- **Top recurring problems** — top 5 `description_norm` groups with category, count, sample subject.

### Section 4 — Site analysis (1 page)

Two ranked tables and two gap callouts:

- **Top 5 most efficient** — lowest `R&M_cost / volume` per site this month, with volume + R&M cost + ratio.
- **Bottom 5 needs attention** — highest `R&M_cost / volume`, plus a note flag (`▲ vs prior month` if MoM regression) and a note on which categories drove the cost.
- **Operational gaps**:
  - Sites with R&M cost but no tickets (preventive / scheduled / unticketed in-house work)
  - Sites with tickets but no invoices (in-house resolution / contract-covered / unbilled)

Both gap lists capped at top 5 each for the report.

### Section 5 — Action items (1 page)

Heuristic-driven punch list:

- **Outlier cells** — pulled from the Cost Analysis matrix logic: cells with `cost_per_ticket > 2.5σ` above their category mean. Top 5.
- **Tickets open >30 days** — count, broken down by priority. Top 5 listed by individual ticket ID.
- **SLA violated this month** — count, plus the 2 most-affected sites.

These are the "things to follow up on" — what a manager would forward to the team.

### Empty-state handling

Every section renders even with zero data. Messages:
- No invoices that month → cost trend shows zero point + "No R&M spend in this period".
- No tickets → helpdesk shows N/A on SLA stats + "No tickets opened in this period".
- No outliers >2.5σ → action items shows "No significant outliers this month" instead of an empty list.

Sections never disappear — the report keeps its shape every month.

## API endpoint

`GET /api/executive/monthly?month=YYYY-MM`

Returns a single JSON payload with 5 top-level keys: `cover`, `cost`, `helpdesk`, `sites`, `actionItems`. Each key holds the data for its corresponding section.

Internal implementation: multiple sequential SQL queries (one per section), assembled into the response. Could be optimized with a single CTE later if latency matters, but for monthly cadence sub-second-per-section is fine.

## UI

### Page: `/dashboard/monthly-report`

Tab strip: `Sales | Data | Maint | Rules | Helpdesk | Cost Analysis | [Monthly Report]` (active span).

Top bar:
- `<input type="month">` bound to filter state. Default is previous calendar month.
- **Refresh** button — re-fetches the current month's data.
- **Generate PDF** button — triggers html2pdf.js.

The report region (`id="exec-report-root"`) renders below the controls. Five sections separated by Tailwind `break-before-page` for clean PDF page breaks.

### Components

| Component | Section |
|---|---|
| `ReportCover` | 1 — cover + KPIs |
| `CostSection` | 2 — cost justification |
| `HelpdeskSection` | 3 — helpdesk performance |
| `SitesSection` | 4 — site analysis |
| `ActionItemsSection` | 5 — action items |

Each component receives its slice of the API payload as a prop. No additional fetches per component.

### PDF generation

Reuses the existing `html2pdf.js` pattern from the Maintenance page's "Export PDF" button. Configuration differs only in:
- `orientation: 'portrait'` (Maintenance uses landscape).
- Filename pattern: `Redan-Monthly-Report-YYYY-MM.pdf`.
- Page breaks honored via CSS (`break-before-page` on each section).

### Print-friendly CSS

The report region uses standard Tailwind classes that already render well on paper. No custom `@media print` rules needed — `html2pdf` renders the current DOM as-is. The page controls (filter bar, buttons) live OUTSIDE `#exec-report-root` so they don't appear in the PDF.

### Loading / error states

- **Initial load**: skeleton placeholders for all 5 sections.
- **Error**: banner at the top of the report region with retry button. Generate PDF disabled.
- **Partial data**: sections render with their own empty-state messages. PDF still generates — useful as record-of-nothing-happened.

## Edge cases

1. **Future month or partial current month** — small label `*partial — month not yet complete` next to title. No special handling beyond that; SQL returns less data.

2. **No prior month data** — first-ever generated report has no comparison. MoM delta shows `—` instead of arrow. Other content unchanged.

3. **Site present in invoices but not sales** — drops out of the per-litre efficiency ranking (NULL volume excluded). Still appears in absolute cost lists.

4. **Outlier detection requires ≥2 same-category samples** — categories with only one cell that month produce no outliers. Section silently shorter.

5. **Categorization changes between months** — if you reclassify a description mid-month, prior-month comparisons may shift retroactively. That's correct: the report shows the *current* categorization view of *historical* data. Footer note: "Categories reflect current classification."

6. **PDF generation timing** — 3–8 seconds typical for 5-page report with multiple Recharts SVGs. The Generate button shows "Generating PDF…" and is disabled to prevent double-clicks.

## File map

**Create:**
- `app/api/executive/monthly/route.ts` — single endpoint returning all 5 sections
- `app/dashboard/monthly-report/page.tsx` — page with month picker, Generate PDF, and report sections
- `components/exec/ReportCover.tsx`
- `components/exec/CostSection.tsx`
- `components/exec/HelpdeskSection.tsx`
- `components/exec/SitesSection.tsx`
- `components/exec/ActionItemsSection.tsx`

**Modify (one-line tab additions on 5 sister pages):**
- `app/dashboard/page.tsx`
- `app/dashboard/maintenance/page.tsx`
- `app/dashboard/maintenance/rules/page.tsx`
- `app/dashboard/helpdesk/page.tsx`
- `app/dashboard/cost-analysis/page.tsx`

## Migration / rollout

- No database changes.
- No data backfill.
- All reads against existing tables.

## Dependencies

All already installed:
- `html2pdf.js` — used by Maintenance page.
- `recharts` — used by Maintenance + Helpdesk pages.

## Out of scope / future work

Same list as in goals, expanded:

- Auto-scheduled / cron-emailed reports.
- In-app email delivery.
- Quarterly / annual variants.
- Year-over-year comparisons (defer until 12+ months of all sources).
- Customizable section toggles.
- Per-site profile pages (different feature).
- Comparison to budget targets.
- Multi-currency formatting.
- Bilingual report (English/Shona).
