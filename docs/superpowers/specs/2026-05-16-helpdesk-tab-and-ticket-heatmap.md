# Helpdesk Tab + Tickets-by-Category Heatmap — Design

**Date:** 2026-05-16
**Status:** Approved, ready for implementation plan
**Context:** The R&M Command Center page (`/dashboard/rm`) currently houses both Cost and Efficiency lenses. This spec splits Efficiency out to its own `/dashboard/helpdesk` tab, adds a new Tickets-by-Category heatmap parallel to the existing cost heatmap, and extends the PDF report from 4 to 5 pages.

## Goals

- New **Helpdesk** tab at `/dashboard/helpdesk` replacing the legacy un-linked page at that URL. Hosts the Efficiency lens (KPI strip + Aging + Recurring) plus a new Tickets-by-Category heatmap.
- `/dashboard/rm` becomes **Cost-only**. Header subtitle updates to reflect the narrower scope.
- New **Tickets-by-Category heatmap** mirroring the cost heatmap structure: rows = top 20 sites, columns = same 17 categories. Cell value = ticket count by default with toggle to MTTR or SLA hit-rate. Quintile coloring per column. Inline per-site notes (shared with cost-side via `rm_site_notes`).
- **PDF expands to 5 pages**: pages 1-3 unchanged (Cost Performance + 2 Cost Heatmap slices), page 4 stays Helpdesk Efficiency, page 5 = new Tickets-by-Category heatmap. Same Generate PDF button on both `/rm` and `/helpdesk` produces this combined report.
- **Categorization flow is unchanged**: cell click → `TicketDrawer` → reclassify → shared `rm_description_categories` cache updates → both heatmaps re-render.

## Non-goals (deferred to v2)

- **Unified per-site review surface** (a page showing one site's invoices + tickets side-by-side with category mapping). Inline drawer covers the immediate need; the unified view can come later if the inline UX proves limiting.
- New category slugs. The 17 in `rm_categories` are the universe.
- New AI categorization engine for tickets. The existing batch cron categorises tickets via the same shared cache.
- Per-contractor breakdown matrix. Stays a future addition.
- Two separate PDFs. One combined 5-page report serves both audiences.

## Architecture

### Tab structure

| URL | Current | After |
|---|---|---|
| `/dashboard/rm` | R&M Command Center (Cost + Efficiency) | R&M Cost (Cost only) |
| `/dashboard/helpdesk` | Legacy page (un-linked from nav) | Helpdesk (Efficiency + new Ticket heatmap) |
| Nav strip | `Sales · Data · R&M Command Center · Rules · Cost Analysis` | `Sales · Data · R&M Cost · Helpdesk · Rules · Cost Analysis` |

The legacy `/dashboard/helpdesk` content (TopRecurringPanel, SitesPanel, ContractorsPanel, etc.) is functionally subsumed by the Efficiency lens components already extracted (`EfficiencyKpiStrip`, `TicketAgingChart`, `RecurringIssuesPanel`). Old direct-URL bookmarks now land on the redesigned page.

### Data layer

Extend `GET /api/rm/cost-heatmap` with a `dimension` query param:

```
?dimension=cost     (default — today's behaviour)
?dimension=tickets  (new — sorts and tops-N by ticket count)
```

Implementation:
- The endpoint already runs one CTE that JOINs invoices + tickets per (site, category). Every cell already carries `cost`, `ticketCount`, `invoiceCount`, `volume`, `perLitre`, `zScore`.
- `dimension=cost` keeps current behaviour (orderBy `i.cost DESC`, top 20 sites by total invoice cost).
- `dimension=tickets` changes the ordering: top 20 sites by `SUM(ticket_count)` across categories. Per-cell payload is unchanged — the renderer picks which field to display.

No new SQL. No new schema. Just an ORDER BY switch + a top-N selection variant.

### `buildReportPayload` extension

The payload shape grows one field:

```ts
siteHeatmap: {
  byCost:    SiteHeatmapShape,   // today's `siteHeatmap` renamed
  byTickets: SiteHeatmapShape,   // new
}
```

Each variant has its own top-20 site list, its own `rolledUp` aggregate, and its own column totals. The categories axis is the same in both (sourced from one query). Notes are looked up once and joined into both shapes — a site appearing in both gets the same note attached.

`buildReportPayload` fires both endpoint variants in parallel inside the existing `Promise.all`.

## Dashboard layout

### `/dashboard/rm` (Cost-only)

- Header subtitle: `cost performance · spend × site × category`
- Filter bar unchanged
- Cost lens divider (navy)
- KPI strip (4 cards: YTD, MTD, $/L, Top Category)
- Pareto + Trend (side-by-side)
- Cost × Category heatmap (full width, with notes column + sort toggle)
- Generate R&M Report button in header chrome

The Efficiency lens divider, KPI strip, Aging chart, and Recurring panel are removed from this page. They live exclusively on `/dashboard/helpdesk`.

### `/dashboard/helpdesk` (new)

```
[Filter bar]

[EFFICIENCY LENS · OPERATIONAL] (orange divider)
[Open Tickets] [MTTR] [SLA Hit Rate] [Repeats]            (existing KPI strip)
[Aging chart]   [Recurring panel]                          (existing 2-up row)

[TICKETS · CATEGORY BREAKDOWN] (orange divider)
[Sort: Top by tickets ▾ | Match cost sites] · Metric: [Count][MTTR][SLA]
[Site × Category ticket heatmap, full width]

[Generate R&M Report button in header chrome]
```

The "Match cost sites" toggle locks the visible 20 sites to whatever the cost heatmap is using — for direct comparison between cost outliers and ticket outliers.

### New component: `TicketHeatmap.tsx`

Sibling to `CostHeatmap.tsx`, not generalised:
- Metric toggle: `Count` (default) / `MTTR (days)` / `SLA hit %`
- Sort dropdown: top-by-tickets (default) plus per-category options
- "Match cost sites" toggle (overrides top-20 selection to match the cost-side)
- Show-all toggle (same as cost heatmap, expands beyond 20)
- Per-site notes column — same `rm_site_notes` table, same `(site_code, period_from, period_to)` key; one note attached to a site shows on both cost and ticket heatmaps
- Click cell → `TicketDrawer` opens with `{siteCode, category, dateFrom, dateTo}` filters; reclassification flows through the shared cache

The 70% of shared logic with `CostHeatmap` (quintile coloring, note-editing UI, sort behaviour) is duplicated rather than abstracted. If the two diverge later — they likely will, with ticket-side adding things like "Urgent only" or "Open vs Resolved" filters — separate files stay maintainable.

## PDF layout

### 5-page report

| Page | Title | Source | Notes |
|---|---|---|---|
| 1 | Cost Performance | unchanged | |
| 2 | Top Sites · Cost × Category (1) | unchanged | sites 1–10 |
| 3 | Top Sites · Cost × Category (2) | unchanged | sites 11–20, totals row + legend |
| 4 | Operational Efficiency · Helpdesk | unchanged | KPI strip + Aging + Recurring + Callouts |
| 5 | **Tickets · Cost × Category** | NEW | top 20 by tickets, count metric, single page |

### New component: `TicketHeatmapPage.tsx`

Re-uses the same CSS as the cost-side heatmap (`.hm-*` classes). Single page — ticket counts are 1–2 digit numbers vs `$XX.XK` so the table fits 20 rows on one landscape Letter page at 8pt vertical padding without splitting.

**PDF-side defaults** (no toggles in the static report):
- Metric: ticket count
- Sort: top 20 by tickets (the "Match cost sites" toggle is dashboard-only)
- Notes column carries whatever per-site note the analyst has typed (shared with cost pages)
- TOP 20 TOTAL row + scale legend on the same page

Generate PDF button lives in the header chrome on both `/rm` and `/helpdesk`. Same endpoint (`/api/reports/rm/generate`), same output. Filename unchanged: `Redan-RM-Report-{dateFrom}_to_{dateTo}.pdf`.

## Categorization review flow

The mechanism is unchanged from cost-side. Categories are fixed (17 slugs in `rm_categories`); tickets share the `rm_description_categories` cache; the AI batch cron applies the same rules to ticket subjects as to invoice descriptions.

```
TicketHeatmap cell click
   ↓
TicketDrawer (existing) opens with filters:
   { siteCode, category, dateFrom, dateTo }
   ↓
Drawer lists matching tickets
   ↓
User picks a ticket → reclassifies via /api/maintenance/reclassify (existing)
   ↓
Cache row in rm_description_categories updated
   ↓
Both heatmaps re-render on next fetch
```

A reclassification fix on the ticket side propagates to the cost side and vice versa — the shared cache is the single source of truth.

## Edge cases

1. **A site has invoices but no tickets** in the selected period. It appears in the cost heatmap but not the ticket heatmap (because ticket-dimension top-20 ranks by ticket count). The "Match cost sites" toggle reveals it as a row with all em-dashes in the ticket heatmap.
2. **A site has tickets but no invoices.** Mirror of above — visible in the ticket heatmap, absent from the cost heatmap.
3. **Categories with no tickets at all** (e.g. Capex in a quiet month). Column still renders; cells all em-dash; quintile classifier returns null (no color).
4. **Notes mismatch.** A user types a note on the cost-side heatmap describing the SPEND driver, then visits the helpdesk tab and sees the same note attached to the ticket-side. That's intentional — the note is about the site in the period, not lens-specific. If a user wants lens-specific notes that's a v2.
5. **Filter mismatch between tabs.** The two pages share the same `RMFilterBar` component but maintain independent state. Date filters chosen on /rm don't automatically apply on /helpdesk and vice versa. The PDF always uses whichever tab's filters launched the Generate request.

## File map

**Create:**
- `components/rm/TicketHeatmap.tsx` — dashboard component
- `components/print/TicketHeatmapPage.tsx` — PDF page-5 component
- `app/dashboard/helpdesk/page.tsx` — new page (replaces existing file)

**Modify:**
- `app/api/rm/cost-heatmap/route.ts` — accept `dimension=cost|tickets` query param, change ORDER BY accordingly
- `lib/buildReportPayload.ts` — fetch both dimension variants, return `siteHeatmap.byCost` + `siteHeatmap.byTickets`
- `app/reports/rm/print/page.tsx` — render 5 pages, add page 5
- `app/reports/rm/preview/page.tsx` — same 5-page render
- `app/dashboard/rm/page.tsx` — remove Efficiency lens components; rename header
- `app/dashboard/page.tsx` and other nav strips — rename "R&M Command Center" tab to "R&M Cost", add "Helpdesk" tab link
- All sister-page nav strips (Rules, Cost Analysis, Maintenance, Monthly Report) — update tab labels

**Delete:** none — the legacy helpdesk page file is overwritten in place.

## Migration / rollout

- No DB changes. No data backfill.
- `siteHeatmap.byCost` matches the previous `siteHeatmap` shape; if anything else read that field it stays working.
- The Generate PDF endpoint is the same URL; the only contract change is that the output is now 5 pages.
- Existing per-site notes carry over without touching them — same table, same rows.

## Out of scope (v1)

- Unified per-site review surface (finance + helpdesk side-by-side, with AI assignments per site). Possible v2.
- Lens-specific notes (cost-only note vs helpdesk-only note for the same site/period). v2.
- Contractor × category breakdown matrix. v2.
- "Open tickets only" filter in the ticket heatmap. v2.
- "Urgent only" filter in the ticket heatmap. v2.
- Separate Cost / Helpdesk PDFs. Not planned — the combined report is the deliverable.
- Renaming the database table `rm_helpdesk_tickets`. Stays.

## Dependencies

All already installed. No new packages. No new env vars.
