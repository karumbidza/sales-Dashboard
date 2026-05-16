# R&M PDF Report v2 (Puppeteer) — Adapted Design

**Date:** 2026-05-15
**Status:** Approved, ready for implementation
**Reference:** The canonical engineering spec is in chat (May 15, 2026). This doc captures only the adaptations to the live codebase.

## Goals

Replace the client-side `html2pdf.js` flow on `/dashboard/rm` with a print-first server renderer that produces a 3-page (v1) executive PDF report:

1. **Page 1 — Cost Performance**: KPI strip + Pareto + Trend (with budget line) + Top Movers callout
2. **Page 2 — Top 20 Sites × Category Heatmap**: quintile-coloured cells per category column, inline per-site notes, no anomaly symbols
3. **Page 3 — Operational Efficiency**: KPI strip + Aging + Recurring + 3 callouts (Worst SLA / Slowest Resolution / Highest Volume)

Pages 4–7 (Full Site Appendix, Category Deep Dive, Notes Index, Methodology) deferred to v2 follow-up.

## Architecture

```
User clicks Generate Report on /dashboard/rm
   ↓
POST /api/reports/rm/generate { dateFrom, dateTo, territory, siteCode }
   ↓
buildReportPayload(filters) — server function — returns full JSON
   ↓
Puppeteer launches @sparticuz/chromium-min, navigates to
   /reports/rm/print?token=... (filters in token-signed query)
   ↓
Print route hydrates the 3 pages from the same payload (computed
   again server-side; no Redis layer for v1)
   ↓
Puppeteer waits for [data-report-ready="true"] then prints to PDF
   ↓
Stream PDF buffer back as application/pdf with attachment header
```

## Adaptations vs the engineering spec

| Spec said | We're doing | Why |
|---|---|---|
| Redis/in-memory cache for ReportPayload by id | Pass filters directly to `/reports/rm/print` as token-signed query params | Skip Redis dependency for v1; payload is cheap to recompute |
| Notes from `rm_site_notes` table the dashboard already writes to | New `rm_site_notes` table; dashboard currently writes localStorage. Add one-shot migration on dashboard load (POST any local keys missing from the DB) | Brings legacy notes forward without user action |
| 7 pages | 3 pages (1, 2, 3) for v1 | User-confirmed phased rollout |
| Quintile coloring with c1–c5 background classes | Same algorithm, same colors | Faithful |
| Anomaly markers (⚠, ⚠⚠) | Removed | Spec §7 |
| `puppeteer-core` + `@sparticuz/chromium-min` v131 | Same | Vercel Pro confirmed |

## Notes migration

Existing per-site notes live in `localStorage` keys: `rm-site-note-{dateFrom}-{dateTo}-{siteCode}` → string.

On `/dashboard/rm` mount, after fetching notes from `GET /api/rm/notes?dateFrom=…&dateTo=…`, scan localStorage for the same window. For each local key whose value isn't already in the DB result, POST it to `/api/rm/notes`. Then the dashboard reads/writes exclusively against the API.

We **don't** delete localStorage on migration — leave it as a fallback for one release cycle. A future cleanup can remove it.

## `rm_site_notes` schema

```sql
CREATE TABLE IF NOT EXISTS rm_site_notes (
  id            BIGSERIAL PRIMARY KEY,
  site_code     VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  period_from   DATE NOT NULL,
  period_to     DATE NOT NULL,
  note_text     TEXT NOT NULL,
  author        VARCHAR(120),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_code, period_from, period_to)
);

CREATE INDEX idx_rm_site_notes_period
  ON rm_site_notes(period_from, period_to);
```

The spec used `period_month` (single date). We use `period_from`/`period_to` because the dashboard's date filter is a range, not a calendar month. Multi-month reports get one note per (site, range).

## API endpoints

### `GET /api/rm/notes?dateFrom=...&dateTo=...`
Returns:
```ts
{ data: Array<{ siteCode: string; note: string }> }
```

### `POST /api/rm/notes`
Body:
```ts
{ siteCode: string; dateFrom: string; dateTo: string; note: string }
```
Upserts. Empty `note` deletes the row.

### `GET /api/rm/top-movers?dateFrom=...&dateTo=...`
Returns top 3 rising + top 3 falling sites by `(current_period_cost - prior_period_cost)`. Prior period = same length immediately before current.

```ts
{
  data: {
    rising:  Array<{ siteCode: string; siteName: string; currentCost: number; priorCost: number; delta: number }>,
    falling: Array<{ siteCode: string; siteName: string; currentCost: number; priorCost: number; delta: number }>,
  }
}
```

### `POST /api/reports/rm/generate`
Body:
```ts
{ dateFrom: string; dateTo: string; territory?: string; siteCode?: string }
```
Returns: PDF stream (`application/pdf`, `Content-Disposition: attachment`).

### `GET /reports/rm/print` (internal)
Server component. Reads filters from query (signed by short-lived HMAC). Renders 3 pages. Sets `<body data-report-ready="true">` after charts mount.

Security: a 60-second HMAC token in the `t=` query param, signed with `RM_PRINT_SECRET` env var. Puppeteer adds it; direct hits without a valid token get 401.

## File map

**Create:**
- `sql/migrations/rm_site_notes.sql`
- `app/api/rm/notes/route.ts` (GET + POST)
- `app/api/rm/top-movers/route.ts`
- `app/api/reports/rm/generate/route.ts`
- `app/reports/rm/print/page.tsx` (server component)
- `app/reports/rm/print/layout.tsx` (no chrome, print CSS only)
- `lib/buildReportPayload.ts`
- `lib/renderPdf.ts` (Puppeteer wrapper)
- `lib/printAuth.ts` (HMAC sign/verify)
- `components/print/PageFrame.tsx`
- `components/print/CostPerformancePage.tsx`
- `components/print/HeatmapPage.tsx`
- `components/print/EfficiencyPage.tsx`

**Modify:**
- `components/rm/CostHeatmap.tsx` — switch notes from localStorage to API, add one-shot migration
- `app/dashboard/rm/page.tsx` — Generate PDF button now POSTs to `/api/reports/rm/generate`, removes `html2pdf.js` dynamic import

## Dependencies to add

```bash
npm i puppeteer-core @sparticuz/chromium-min
```

## Vercel config

Update `vercel.json` to bump function memory + timeout on `/api/reports/rm/generate`:
```json
{
  "functions": {
    "app/api/reports/rm/generate/route.ts": {
      "memory": 1024,
      "maxDuration": 60
    }
  }
}
```

## Out of scope (v1)

- Pages 4–7 (deferred to v2)
- `rm_site_notes.author` populated from authenticated user (column exists, left NULL for now — auth wiring deferred)
- Multi-format export (CSV, etc.)
- Scheduled email delivery
- Asynchronous job queue (generation is synchronous in v1)
