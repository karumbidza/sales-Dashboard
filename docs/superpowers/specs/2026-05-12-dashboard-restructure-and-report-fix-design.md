# Dashboard Restructure + Report Top-20 Fix — Design

**Date:** 2026-05-12
**Status:** Approved for planning

## Goal

Three related changes following the Phase 1 + Phase 2 cleanup/R&M work:

1. **Restructure dashboard tabs.** Sites tab is no longer needed. The Unmatched Submissions panel and the Full Site Breakdown are both moved.
2. **Promote the full site list to the main page.** On the renamed "Sales Dashboard" tab, replace "Top 20 Sites by Budget" with a paginated full site list, a sort-by dropdown, and a site-name search.
3. **Fix a long-standing report bug.** The PDF's "Top 20 Sites — Sorted by vs stretch" page silently fetches the top 20 by *budget*, then re-sorts that subset by vs-stretch. Sites with high vs-stretch% but small budgets never appear. Fix the fetch to use vs-stretch ordering at the source.

---

## Section 1 — UI restructure

**File:** `app/dashboard/page.tsx` (plus `components/ui/DataManagementTab.tsx` for the panel move).

### Tabs

- Tabs reduce from 3 → 2: **Sales Dashboard** (renamed from "Overview"), **Data Management**.
- The Maintenance link in the tab strip stays unchanged.
- The internal `activeTab` key for the dashboard tab stays `'overview'` so all existing `activeTab === 'overview'` blocks continue to work without churn.
- `TAB_LABELS.overview` becomes `'Sales Dashboard'`.
- `'sites'` is removed from `Tab` union, `ALL_TABS`, `TAB_LABELS`, and `TAB_ICONS`. The Sites render block is deleted.

### Unmatched Submissions panel

- The `<UnmatchedRowsPanel />` component moves from the Sites tab render block into `components/ui/DataManagementTab.tsx`, rendered at the top of that tab (above the existing Upload + Audit Trail section).
- The component itself is unchanged.

### Sales Dashboard "All Sites" section

- The existing `<Section title="Top 20 Sites by Budget">` block on the Overview tab is replaced with a new `<Section title="All Sites">` block.
- The section contains:
  1. A controls row with a **search box** (left) and a **Sort by** dropdown (right).
  2. The existing `<SiteBreakdownTable type="sites" paginate>` component, which already paginates 20 per page.
- The data feeding the table is the same `topSites` state already fetched by the page (`/api/top-sites?limit=500&sortBy=budget`). The server-side sort key is now irrelevant because the client re-sorts.

---

## Section 2 — Sort + search controls

### Sort dropdown options

Client-side sort applied to the already-fetched `topSites` array. No additional API calls.

| Label | Sort key | Direction | NULLs |
|-------|----------|-----------|-------|
| Volume | `volume` | desc | last |
| Vs Budget % | `vsBudgetPct` | desc | last |
| Vs Stretch % | `vsStretchPct` | desc | last |
| Revenue | `revenue` | desc | last |
| Avg Daily | `avgDaily` | desc | last |
| Net Margin / L | `netMarginCpl` | desc | last |

Default selection on first render: Volume.

### Search box

- Case-insensitive substring match on `siteName`. (Optional secondary: `territoryName` — kept simple for now, name-only.)
- Resets pagination to page 1 whenever the search string or sort key changes.
- No debouncing required — at ≤500 rows the filter is instant.

### State location

Search string, sort key, and current page are local to the new `<AllSitesPanel>` wrapper (or kept inline in `page.tsx`). They do NOT live in the existing global `Filters` interface. They reset on a page reload.

### Component boundary

A small new component `components/tables/AllSitesPanel.tsx` wraps the controls + table:

```ts
interface Props {
  data: any[]; // shape from /api/top-sites
}

export default function AllSitesPanel({ data }: Props) {
  // local state: search, sortBy
  // derives: filtered + sorted array
  // renders: <controls row /> <SiteBreakdownTable data={derived} type="sites" paginate />
}
```

The existing `SiteBreakdownTable` is unchanged — it already paginates 20/page and resets its internal page counter on `data` change.

---

## Section 3 — Report fix (top-20 vs stretch)

### Root cause

`app/api/report/route.ts` line 1375:

```ts
callHandler('topSites', topSitesHandler, new URLSearchParams(params.toString() + '&limit=20&sortBy=budget'))
```

This pulls the 20 highest-budget sites. The display loop on line 1147 re-sorts that subset by `vsStretchPct`, which can shuffle the order but cannot pull in sites that weren't in the original 20.

### Fix — two small changes

1. **`app/api/top-sites/route.ts` line 19** — add `'vs_stretch'` to `VALID_SORTS`:

   ```ts
   const VALID_SORTS = ['volume', 'revenue', 'vs_budget', 'vs_stretch', 'budget'] as const;
   ```

2. **`app/api/top-sites/route.ts` around line 147** — add the matching `ORDER BY` case in the existing `ORDER BY ${...}` ternary chain:

   ```ts
   ORDER BY ${sortBy === 'vs_budget'  ? 'vs_budget_pct DESC NULLS LAST'
            : sortBy === 'vs_stretch' ? 'vs_stretch_pct DESC NULLS LAST'
            : sortBy === 'revenue'    ? 'revenue DESC'
            : sortBy === 'budget'     ? 'budget_volume DESC NULLS LAST'
            : 'volume DESC'}
   ```

3. **`app/api/report/route.ts` line 1375** — change `sortBy=budget` to `sortBy=vs_stretch`. The display-side re-sort on line 1147 is kept for explicit intent (and is now a no-op).

### What's NOT affected

- The Full Site Breakdown section of the report (line 1457+) runs its own SQL ordered by `volume DESC`. No change there — that already matches the user's intent.
- The Sales Dashboard's All Sites table is fed from `/api/top-sites?limit=500&sortBy=budget`. The `sortBy` parameter there is irrelevant because the client re-sorts (Section 2). No regression risk from the `VALID_SORTS` change.
- Other callers of `/api/top-sites`: there are none after the cleanup phase except `app/dashboard/page.tsx` (handles any of the valid sorts) and `app/api/report/route.ts` (this very fix).

---

## Error handling & edge cases

- **Empty search result** — table renders the existing "No data" empty state. Pagination collapses to a single page.
- **Sort by a column where every site has NULL** (e.g., `netMarginCpl` if no margin data was uploaded for the period) — NULLs always sort last, so the table shows real values first, then NULLs. No crash.
- **Search box is unfiltered URL state** — refreshing the page resets it. Acceptable for an interactive tool, no need to persist to URL.
- **Report runs with no sites that have any sales volume** — `top-sites` returns `[]`, the report's top-20 page renders an empty `<tbody>`. Pre-existing behavior, unchanged.

---

## Out of scope

- Server-side sort/pagination for the All Sites table. With ≤500 rows the current client-side approach is fast and simpler.
- URL-state persistence for search and sort. Not requested.
- Adding more sort columns beyond the six listed. The current set covers every primary KPI surfaced in the table.
- Restructuring the existing global Filters bar.

---

## Testing

- **Build:** `npm run build` succeeds after all three changes.
- **UI smoke test:** `npm run dev`, log in.
  - Confirm only two tabs (Sales Dashboard, Data Management) plus the Maintenance link.
  - Sales Dashboard: All Sites section paginates 20/page. Changing Sort by re-orders rows; changing search filters rows and resets to page 1.
  - Data Management: Unmatched Submissions panel appears at the top.
- **Report regression test:** Generate a PDF report.
  - The "Top 20 Sites" page now shows sites in vs-stretch desc order, including sites with small budgets but high vs-stretch% that were previously absent.
  - The "Full Site Breakdown" pages still order by volume desc (unchanged).
- **API smoke test:** `curl '/api/top-sites?limit=5&sortBy=vs_stretch'` returns data ordered by `vs_stretch_pct DESC NULLS LAST`.
