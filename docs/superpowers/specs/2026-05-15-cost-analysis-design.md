# Cost Analysis (Invoice ↔ Ticket Relationship) — Design

**Date:** 2026-05-15
**Status:** Design approved, ready for implementation plan
**Context:** Follow-on to the categorization refinement (Project A) and the Helpdesk upload feature. R&M invoices and helpdesk tickets are currently independent data sources sharing only the `description_norm` categorization cache. Management wants to understand cost-per-ticket by site and category to spot outliers, benchmark contractor pricing, and identify operational gaps.

Data exploration confirmed that per-row joining between invoices and tickets is impractical:

- Only **10 of 3,871** unique descriptions overlap between sources.
- **62 of 72** ticketed sites also have invoices — site-level overlap is near-total.
- Per-site ratios vary widely (`WAR-070`: 13 invoices / 51 tickets; `ZIN-074`: 39/40), so tickets are not 1:1 with invoices. Some tickets resolve in-house, under contract, or never produce a discrete invoice.

The natural relationship is therefore **site + time-window aggregation**, not per-row linkage.

## Goals

- Surface `cost_per_ticket = invoice_total / ticket_count` per (site × category) cell within a date window.
- Highlight outliers ("ZIN-074 / Pumps: $312/ticket — 3× the category average").
- Drill-down from any cell into the invoices that contributed to its cost.
- Show both gaps: sites with tickets but no invoices (in-house work) and sites with invoices but no tickets (preventive / scheduled).

## Non-goals

- Per-ticket-to-per-invoice matching. Data won't support it.
- New tables or schema changes. The relationship is a query pattern.
- Time-shift logic (ticket in March, invoice in April). Treat the date window as the comparison period.
- Trend / period-over-period analysis. Out of scope for this feature; covered later in executive reports.
- CSV / PDF export.
- Side-drawer for tickets at cell drill-down. Cells open the InvoiceDrawer (cost lens). Tickets remain accessible via the Helpdesk page.

## Architecture

No new tables. The "relationship" is implicit in one CTE pattern shared by both API endpoints.

### Data flow

```
rm_invoices               rm_helpdesk_tickets
    │                          │
    │  join via description_norm to rm_description_categories
    ▼                          ▼
                ┌──────────────────┐
                │ rm_categories    │
                └────────┬─────────┘
                         │
   ┌─────────────────────┴─────────────────────┐
   │ CTE invoice_agg     │  CTE ticket_agg     │
   │ GROUP BY            │  GROUP BY           │
   │ (site, category,    │  (site, category,   │
   │  period)            │   period)           │
   └──────────┬──────────┴──────────┬──────────┘
              │                     │
              └─── FULL OUTER JOIN──┘
                          │
                          ▼
            site × category × period cells with:
            - invoice_cost
            - invoice_count
            - ticket_count
            - cost_per_ticket = invoice_cost / ticket_count
```

### Why FULL OUTER JOIN

Surfaces both kinds of operational gap:

- **Sites with tickets but no invoices** → likely in-house work, contract-covered, or unbilled.
- **Sites with invoices but no tickets** → likely preventive / scheduled work outside the helpdesk.

An `INNER JOIN` would hide both. Both are management-relevant signals.

### What `cost_per_ticket` means

A statistical approximation: `invoice_total / ticket_count` for matching site/category/period. Useful for:

- Benchmarking sites against each other.
- Spotting expensive-per-ticket categories (Generators may be $800/ticket vs Plumbing at $120).
- Contractor pricing sanity checks.

When `ticket_count = 0`, `cost_per_ticket` is `NULL` (UI shows `—`). Not zero, not infinity.

### What stays unchanged

- All existing tables.
- Categorization pipeline (rules, AI, cache).
- Existing dashboards: Sales, Maintenance, Helpdesk, Rules. Each only gains a `Cost Analysis` tab link.
- Validate and ingest routes.

## Aggregation SQL

The shared CTE (used by both endpoints; each adds its own roll-up over the top):

```sql
WITH invoice_agg AS (
  SELECT i.site_code,
         c.slug                                    AS category_slug,
         c.display_name                            AS category_name,
         DATE_TRUNC('month', i.service_date)::DATE AS period,
         SUM(i.net_cost)::NUMERIC                  AS invoice_cost,
         COUNT(*)::INT                             AS invoice_count
    FROM rm_invoices i
    LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
    LEFT JOIN rm_categories c ON r.category_id = c.id
   WHERE i.cost_center = 'retail'
     -- filters injected here (dateFrom, dateTo, category, siteCode)
   GROUP BY 1, 2, 3, 4
),
ticket_agg AS (
  SELECT t.site_code,
         c.slug                                    AS category_slug,
         c.display_name                            AS category_name,
         DATE_TRUNC('month', t.created_time)::DATE AS period,
         COUNT(*)::INT                             AS ticket_count
    FROM rm_helpdesk_tickets t
    LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
    LEFT JOIN rm_categories c ON r.category_id = c.id
   WHERE 1=1
     -- filters injected here (dateFrom, dateTo, category, siteCode)
   GROUP BY 1, 2, 3, 4
)
SELECT COALESCE(i.site_code,     t.site_code)     AS site_code,
       COALESCE(i.category_slug, t.category_slug) AS category_slug,
       COALESCE(i.category_name, t.category_name) AS category_name,
       COALESCE(i.period,        t.period)        AS period,
       COALESCE(i.invoice_cost, 0)                AS invoice_cost,
       COALESCE(i.invoice_count, 0)               AS invoice_count,
       COALESCE(t.ticket_count, 0)                AS ticket_count,
       CASE
         WHEN COALESCE(t.ticket_count, 0) > 0
         THEN ROUND(COALESCE(i.invoice_cost, 0) / t.ticket_count, 2)
         ELSE NULL
       END                                        AS cost_per_ticket
  FROM invoice_agg i
  FULL OUTER JOIN ticket_agg t
    ON i.site_code     = t.site_code
   AND i.category_slug = t.category_slug
   AND i.period        = t.period;
```

Date filters apply to both `i.service_date` and `t.created_time::DATE` so the comparison stays apples-to-apples within the window.

## API endpoints

Two routes under `app/api/cost-analysis/`. Shared filter set: `dateFrom`, `dateTo`, `category` (slug), `siteCode`.

### `GET /api/cost-analysis/summary`

Top-level rollup for the KPI cards. Wraps the CTE in a single aggregate:

```typescript
{
  data: {
    totalInvoiceCost:        number;
    totalInvoices:           number;
    totalTickets:            number;
    overallCostPerTicket:    number | null;
    sitesWithTickets:        number;
    sitesWithInvoices:       number;
    sitesWithBoth:           number;
    topSpendCategory:        string | null;
    topSpendCategorySlug:    string | null;
    topSpendCategoryCost:    number;
  }
}
```

### `GET /api/cost-analysis/matrix`

Per-cell breakdown. Aggregates by `(site_code, category_slug)`, collapsing across periods within the filter window:

```typescript
{
  data: Array<{
    siteCode:        string;
    siteName:        string;
    categorySlug:    string | null;
    categoryName:    string | null;
    invoiceCost:     number;
    invoiceCount:    number;
    ticketCount:     number;
    costPerTicket:   number | null;
  }>
}
```

Sorted by `invoiceCost DESC NULLS LAST`. Hard limit 2000 rows (well above the 16 categories × 72 sites = 1,152 worst-case).

## UI

### Page: `/dashboard/cost-analysis`

Tab strip: `Sales Dashboard | Data Management | Maintenance | Rules | Helpdesk | [Cost Analysis]` (active span).

Filter bar: date range (default `YYYY-01-01` → today), category dropdown, site search input.

Sections in order:

1. **KPI cards** (`CostKPICards` component) — four cards: Invoice Spend, Tickets, Cost / Ticket, Top Category. Each has a small sub-line with secondary detail.

2. **Site × Category Matrix** (`CostMatrixTable` component) — pivot table. Rows: top 30 sites by total invoice cost. Columns: top 6 categories by total spend + a `rest` column. Each cell shows `$cost_per_ticket` value with subscript `(N inv, M tkt)`. Empty cells show `—`. `[Show all sites]` toggles to the full list.

### Outlier highlighting

Computed client-side per column. For each category column, calculate mean and stddev across visible cells:

- Cells where `(value - mean) / stddev > 1.5` get amber border + `⚠` glyph.
- Cells where ratio > 2.5 get red border + `⚠⚠` glyph.

Hover reveals "$312/ticket — 2.1σ above category mean". No backend involvement; pure render-time math.

### Drill-down

Click any non-empty cell → opens the existing `InvoiceDrawer` with filters:
- `siteCode` = clicked row's site
- `category` = clicked column's category slug
- `dateFrom` / `dateTo` = current page filters

Reclassifications through the drawer propagate via the existing `/api/maintenance/reclassify` endpoint. The "Make this a rule?" link in the drawer still works and routes to the Rules page.

### Loading / empty / error states

- **Loading**: spinner with "Loading cost analysis…" while both endpoints fetch in parallel.
- **No data in window**: "No invoices or tickets match the selected filters. Adjust the date range or category." with a Data Management link.
- **No tickets but has invoices**: KPI cards still render (cost_per_ticket = `—`), matrix shows invoice columns only.
- **Server error on either endpoint**: card with "Cost analysis is temporarily unavailable" + retry button.

## File map

**Create:**
- `app/api/cost-analysis/summary/route.ts`
- `app/api/cost-analysis/matrix/route.ts`
- `app/dashboard/cost-analysis/page.tsx`
- `components/cost-analysis/CostKPICards.tsx`
- `components/cost-analysis/CostMatrixTable.tsx`

**Modify (single-line tab additions):**
- `app/dashboard/page.tsx` (Sales)
- `app/dashboard/maintenance/page.tsx`
- `app/dashboard/maintenance/rules/page.tsx`
- `app/dashboard/helpdesk/page.tsx`

## Edge cases and decisions

1. **Invoices with NULL category.** Descriptions not yet categorized appear in the matrix under a `null` column. UI shows them in the "rest" column with `—` for cost_per_ticket. This makes data-cleanup gaps visible without crashing the report.

2. **Cells with invoices but zero tickets.** `cost_per_ticket = NULL`. Cell shows `—`. Still displays invoice cost as a row total so the spend is visible. This is the "preventive / scheduled work" gap.

3. **Cells with tickets but zero invoices.** `invoice_cost = 0`, `ticket_count > 0`, `cost_per_ticket = $0/ticket`. UI shows `$0` and an italic "in-house" hint on hover. This is the "unbilled / contract-covered work" gap.

4. **Filtering by category** narrows BOTH source tables. So `?category=pumps_dispensers&siteCode=ZIN-074` returns the Pumps invoices AND Pumps tickets at ZIN within the date window — apples-to-apples.

5. **Date range trimming.** Tickets only exist from Nov 2025. Invoices go back to Jan 2025. With `dateFrom=2025-01-01`, the invoice side gets 10 months of data but tickets get only 2. Cost-per-ticket would be inflated. UI doesn't auto-adjust — user controls the window. A future v2 could add a "trim to common period" toggle.

6. **Outlier detection is descriptive, not normative.** A "high" cell may be legitimate (one expensive emergency invoice + low ticket count). The UI flags it for review, not action.

## Migration / rollout

- No database changes.
- No data backfill.
- The feature reads existing categorized data; the more accurate categorization (from Project A) directly improves report quality.

## Out of scope / future work

- Period-over-period comparison ("Pumps cost/ticket up 18% vs prior 90 days").
- Site profile pages (one page per site with full ticket + invoice history).
- CSV / PDF export.
- Trend chart of cost/ticket over time.
- TicketDrawer drill-down from cell clicks.
- Trim-to-common-period filter toggle.
