# R&M PDF v2 — Implementation Plan

**Goal:** Ship a server-rendered 3-page executive PDF report on `/dashboard/rm`, replacing the html2pdf.js client export.

**Architecture:** New `rm_site_notes` table + 3 new endpoints + `/reports/rm/print` route + Puppeteer renderer. The dashboard's Generate PDF button POSTs to `/api/reports/rm/generate`, which builds the payload, navigates Puppeteer to the print route, and streams the resulting PDF.

**Tech stack:** Next.js App Router · puppeteer-core · @sparticuz/chromium-min v131 · Postgres (Neon)

---

## Task 1 — `rm_site_notes` table + notes API + dashboard migration

**Files:**
- Create: `sql/migrations/rm_site_notes.sql`
- Create: `app/api/rm/notes/route.ts`
- Modify: `components/rm/CostHeatmap.tsx`

**Deliverables:**
1. Apply migration to Neon
2. `GET /api/rm/notes?dateFrom=…&dateTo=…` returns `{ data: [{ siteCode, note }] }`
3. `POST /api/rm/notes` upserts (empty note = delete row)
4. `CostHeatmap` reads from API instead of localStorage; debounced (300ms) writes to API on blur
5. On mount, perform one-shot localStorage → API sync: scan keys `rm-site-note-{dateFrom}-{dateTo}-*`, POST any that aren't already in the API response

**Verify:** Type a note in the heatmap → reload → note persists. `SELECT * FROM rm_site_notes` shows the row. Existing localStorage entries appear in the DB after first dashboard visit.

## Task 2 — Top Movers endpoint

**Files:**
- Create: `app/api/rm/top-movers/route.ts`

**Logic:** Sites with the largest `(current_period_cost - prior_period_cost)` deltas. Prior period = same length immediately before current. Return top 3 rising + bottom 3 falling.

**Verify:** `curl ?dateFrom=2026-04-01&dateTo=2026-04-30` returns 3 sites with positive deltas and 3 with negative deltas, all referencing real site codes.

## Task 3 — `buildReportPayload` helper

**Files:**
- Create: `lib/buildReportPayload.ts`

**Function:** `async function buildReportPayload(filters: RMFilters): Promise<ReportPayload>` — server-only function that calls existing endpoints' internal queries (or runs the same SQL inline) and assembles the JSON shape from §5 of the engineering spec.

**Verify:** Call from a test script; spot-check that `cost.ytd.value`, `siteHeatmap.sites[0].total`, and `efficiency.openTickets.total` match what the dashboard shows.

## Task 4 — Print route shell + PageFrame + print CSS + HMAC auth

**Files:**
- Create: `app/reports/rm/print/page.tsx` (server component)
- Create: `app/reports/rm/print/layout.tsx` (bare layout — no nav, no chrome, just print CSS)
- Create: `components/print/PageFrame.tsx`
- Create: `lib/printAuth.ts` (HMAC sign + verify using `RM_PRINT_SECRET`)

**Deliverables:**
- `app/reports/rm/print/layout.tsx` includes the print CSS from §8 of the engineering spec
- Print route accepts `?t={hmac}&dateFrom=…&dateTo=…&territory=…&siteCode=…`, verifies token (60s window), 401 if invalid
- Calls `buildReportPayload` server-side, passes to a single `<Report payload={...} />` component
- `<Report>` renders 3 placeholder pages with `PageFrame` chrome (header, footer, page numbering); each page has `data-page-index={N}`
- After all charts mount, set `<body data-report-ready="true">`

**Verify:** Manually generate an HMAC, visit the URL — 3 page-shaped placeholders render with correct chrome.

## Task 5 — Page 2 (Heatmap)

**Files:**
- Create: `components/print/HeatmapPage.tsx`

**Implements:** Top 20 sites × ~9 categories with quintile coloring (algorithm from §7 of the engineering spec), inline notes column, "TOP 20 TOTAL" footer row, scale legend, tail-line for remaining sites total.

**Verify:** Print page 2 alone shows the heatmap with colored cells. Cells with values in the bottom quintile of their column are green; top quintile red. Notes render as plain text in the Notes column (28% width). Missing values render as em-dash, slate-400.

## Task 6 — Page 1 (Cost Performance)

**Files:**
- Create: `components/print/CostPerformancePage.tsx`

**Implements:** 4 KPI cards (YTD, MTD, Cost/L, Top Category) + Pareto chart (bars + cumulative line + 80% dashed reference) + Trend chart (current year solid, prior year dashed, budget pace dashed green) + Top Movers callout (2 columns: Rising / Falling).

**Verify:** Charts render in the headless browser as SVG. Numbers match the dashboard KPI strip.

## Task 7 — Page 3 (Efficiency)

**Files:**
- Create: `components/print/EfficiencyPage.tsx`

**Implements:** 4 KPI cards (orange top accent) + horizontal aging bars + Recurring Issues top 4 table + 3 callout tiles (Worst SLA / Slowest Resolution / Highest Volume).

**Verify:** Page 3 renders with all panels populated. Callouts reference real site codes.

## Task 8 — Puppeteer renderer + `/api/reports/rm/generate`

**Files:**
- Create: `lib/renderPdf.ts`
- Create: `app/api/reports/rm/generate/route.ts`
- Modify: `vercel.json` (add function-level memory: 1024, maxDuration: 60 for the generate route)

**Deliverables:**
- `renderPdf(printUrl: string): Promise<Buffer>` using `puppeteer-core` + `@sparticuz/chromium-min` (executablePath downloads the chromium pack from the GitHub release URL)
- `POST /api/reports/rm/generate` validates the request body, signs an HMAC, constructs the print URL, awaits `renderPdf`, streams the buffer as `application/pdf`
- Filename: `Redan-RM-Report-{dateFrom}_to_{dateTo}.pdf` via `Content-Disposition`

**Install deps:**
```bash
npm i puppeteer-core @sparticuz/chromium-min
```

**Verify:** Locally, hit the endpoint with a Bearer token and a date range; the response is a valid PDF of ~150KB. Open the PDF — 3 pages with no interactive bleed-through.

## Task 9 — Replace Generate PDF button + smoke test

**Files:**
- Modify: `app/dashboard/rm/page.tsx`

**Changes:**
- Remove the `handleGeneratePDF` function using `html2pdf.js`
- New button POSTs to `/api/reports/rm/generate` and downloads the response blob
- Remove the now-unused `id="rm-report-root"` wrapper and `.pdf-keep` / `.pdf-page-break-before` CSS
- The dashboard Notes-Overview textarea, the in-DOM "Overview" panel, and the per-site Note input still work normally on screen — they just no longer drive PDF rendering

**Verify:** On the deployed dashboard, click Generate PDF → file downloads. Open it — 3 properly paginated pages with no SORT/toggle/button artifacts. Numbers match the on-screen dashboard.

---

## Execution notes

- Tasks 1–3 (data layer) can run in parallel — independent files
- Tasks 5–7 (pages) are independent of each other, but all depend on Task 4 (PageFrame) being done first
- Task 8 (Puppeteer) needs Task 4 (print route exists) but is otherwise standalone
- Task 9 ties everything together — last
- Use `haiku` for Tasks 1, 2, 5, 6, 7, 9 (mechanical with complete specs)
- Use `sonnet` for Tasks 3, 4, 8 (architectural judgment)

## Acceptance for v1

Per §12 of the engineering spec — all bullet points must hold:
- All 3 pages render without break artifacts or split rows
- Zero `SORT`, toggle, dropdown, or button elements appear anywhere in output
- Empty note cells are blank (no placeholder text)
- Heatmap cells use traffic-light c1–c5 based on per-column quintile
- Empty heatmap cells show `—`, not `$0`
- Page header + footer identical on every page with correct numbering
- Top Movers reflects real MoM data
- PDF <500KB
- Generation <5s p95 (after warm)
- Filename: `Redan-RM-Report-{from}_to_{to}.pdf`
