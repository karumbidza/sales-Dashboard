# R&M Report + Dashboard Cleanup — Design

**Date:** 2026-05-12
**Status:** Approved for planning
**Sequencing:** Phase 1 (Cleanup) → Phase 2 (R&M Report)

## Goal

Two related changes to the Redan Sales Dashboard:

1. **Cleanup.** Remove orphaned code and features no longer in use, simplifying the dashboard before adding new work.
2. **New R&M report.** Add a "Repairs & Maintenance" report on its own page (`/dashboard/maintenance`) with its own Excel ingest, KPIs, charts, a site-ranking table, filters, and PDF export. Headline metric: **R&M cost per litre** (R&M cost ÷ sales volume).

---

## Phase 1 — Cleanup

### 1.1 Files to delete

Confirmed orphaned (zero active references):

- `components/charts/TerritoryChart.tsx`
- `components/charts/TerritoryAnalysisChart.tsx`
- `components/ui/SiteActivityPanel.tsx`
- `app/api/site-activity/route.ts`

Removed as part of feature removals (see 1.2):

- `components/ui/DatabaseViewerTab.tsx`
- `app/api/db-viewer/` (entire folder)
- `app/api/db-stats/route.ts`
- `components/ui/ReconciliationPanel.tsx`
- `app/api/reconciliation/route.ts`
- `app/api/comments/route.ts`

### 1.2 Features to remove

| Feature | Why removed |
|---------|-------------|
| Database Viewer tab | No longer used |
| Reconciliation tab (incl. amber "!" badge) | No longer used |
| Budget Matrix editor (inside Data Management) | No longer used |
| Report comments thread (inside Report Generator) | No longer used |

### 1.3 Structural changes to `app/dashboard/page.tsx`

- Remove stale imports: `UploadPanel`, `UploadAuditTrail` (rendered only inside `DataManagementTab`).
- Remove `'reconcile'`, `'dbviewer'`, `'reports'` from `Tab` type, `ALL_TABS`, `TAB_LABELS`, `TAB_ICONS`.
- Remove the corresponding `{activeTab === '…' && …}` render blocks.
- Remove the amber "!" badge code from the tab strip.
- Add a "Generate Report" button to the header (next to Refresh + Sign out).
- Clicking "Generate Report" toggles inline rendering of `<ReportGenerator filters={filters} />` at the **top of the Overview tab**, above `KPICards`. Toggle state lives in `page.tsx` (`reportOpen: boolean`).

### 1.4 Targeted edits

- `components/ui/DataManagementTab.tsx`: remove the Budget Matrix editor section and its two `/api/budget-matrix` calls (lines ~229 and ~473 today). Keep the rest of the tab (upload, audit trail).
- `components/ui/ReportGenerator.tsx`: remove the comments thread UI and its three `/api/comments` calls (lines ~43, ~132, ~148 today). Keep the rest of the component.

### 1.5 Kept (explicit non-removals)

- **Site Detail Modal** (`components/ui/SiteDetailModal.tsx`, `/api/site-details`) — opened by clicking a row in `TopSitesTable` on the Overview tab.
- **Unmatched Rows panel** (`components/ui/UnmatchedRowsPanel.tsx`, `/api/unmatched-rows`) — used on the Sites tab; will also receive R&M unmatched rows in Phase 2.

### 1.6 Pre-removal verification

Before each route file is deleted, grep the `app/` and `components/` trees one more time for the route path (e.g. `/api/reconciliation`) to confirm nothing still calls it. Reason: a route added as part of an in-flight change after this audit would not appear in the audit list.

---

## Phase 2 — R&M Report

### 2.1 Database

New table:

```sql
CREATE TABLE maintenance_costs (
  id              SERIAL PRIMARY KEY,
  site_code       TEXT NOT NULL,
  service_date    DATE NOT NULL,
  cost            NUMERIC(12,2) NOT NULL,
  category        TEXT NOT NULL,
  upload_batch_id INTEGER,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON maintenance_costs (site_code, service_date);
CREATE INDEX ON maintenance_costs (service_date);
CREATE INDEX ON maintenance_costs (category);
```

Migration lives in `sql/` alongside existing migrations. Additive only — does not modify any existing table.

`upload_batch_id` ties an R&M row back to the corresponding entry in `upload_log` so the existing audit trail also covers R&M uploads.

### 2.2 Ingest flow

`UploadPanel` gains a **"Data type"** dropdown with two options: `Sales` (current default) and `R&M`.

- `/api/validate` and `/api/ingest` accept a new `dataType` query/body parameter: `"sales"` | `"maintenance"`.
- When `dataType === "maintenance"`:
  - Expected Excel columns: `Site`, `Date`, `Cost`, `Category`.
  - Site names resolve via the existing site-name → site-code mapping (no new mapping table).
  - Rows write to `maintenance_costs`.
  - The same preflight, validation, ingest-summary, and upload-log mechanisms apply.
- When `dataType === "sales"` (default) the current behavior is unchanged.

### 2.3 R&M page

Route: `app/dashboard/maintenance/page.tsx`

Navigation: the existing dashboard tab strip in `app/dashboard/page.tsx` is state-based (tabs switch `activeTab`). For "Maintenance" we add a new entry that is a `next/link` to `/dashboard/maintenance` rather than a state toggle, so it lives on a separate route per the design. The new page renders its own header + tab strip so the user can navigate back to Overview, Sites, or Data Management.

Page contents, top to bottom:

1. **Header bar** — matches Overview (navy background, page title).
2. **Filter bar** — reuses `DashboardFilters` extended with a **Category** dropdown. Active filters: year, territory, category, date range.
3. **KPI cards** (new component `components/MaintenanceKPICards.tsx`, modeled on `KPICards.tsx`):
   - Total R&M Cost (filtered window)
   - Cost per Litre (filtered window, see 2.4)
   - Top Category by spend
   - Sites with R&M activity (count)
4. **R&M Cost Trend chart** — line chart, monthly by default with a daily toggle. Styled like `SalesTrendChart`.
5. **Cost by Category breakdown** — horizontal bar chart, descending by total cost. New component `components/charts/CategoryBreakdownChart.tsx`.
6. **Site Ranking Table** (new component `components/tables/MaintenanceSiteTable.tsx`, modeled on `TopSitesTable`):
   - Columns: Site, Territory, Volume, R&M Cost, Cost/Litre, Top Category
   - Sortable on every column; default sort: Cost/Litre desc
   - Paginated
7. **"Export PDF" button** — reuses `html2pdf.js` and the page-break patterns from `app/api/report/route.ts` and `ReportGenerator.tsx`. Output: landscape A4, page 1 = KPIs + table preview, page 2 = both charts (forced page break, matching the recent fixes in `cbdaaa3`, `863432d`, `228617f`).

### 2.4 Cost-per-litre computation

- Computed at query time. No materialized view.
- Headline KPI formula: `SUM(maintenance_costs.cost) / SUM(daily_sales.volume_litres)` across the filtered scope. Computed as a single ratio, **not** as an average of per-site ratios — small sites would otherwise distort the headline.
- Table column: per-site `SUM(cost) / SUM(volume)` over the filter window, joined by `site_code` and overlapping on `service_date` vs `sale_date` aggregated to monthly buckets.
- Sites with R&M cost but zero sales volume in the filter window display `"—"` in the table and are excluded from category-level cost/litre rollups.

### 2.5 New API routes

Under `/api/maintenance/*` namespace:

- `GET /api/maintenance/kpis` — returns the 4 KPI values for the filtered window.
- `GET /api/maintenance/trend?granularity=daily|monthly` — time-series, same shape as `/api/sales-trend`.
- `GET /api/maintenance/categories` — `[{ category, total_cost, pct_of_total }]` for the breakdown chart.
- `GET /api/maintenance/sites` — per-site ranking with `cost`, `volume`, `cost_per_litre`, `top_category`. Supports `limit`, `sortBy`, `sortDir`.
- `GET /api/maintenance/categories-list` — distinct category names for the filter dropdown.

All routes accept the same filter params as the existing sales routes (`dateFrom`, `dateTo`, `territory`, `siteCode`, `category` where applicable).

---

## Error handling & edge cases

### Upload validation (R&M Excel)

- Missing required header (`Site`, `Date`, `Cost`, `Category`) → upload rejected with `"Expected columns: Site, Date, Cost, Category"` (same UX as current sales validation).
- Site names that don't match any known site → routed to the existing **Unmatched Rows** panel. The panel must distinguish sales vs maintenance unmatched rows (add a `source` column to whatever underlying mechanism it uses).
- Invalid date or non-numeric `Cost` → row skipped, listed in the upload summary with row number.
- Empty `Category` → defaults to `"Uncategorized"`.
- Duplicate uploads (same site + date + cost + category): allowed; we don't de-duplicate, matching current sales-ingest behavior.

### Cost-per-litre edge cases

- Sites with R&M cost but zero sales volume → display `"—"` in tables, excluded from category-level cost/litre rollups.
- Empty filtered window (no R&M rows match the filters) → KPI cards show `—`, charts show empty-state cards, table shows empty-state row.
- Headline "Cost per Litre" = `SUM(cost) / SUM(volume)`, not an average of ratios.

### Filter behavior

- **Year filter:** if no R&M data exists for the selected year, the page renders one empty-state card: *"No R&M data uploaded for {year}. Upload an Excel file to get started."* with a link to Data Management.
- **Territory filter:** uses the existing site → territory mapping. No new mapping required.
- **Category filter:** when active, the "Top Category" KPI continues to show the overall top category (not the filtered one), so it isn't a circular display of the active filter.

### Rollout safety

- Phase 1 cleanup PR removes ~3,000 lines but no data. Reversible by revert.
- Phase 2 DB migration is additive (new table only). Existing sales tables and queries are untouched.

---

## Testing

- **Phase 1:**
  - After cleanup, confirm `npm run build` succeeds and all remaining tabs (Overview, Sites, Data Management, Maintenance once added) load without console errors.
  - Verify the "Generate Report" button renders the report inline at the top of Overview and that the PDF export still produces the existing report layout (last touched in `cbdaaa3`).
  - Grep verification: no remaining references to deleted route paths or component names.

- **Phase 2:**
  - R&M ingest: upload a small known R&M Excel; confirm rows land in `maintenance_costs` with correct site/date/cost/category and a valid `upload_batch_id`.
  - KPI math: hand-compute total cost and cost-per-litre for a small filtered window and compare to the page.
  - Edge cases: site with R&M cost but no sales in window → `"—"` in cost/litre column; empty filtered window → empty-state cards.
  - PDF export: confirm both charts land on page 2 with the forced page break, matching the existing report.
  - Unmatched Rows: upload an R&M sheet with one unknown site name and confirm the row surfaces in the Unmatched Rows panel labeled as a maintenance source.

---

## Out of scope

- Site-level drill-down modal for R&M (we could add one later mirroring `SiteDetailModal`, but not in this scope).
- Multi-currency support (everything assumed in the existing single currency).
- Predictive analytics / anomaly detection on R&M spend.
- Combined Sales + R&M dashboard view (R&M is intentionally a standalone page).
