# R&M PDF Page 1 Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Page 1 of the R&M PDF report as a "Cost & Operational Snapshot" — 4 cost tiles + 2 efficiency tiles + side-by-side Pareto/Trend + Territory Snapshot strip — and fix the missing-glyph arrows + brand text along the way. Pages 2–6 untouched.

**Architecture:** Additive API changes only (dashboard keeps working). New SVG-arrow helper + one new endpoint (`/api/rm/territory-snapshot`). One existing print component fully rewritten (`CostPerformancePage.tsx`). One existing CSS file extended. No DB migrations, no schema changes.

**Tech Stack:** Next.js 14 (App Router), Postgres via `lib/db.ts` (`query<T>(sql, params)`), Recharts for SVG charts inside a Puppeteer-rendered print route. Existing test pattern is `tsx --test lib/*.test.ts` for pure helpers; route changes verified manually via curl + the live print page (no route-test framework in this repo).

**Spec reference:** `docs/superpowers/specs/2026-05-19-rm-page-1-redesign-design.md`

**Important context the engineer should hold:**
- The print route is **landscape** (`@page { size: Letter landscape; }` in `print.css`). The user's design mockup is drawn in portrait shape, but the layout adapts cleanly to landscape: 4 cost tiles in one row, 2 efficiency tiles in the next row, charts side-by-side, Territory Snapshot at the bottom. Usable body area is ≈720pt × 555pt after header/footer/padding — verify the new layout doesn't overflow by previewing.
- `lib/buildReportPayload.ts` is the single source of truth for the print payload. The `ReportPayload` type at lines 14–99 is what every print component reads. Update the type first, then the assembler, then the consumer component.
- The existing `cost-trend` endpoint **already returns** `currentYear`, `priorYearSeries`, and `budgetSeries` (one entry per month, Jan–Dec). No changes needed there beyond consuming them differently in the chart. The spec doc says "add priorYear and budget" — that's wrong; just use what's already there.
- The existing `kpis-efficiency.openTickets` is documented as **"current state — ignores date filters"** (line 32 of the route). We must **not** change its semantics. Instead, **add** new fields `noActionOpen` and `waitingThirdParty` with point-in-time semantics (open as of `dateTo`). The dashboard reads `openTickets` and we won't break it.
- The repo has no API route tests. We follow that pattern: manual verification via curl + screenshot diff of the printed page. Pure helpers we extract (e.g., delta formatter) get `lib/*.test.ts` tests.

---

## Files we will touch

**Modify:**
- `app/api/rm/kpis-cost/route.ts` — switch `topCategory` to MTD scope; add `topCategory.contributors`; remove `fleetMedian`
- `app/api/rm/kpis-efficiency/route.ts` — add `ticketsOpened`, `noActionOpen`, `waitingThirdParty` (additive)
- `lib/buildReportPayload.ts` — extend `ReportPayload` type; fetch territory snapshot; drop top-movers from page-1 path
- `app/reports/rm/print/layout.tsx` — add SVG `<symbol>` defs
- `app/reports/rm/print/print.css` — new tile / lens-divider / territory-bar / two-metric-tile styles
- `app/reports/rm/print/page.tsx` — change page-1 title from "Cost Performance" to "Cost & Operational Snapshot"
- `components/print/CostPerformancePage.tsx` — full rewrite for new layout
- `components/print/EfficiencyPage.tsx` — replace inline `▲▼•` with `<Arrow>` component (small clean-up)
- `components/exec/ReportCover.tsx:82` — `Redan Petroleum` → `Redan Coupon`
- `app/api/reports/rm/generate/route.ts:88` — filename prefix `Redan-` → `Redan-Coupon-`

**Create:**
- `components/print/Arrow.tsx` — reusable SVG arrow renderer
- `app/api/rm/territory-snapshot/route.ts` — new endpoint
- `lib/format-delta.ts` + `lib/format-delta.test.ts` — extract the delta-formatting logic with a test

**Untouched:**
- `components/print/HeatmapPage.tsx`, `TicketHeatmapPage.tsx`, `PageFrame.tsx`
- `app/api/rm/top-movers/route.ts` (kept; just not consumed by page 1)
- `components/rm/*` (dashboard components — not in print path)

---

# Part 1 — Brand rename + arrow rendering (safe quick wins)

### Task 1: Rename "Redan Petroleum" to "Redan Coupon"

**Files:**
- Modify: `components/exec/ReportCover.tsx:82`

- [ ] **Step 1: Make the change**

In `components/exec/ReportCover.tsx`, line 82, change:

```tsx
<div className="text-sm text-gray-500 uppercase tracking-widest mb-2">Redan Petroleum</div>
```

to:

```tsx
<div className="text-sm text-gray-500 uppercase tracking-widest mb-2">Redan Coupon</div>
```

- [ ] **Step 2: Verify no other instances**

Run:
```bash
grep -rn "Redan Petroleum" "/Users/allen/Documents/PROJECTS/Sales dashboard" \
  --include="*.tsx" --include="*.ts" --include="*.css" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=.next
```
Expected: zero matches (no output).

- [ ] **Step 3: Commit**

```bash
git add components/exec/ReportCover.tsx
git commit -m "chore(brand): rename Redan Petroleum to Redan Coupon in report cover"
```

---

### Task 2: Update PDF filename pattern

**Files:**
- Modify: `app/api/reports/rm/generate/route.ts:88`

- [ ] **Step 1: Make the change**

Change line 88 from:

```ts
const filename = `Redan-RM-Report-${filters.dateFrom}_to_${filters.dateTo}.pdf`;
```

to:

```ts
const filename = `Redan-Coupon-RM-Report-${filters.dateFrom}_to_${filters.dateTo}.pdf`;
```

- [ ] **Step 2: Commit**

```bash
git add app/api/reports/rm/generate/route.ts
git commit -m "chore(brand): prefix PDF filename with Redan-Coupon"
```

---

### Task 3: Define SVG arrow symbols in the print layout

**Files:**
- Modify: `app/reports/rm/print/layout.tsx`

These symbols are defined once at the document root and referenced from any print component via `<use href="#arrUp">` etc. Currentcolor lets the parent component control the arrow color.

- [ ] **Step 1: Add symbol defs to PrintLayout**

Replace the entire contents of `app/reports/rm/print/layout.tsx` with:

```tsx
// app/reports/rm/print/layout.tsx
// Bare layout for the PDF print surface — no nav, no chrome, no scripts
// beyond what the route itself imports. The CSS here is the canonical
// print stylesheet for the report.
import React from 'react';
import './print.css';

export const metadata = {
  title: 'R&M Report (Print)',
  robots: 'noindex, nofollow',
};

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* SVG arrow symbols — referenced via <use href="#arrUp"> from any
            print component. Defined here so the print CSS / Puppeteer
            renderer see them once globally. Color inherits from
            currentColor on the parent <svg>. */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <symbol id="arrUp" viewBox="0 0 8 8">
              <path d="M4 1 L7.5 6.5 L0.5 6.5 Z" fill="currentColor" />
            </symbol>
            <symbol id="arrDown" viewBox="0 0 8 8">
              <path d="M4 7 L0.5 1.5 L7.5 1.5 Z" fill="currentColor" />
            </symbol>
            <symbol id="arrFlat" viewBox="0 0 8 8">
              <rect x="1" y="3.5" width="6" height="1" fill="currentColor" />
            </symbol>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run:
```bash
cd "/Users/allen/Documents/PROJECTS/Sales dashboard" && npx next build 2>&1 | tail -40
```
Expected: build completes without errors. (If it fails for unrelated reasons, note them but don't try to fix here.)

- [ ] **Step 3: Commit**

```bash
git add app/reports/rm/print/layout.tsx
git commit -m "feat(print): define reusable SVG arrow symbols in print layout"
```

---

### Task 4: Create reusable `<Arrow>` component

**Files:**
- Create: `components/print/Arrow.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/print/Arrow.tsx
// Reusable SVG arrow indicator for KPI deltas.
// References the <symbol> defs declared in app/reports/rm/print/layout.tsx.
// Color comes from currentColor — set it on the parent span.
import React from 'react';

export type ArrowDirection = 'up' | 'down' | 'flat';

interface Props {
  direction: ArrowDirection;
  size?: number;
}

const SYMBOL_ID: Record<ArrowDirection, string> = {
  up:   '#arrUp',
  down: '#arrDown',
  flat: '#arrFlat',
};

export function Arrow({ direction, size = 7 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      style={{ verticalAlign: '-1px', marginRight: '2px' }}
      aria-hidden="true"
    >
      <use href={SYMBOL_ID[direction]} />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/print/Arrow.tsx
git commit -m "feat(print): add reusable Arrow component (SVG <use> reference)"
```

---

### Task 5: Extract `format-delta` helper with a test

The existing `fmtDelta` is duplicated in `CostPerformancePage.tsx:31-40` and a near-twin `fmtMTTRDelta` lives in `EfficiencyPage.tsx:24-31`. Both emit Unicode arrows that don't render. We pull out a pure function, test it, and reuse it.

**Files:**
- Create: `lib/format-delta.ts`
- Create: `lib/format-delta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/format-delta.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDelta } from './format-delta';

test('positive value when up is bad → up + bad class', () => {
  const r = formatDelta(4.3, 'down');   // goodDirection = 'down' means down-is-good
  assert.equal(r.direction, 'up');
  assert.equal(r.cls, 'kpi-bad');
  assert.equal(r.magnitude, '4.3');
});

test('negative value when down is good → down + good class', () => {
  const r = formatDelta(-1.1, 'down');
  assert.equal(r.direction, 'down');
  assert.equal(r.cls, 'kpi-good');
  assert.equal(r.magnitude, '1.1');
});

test('zero → flat + dim', () => {
  const r = formatDelta(0, 'down');
  assert.equal(r.direction, 'flat');
  assert.equal(r.cls, 'kpi-dim');
  assert.equal(r.magnitude, '0.0');
});

test('null → flat + dim with em-dash', () => {
  const r = formatDelta(null, 'down');
  assert.equal(r.direction, 'flat');
  assert.equal(r.cls, 'kpi-dim');
  assert.equal(r.magnitude, '—');
});

test('positive value when up is good → up + good class', () => {
  const r = formatDelta(5.7, 'up');
  assert.equal(r.direction, 'up');
  assert.equal(r.cls, 'kpi-good');
});

test('treats sub-1% as flat when threshold=1', () => {
  const r = formatDelta(0.4, 'down', { flatThreshold: 1 });
  assert.equal(r.direction, 'flat');
  assert.equal(r.cls, 'kpi-dim');
  assert.equal(r.magnitude, '0.4');
});
```

- [ ] **Step 2: Run the test, see it fail**

```bash
cd "/Users/allen/Documents/PROJECTS/Sales dashboard" && npm test -- --test-name-pattern='format-delta' 2>&1 | tail -30
```
Expected: FAIL (`Cannot find module './format-delta'`).

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/format-delta.ts
// Pure helper for formatting KPI delta indicators (arrows + magnitude
// + good/bad class). Used by all print components.

export type ArrowDirection = 'up' | 'down' | 'flat';
export type GoodDirection  = 'up' | 'down';

export interface FormattedDelta {
  direction: ArrowDirection;
  magnitude: string;          // "4.3" or "—"
  cls:       'kpi-good' | 'kpi-bad' | 'kpi-dim';
}

interface Options {
  /** Absolute threshold under which we treat as flat (default 0, i.e. only exact 0 is flat). */
  flatThreshold?: number;
  /** Decimal places in the magnitude (default 1). */
  decimals?: number;
}

export function formatDelta(
  value: number | null,
  goodDirection: GoodDirection,
  options: Options = {},
): FormattedDelta {
  const { flatThreshold = 0, decimals = 1 } = options;

  if (value === null || value === undefined || Number.isNaN(value)) {
    return { direction: 'flat', magnitude: '—', cls: 'kpi-dim' };
  }

  const magnitude = Math.abs(value).toFixed(decimals);

  if (Math.abs(value) <= flatThreshold) {
    return { direction: 'flat', magnitude, cls: 'kpi-dim' };
  }

  const isUp = value > 0;
  const direction: ArrowDirection = isUp ? 'up' : 'down';
  const isGood = (isUp && goodDirection === 'up') || (!isUp && goodDirection === 'down');
  return {
    direction,
    magnitude,
    cls: isGood ? 'kpi-good' : 'kpi-bad',
  };
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
npm test -- --test-name-pattern='format-delta' 2>&1 | tail -20
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/format-delta.ts lib/format-delta.test.ts
git commit -m "feat(lib): add formatDelta helper with arrow direction + class"
```

---

### Task 6: Swap Unicode arrows in `EfficiencyPage.tsx` for `<Arrow>`

This is a small clean-up so we don't ship missing-glyph boxes on page 3 either.

**Files:**
- Modify: `components/print/EfficiencyPage.tsx`

- [ ] **Step 1: Update imports**

At the top of the file, add:

```tsx
import { Arrow } from './Arrow';
import { formatDelta } from '@/lib/format-delta';
```

- [ ] **Step 2: Replace `fmtMTTRDelta` with `formatDelta` usage**

Delete lines 24–31 (`fmtMTTRDelta` function) and update the usage at line 34 from:

```tsx
const mttrDelta = fmtMTTRDelta(data.mttrDays.vsLM);
```

to:

```tsx
const mttrDelta = formatDelta(data.mttrDays.vsLM, 'down');
```

- [ ] **Step 3: Update the JSX site that uses `mttrDelta`**

Find the block (around line 53) that renders:

```tsx
<span className={mttrDelta.cls}>{mttrDelta.text}</span> vs LM
```

Replace with:

```tsx
<span className={mttrDelta.cls}>
  <Arrow direction={mttrDelta.direction} />
  {mttrDelta.magnitude}d
</span> vs LM
```

- [ ] **Step 4: Verify build**

```bash
cd "/Users/allen/Documents/PROJECTS/Sales dashboard" && npx tsc --noEmit 2>&1 | grep -E "EfficiencyPage|format-delta|Arrow" | head -20
```
Expected: no errors mentioning these files. (Other unrelated TS errors in the project are OK to leave.)

- [ ] **Step 5: Commit**

```bash
git add components/print/EfficiencyPage.tsx
git commit -m "fix(print): replace Unicode arrows on efficiency page with SVG <Arrow>"
```

---

# Part 2 — Backend additive changes

### Task 7: Modify `kpis-cost` — MTD-scope `topCategory` + add contributors

**Files:**
- Modify: `app/api/rm/kpis-cost/route.ts`

- [ ] **Step 1: Switch `topCategory` query window to MTD**

In `app/api/rm/kpis-cost/route.ts`, locate the `// 8. Top category (YTD)` block (around line 179). Change the params for the `topCats` query from:

```ts
[yearStart, f.dateTo, f.siteCode, f.territory],
```

to:

```ts
[monthStart, f.dateTo, f.siteCode, f.territory],
```

Also update the comment on line 179 from `// 8. Top category (YTD)` to `// 8. Top category (MTD — current month-to-date)`.

- [ ] **Step 2: Recompute `pctOfTotal` against `mtdCurrent` instead of `ytdCurrent`**

In the same block, change:

```ts
pctOfTotal: ytdCurrent > 0 ? +(parseFloat(topCat.total) / ytdCurrent * 100).toFixed(1) : null,
```

to:

```ts
pctOfTotal: mtdCurrent > 0 ? +(parseFloat(topCat.total) / mtdCurrent * 100).toFixed(1) : null,
```

- [ ] **Step 3a: Add MTD cost/litre + prior-month MTD cost/litre for vsLM delta**

Right after the existing `costPerLitre` computation block (around line 149, after `const costPerLitre = ytdVolume > 0 ? ytdCurrent / ytdVolume : null;`), add an MTD-scoped version and a prior-month MTD-scoped version to enable the vsLM delta:

```ts
    // 7b. MTD cost / litre + prior-month MTD cost / litre (for vsLM delta)
    const [mtdVolumeRow] = await query<{ total: string }>(
      `SELECT COALESCE(SUM(s.total_volume), 0)::NUMERIC AS total
         FROM sales s
         JOIN sites si ON s.site_code = si.site_code
         LEFT JOIN territories t ON si.territory_id = t.id
        WHERE s.sale_date >= $1::DATE AND s.sale_date <= $2::DATE
          AND ($3::TEXT = '' OR s.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)`,
      [monthStart, f.dateTo, f.siteCode, f.territory],
    );
    const mtdVolume = parseFloat(mtdVolumeRow.total);
    const costPerLitreMTD = mtdVolume > 0 ? mtdCurrent / mtdVolume : null;

    const [priorMtdVolumeRow] = await query<{ total: string }>(
      `SELECT COALESCE(SUM(s.total_volume), 0)::NUMERIC AS total
         FROM sales s
         JOIN sites si ON s.site_code = si.site_code
         LEFT JOIN territories t ON si.territory_id = t.id
        WHERE s.sale_date >= $1::DATE AND s.sale_date <= $2::DATE
          AND ($3::TEXT = '' OR s.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)`,
      [priorMonthStart, priorMonthEnd, f.siteCode, f.territory],
    );
    const priorMtdVolume = parseFloat(priorMtdVolumeRow.total);
    const costPerLitrePriorMTD = priorMtdVolume > 0 ? mtdPriorMonth / priorMtdVolume : null;
    const costPerLitreVsLM = (costPerLitreMTD !== null && costPerLitrePriorMTD !== null)
      ? +((costPerLitreMTD - costPerLitrePriorMTD) * 100).toFixed(2)   // cents delta
      : null;
```

Then update the `costPerLitre` block in the response (around line 222–225) from:

```ts
costPerLitre: {
  current:     costPerLitre,
  fleetMedian: fleetMedian,
},
```

to:

```ts
costPerLitre: {
  current:     costPerLitre,
  vsLM:        costPerLitreVsLM,    // cents delta (positive = up vs LM)
  fleetMedian: fleetMedian,         // kept for backward compat with dashboard
},
```

(We keep `fleetMedian` in the API response so the dashboard doesn't break, but `buildReportPayload` will stop forwarding it to the print payload — see Task 10.)

- [ ] **Step 3b: Add top-3 contributors query**

Immediately after the existing `topCats` block (after the `const topCategory = …` assignment around line 204), insert this block, which fetches the top-3 sites within the chosen top category over the MTD window:

```ts
    // 8b. Top contributors within the top category (MTD)
    let topCategoryContributors: Array<{ rank: 1 | 2 | 3; siteName: string; value: number }> = [];
    if (topCat) {
      const contribRows = await query<{ site_name: string; value: string }>(
        `SELECT s.budget_name AS site_name,
                SUM(i.net_cost)::NUMERIC AS value
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE i.cost_center='retail'
            AND i.service_date >= $1::DATE AND i.service_date <= $2::DATE
            AND c.slug = $3
            AND ($4::TEXT = '' OR i.site_code = $4)
            AND ($5::TEXT = '' OR t.tm_code = $5)
          GROUP BY s.budget_name
          ORDER BY value DESC NULLS LAST
          LIMIT 3`,
        [monthStart, f.dateTo, topCat.slug, f.siteCode, f.territory],
      );
      topCategoryContributors = contribRows.map((r, i) => ({
        rank: (i + 1) as 1 | 2 | 3,
        siteName: r.site_name,
        value: parseFloat(r.value),
      }));
    }
```

- [ ] **Step 4: Include `contributors` in the response payload**

Update the `topCategory` block in the response (around line 198–204) from:

```ts
const topCategory = topCat
  ? {
      displayName: topCat.display_name,
      total: parseFloat(topCat.total),
      pctOfTotal: mtdCurrent > 0 ? +(parseFloat(topCat.total) / mtdCurrent * 100).toFixed(1) : null,
    }
  : null;
```

to:

```ts
const topCategory = topCat
  ? {
      displayName: topCat.display_name,
      total: parseFloat(topCat.total),
      pctOfTotal: mtdCurrent > 0 ? +(parseFloat(topCat.total) / mtdCurrent * 100).toFixed(1) : null,
      contributors: topCategoryContributors,
    }
  : null;
```

- [ ] **Step 5: Manual verification**

Start dev server in another terminal: `npm run dev`. Then run:

```bash
curl -s "http://localhost:3000/api/rm/kpis-cost?dateFrom=2026-04-01&dateTo=2026-04-30" | python3 -m json.tool | grep -A 30 topCategory
```

Expected: `topCategory.contributors` is an array of up to 3 objects with `{rank, siteName, value}`, sorted desc by value. The total in `topCategory` should be smaller than the YTD total previously returned (because we narrowed to MTD).

- [ ] **Step 6: Commit**

```bash
git add app/api/rm/kpis-cost/route.ts
git commit -m "feat(api): kpis-cost — MTD scope for topCategory + top 3 contributors"
```

---

### Task 8: Modify `kpis-efficiency` — add tickets-opened, no-action open, waiting

**Files:**
- Modify: `app/api/rm/kpis-efficiency/route.ts`

This task ADDS new fields. Existing fields (`openTickets`, `mttr`, `slaHit`, `repeats`) stay exactly as they are — the dashboard reads them. We only extend the response.

- [ ] **Step 1: Compute prior-month period bounds for vsLM comparisons**

Currently the route derives `priorMonthStart` and `monthStart`. We also need a `priorPeriodEnd` for the "no-action open at one month ago" comparison. Add immediately after line 27 (the existing `priorMonthStart` line):

```ts
    // Period one month earlier (point-in-time backlog comparison).
    // For backlog metrics we compare "open as of dateTo" vs "open as of dateTo - 1 month".
    const priorPeriodEnd = (() => {
      const d = new Date(periodEnd);
      d.setUTCMonth(d.getUTCMonth() - 1);
      return d.toISOString().slice(0, 10);
    })();
```

- [ ] **Step 2: Add tickets-opened query (current period)**

After the existing `// 1. Open tickets` block (after line 46), insert:

```ts
    // 1b. Tickets opened in current period + avg response (resolution_minutes proxy)
    const [openedRow] = await query<{ opened: string; avg_min: string | null }>(
      `SELECT COUNT(*)::INT AS opened,
              AVG(resolution_minutes)::NUMERIC AS avg_min
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <= $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)`,
      [dateFrom, dateTo, siteCode, territory, category],
    );
    const ticketsOpenedCount = parseInt(openedRow.opened, 10);
    const avgResponseHours = openedRow.avg_min ? +(parseFloat(openedRow.avg_min) / 60).toFixed(1) : null;

    // 1c. Tickets opened in prior month (same calendar window length, shifted -1 month)
    const [openedPriorRow] = await query<{ avg_min: string | null }>(
      `SELECT AVG(resolution_minutes)::NUMERIC AS avg_min
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <  $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)`,
      [priorMonthStart, monthStart, siteCode, territory, category],
    );
    const avgResponseHoursPrior = openedPriorRow.avg_min ? +(parseFloat(openedPriorRow.avg_min) / 60).toFixed(1) : null;
    const avgResponseVsLM = (avgResponseHours !== null && avgResponseHoursPrior !== null)
      ? +(avgResponseHours - avgResponseHoursPrior).toFixed(1)
      : null;

    // 1d. Top 3 ticket-contributing sites in current period
    const ticketContribRows = await query<{ site_name: string; count: number }>(
      `SELECT s.budget_name AS site_name, COUNT(*)::INT AS count
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <= $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)
        GROUP BY s.budget_name
        ORDER BY count DESC
        LIMIT 3`,
      [dateFrom, dateTo, siteCode, territory, category],
    );
```

- [ ] **Step 3: Add no-action and waiting backlog queries (point-in-time)**

After the block from Step 2, insert:

```ts
    // 1e. No-action open (status Open/Pending) — open AS OF dateTo
    const [noActionRow] = await query<{ total: string }>(
      `SELECT COUNT(*)::INT AS total
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status IN ('Open', 'Pending')
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)`,
      [dateTo, siteCode, territory, category],
    );
    const noActionOpenCount = parseInt(noActionRow.total, 10);

    // 1f. Same query, but anchored to one month prior — used for vsLM
    const [noActionPriorRow] = await query<{ total: string }>(
      `SELECT COUNT(*)::INT AS total
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status IN ('Open', 'Pending')
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)`,
      [priorPeriodEnd, siteCode, territory, category],
    );
    const noActionOpenCountPrior = parseInt(noActionPriorRow.total, 10);
    const noActionVsLM = noActionOpenCount - noActionOpenCountPrior;

    // 1g. Waiting on Third Party — open AS OF dateTo
    const [waitingRow] = await query<{ total: string }>(
      `SELECT COUNT(*)::INT AS total
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status = 'Waiting on Third Party'
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)`,
      [dateTo, siteCode, territory, category],
    );
    const waitingCount = parseInt(waitingRow.total, 10);

    const [waitingPriorRow] = await query<{ total: string }>(
      `SELECT COUNT(*)::INT AS total
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status = 'Waiting on Third Party'
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)`,
      [priorPeriodEnd, siteCode, territory, category],
    );
    const waitingVsLM = waitingCount - parseInt(waitingPriorRow.total, 10);

    // 1h. Top 3 most-unactioned sites with stale (>30d) count
    const unActionedRows = await query<{ site_name: string; open_count: number; stale_count: number }>(
      `SELECT s.budget_name AS site_name,
              COUNT(*)::INT AS open_count,
              COUNT(*) FILTER (WHERE tk.created_time < $1::timestamptz - INTERVAL '30 days')::INT AS stale_count
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status IN ('Open', 'Pending')
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)
        GROUP BY s.budget_name
        ORDER BY open_count DESC, stale_count DESC
        LIMIT 3`,
      [dateTo, siteCode, territory, category],
    );
```

- [ ] **Step 4: Add new fields to the JSON response**

Update the `return NextResponse.json(...)` block at the bottom of the function (around line 133) from:

```ts
return NextResponse.json({
  data: {
    openTickets: {
      total: parseInt(openRow.total, 10),
      urgent: parseInt(openRow.urgent, 10),
    },
    mttr: {
      days: mttrCurrDays,
      priorMonthDays: mttrPriorDays,
    },
    slaHit: {
      hitPct: slaHitPct,
      breachCount: slaBreaches,
    },
    repeats: {
      siteCount: parseInt(repeatRow.site_count, 10),
    },
  },
});
```

to:

```ts
return NextResponse.json({
  data: {
    openTickets: {
      total: parseInt(openRow.total, 10),
      urgent: parseInt(openRow.urgent, 10),
    },
    mttr: {
      days: mttrCurrDays,
      priorMonthDays: mttrPriorDays,
    },
    slaHit: {
      hitPct: slaHitPct,
      breachCount: slaBreaches,
    },
    repeats: {
      siteCount: parseInt(repeatRow.site_count, 10),
    },
    // — Additive fields for page-1 report —
    ticketsOpened: {
      value: ticketsOpenedCount,
      avgResponseHours,
      vsLM: avgResponseVsLM,
      contributors: ticketContribRows.map((r, i) => ({
        rank: (i + 1) as 1 | 2 | 3,
        siteName: r.site_name,
        count: r.count,
      })),
    },
    noActionOpen: {
      value: noActionOpenCount,
      vsLM:  noActionVsLM,
      oldestSites: unActionedRows.map((r, i) => ({
        rank: (i + 1) as 1 | 2 | 3,
        siteName: r.site_name,
        openCount: r.open_count,
        staleCount: r.stale_count,
      })),
    },
    waitingThirdParty: {
      value: waitingCount,
      vsLM:  waitingVsLM,
    },
  },
});
```

- [ ] **Step 5: Manual verification**

With dev server running:

```bash
curl -s "http://localhost:3000/api/rm/kpis-efficiency?dateFrom=2026-04-01&dateTo=2026-04-30" \
  | python3 -m json.tool | grep -E "ticketsOpened|noActionOpen|waitingThirdParty|avgResponseHours|oldestSites" | head -20
```

Expected:
- `ticketsOpened.value` is an integer
- `ticketsOpened.avgResponseHours` is a number or `null`
- `ticketsOpened.contributors` is an array of up to 3 objects
- `noActionOpen.value` is an integer
- `noActionOpen.oldestSites` is an array of up to 3 with `openCount` and `staleCount`
- `waitingThirdParty.value` is an integer
- The existing `openTickets`, `mttr`, `slaHit`, `repeats` fields are still present (regression check)

- [ ] **Step 6: Verify dashboard still works**

Open `http://localhost:3000/dashboard/rm` in a browser. The efficiency KPI strip should still render with no errors (it reads only the existing fields).

- [ ] **Step 7: Commit**

```bash
git add app/api/rm/kpis-efficiency/route.ts
git commit -m "feat(api): kpis-efficiency — add tickets-opened, no-action, waiting backlog fields"
```

---

### Task 9: New endpoint `/api/rm/territory-snapshot`

**Files:**
- Create: `app/api/rm/territory-snapshot/route.ts`

- [ ] **Step 1: Write the endpoint**

```ts
// app/api/rm/territory-snapshot/route.ts
// MTD spend by Territory Manager + YoY delta + relative bar width.
// Used by Page 1 of the R&M print report.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = sp.get('dateFrom') || today;
    const dateTo   = sp.get('dateTo')   || today;
    // siteCode/category filters intentionally ignored: this strip
    // shows territory-level rollup. Territory filter, if present,
    // would degenerate to a single-row report so we ignore it too.

    const rows = await query<{
      tm_name:        string;
      mtd_spend:      string;
      yoy_pct:        string | null;
      bar_pct_of_max: number | null;
    }>(
      `WITH current AS (
         SELECT COALESCE(t.tm_name, 'UNASSIGNED') AS tm_name,
                SUM(i.net_cost)::NUMERIC AS mtd_spend
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
          WHERE i.cost_center = 'retail'
            AND i.service_date BETWEEN $1::DATE AND $2::DATE
          GROUP BY COALESCE(t.tm_name, 'UNASSIGNED')
       ),
       prior AS (
         SELECT COALESCE(t.tm_name, 'UNASSIGNED') AS tm_name,
                SUM(i.net_cost)::NUMERIC AS prior_spend
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
          WHERE i.cost_center = 'retail'
            AND i.service_date BETWEEN $1::DATE - INTERVAL '1 year'
                                   AND $2::DATE - INTERVAL '1 year'
          GROUP BY COALESCE(t.tm_name, 'UNASSIGNED')
       ),
       max_spend AS (SELECT MAX(mtd_spend) AS m FROM current)
       SELECT
         c.tm_name,
         c.mtd_spend,
         CASE
           WHEN p.prior_spend IS NULL OR p.prior_spend = 0 THEN NULL
           ELSE ROUND(((c.mtd_spend - p.prior_spend) / p.prior_spend) * 100, 1)
         END AS yoy_pct,
         CASE
           WHEN m.m IS NULL OR m.m = 0 THEN NULL
           ELSE ROUND((c.mtd_spend / m.m) * 100)::int
         END AS bar_pct_of_max
       FROM current c
       LEFT JOIN prior p USING (tm_name)
       CROSS JOIN max_spend m
       ORDER BY c.mtd_spend DESC NULLS LAST`,
      [dateFrom, dateTo],
    );

    const snapshot = rows.map(r => ({
      tmName:       r.tm_name,
      mtdSpend:     parseFloat(r.mtd_spend),
      yoyPct:       r.yoy_pct === null ? null : parseFloat(r.yoy_pct),
      barPctOfMax:  r.bar_pct_of_max ?? 0,
    }));

    return NextResponse.json({ data: { snapshot } });
  } catch (err: any) {
    console.error('/api/rm/territory-snapshot error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manual verification**

With dev server running:

```bash
curl -s "http://localhost:3000/api/rm/territory-snapshot?dateFrom=2026-04-01&dateTo=2026-04-30" | python3 -m json.tool
```

Expected response shape:
```
{
  "data": {
    "snapshot": [
      { "tmName": "SALIYA", "mtdSpend": 24800.0, "yoyPct": 12.1, "barPctOfMax": 100 },
      { "tmName": "BRENDON", "mtdSpend": 18900.0, "yoyPct": -3.4, "barPctOfMax": 76 },
      ...
    ]
  }
}
```

Sanity check: the row with the highest `mtdSpend` should have `barPctOfMax: 100`; others should be smaller. `yoyPct` may be `null` if the prior-year window has no data.

- [ ] **Step 3: Commit**

```bash
git add app/api/rm/territory-snapshot/route.ts
git commit -m "feat(api): /api/rm/territory-snapshot — MTD spend by TM with YoY"
```

---

### Task 10: Extend `ReportPayload` type and update `buildReportPayload`

**Files:**
- Modify: `lib/buildReportPayload.ts`

- [ ] **Step 1: Extend the `cost` and `efficiency` sub-types**

In `lib/buildReportPayload.ts`, update the `ReportPayload` interface. Replace lines 22–37 (the `cost: { … }` block) with:

```ts
  cost: {
    ytd:           { value: number; vsLY: number | null;        vsBudget: number | null };
    mtd:           { value: number; vsLM: number | null;        vsBudget: number | null };
    costPerLitre:  { value: number | null; vsLM: number | null };
    topCategory:   {
      name: string;
      value: number;
      pctOfTotal: number;
      contributors: Array<{ rank: 1 | 2 | 3; siteName: string; value: number }>;
    } | null;
    pareto:        Array<{ category: string; value: number; cumulativePct: number }>;
    trend: {
      current:   Array<{ month: string; value: number }>;
      priorYear: Array<{ month: string; value: number }>;
      budget:    Array<{ month: string; value: number }>;
    };
  };
```

Note: `topMovers` removed from the `cost` block, `fleetMedian` removed from `costPerLitre`, and `vsLM` added there.

- [ ] **Step 2: Extend the `efficiency` sub-type**

Replace lines 86–98 (the `efficiency: { … }` block) with:

```ts
  efficiency: {
    openTickets:  { total: number; urgent: number };
    mttrDays:     { value: number | null; vsLM: number | null };
    slaHitRate:   { value: number | null; breaches: number };
    repeatIssues: number;
    aging:        Array<{ bucket: '0-30' | '31-60' | '61-90' | '90+'; count: number }>;
    recurring:    Array<{ subject: string; category: string | null; count: number; sites: number }>;
    callouts: {
      worstSla:           { siteCode: string; siteName: string; openOfTotal: string } | null;
      slowestResolution:  { siteCode: string; siteName: string; avgHours: number }   | null;
      highestVolume:      { siteCode: string; siteName: string; tickets: number }     | null;
    };
    // — Additive fields for page-1 snapshot —
    ticketsOpened: {
      value: number;
      avgResponseHours: number | null;
      vsLM: number | null;
      contributors: Array<{ rank: 1 | 2 | 3; siteName: string; count: number }>;
    };
    noActionOpen: {
      value: number;
      vsLM: number;
      oldestSites: Array<{ rank: 1 | 2 | 3; siteName: string; openCount: number; staleCount: number }>;
    };
    waitingThirdParty: { value: number; vsLM: number };
  };
```

- [ ] **Step 3: Add a `territory` block to the payload**

Just before the `efficiency:` block at line 86, add a new line:

```ts
  territory: {
    snapshot: Array<{ tmName: string; mtdSpend: number; yoyPct: number | null; barPctOfMax: number }>;
  };
```

- [ ] **Step 4: Fetch territory snapshot in parallel**

In the `Promise.all([...])` block (around line 154–171), add a new entry. Change from:

```ts
  const [
    kpisCost,
    pareto,
    trend,
    topMovers,
    heatmap,
    heatmapTickets,
    notesRows,
    kpisEff,
    aging,
    recurring,
  ] = await Promise.all([
    getJSON<any>(`/api/rm/kpis-cost?${queryStr}`),
    getJSON<any>(`/api/rm/cost-pareto?${queryStr}&dimension=category`),
    getJSON<any>(`/api/rm/cost-trend?${queryStr}`),
    getJSON<any>(`/api/rm/top-movers?${queryStr}`),
    getJSON<any>(`/api/rm/cost-heatmap?${queryStr}`),
    getJSON<any>(`/api/rm/cost-heatmap?${queryStr}&dimension=tickets`),
    query<{ site_code: string; note_text: string }>( /* notes query */ ... ),
    getJSON<any>(`/api/rm/kpis-efficiency?${queryStr}`),
    getJSON<any>(`/api/rm/ticket-aging?${queryStr}`),
    getJSON<any>(`/api/rm/recurring-issues?${queryStr}&limit=4`),
  ]);
```

to (adding `territorySnap` as the 11th element — keep `topMovers` since pages 4–6 may still want it eventually; we just won't read it for page 1):

```ts
  const [
    kpisCost,
    pareto,
    trend,
    topMovers,
    heatmap,
    heatmapTickets,
    notesRows,
    kpisEff,
    aging,
    recurring,
    territorySnap,
  ] = await Promise.all([
    getJSON<any>(`/api/rm/kpis-cost?${queryStr}`),
    getJSON<any>(`/api/rm/cost-pareto?${queryStr}&dimension=category`),
    getJSON<any>(`/api/rm/cost-trend?${queryStr}`),
    getJSON<any>(`/api/rm/top-movers?${queryStr}`),
    getJSON<any>(`/api/rm/cost-heatmap?${queryStr}`),
    getJSON<any>(`/api/rm/cost-heatmap?${queryStr}&dimension=tickets`),
    query<{ site_code: string; note_text: string }>(
      `SELECT DISTINCT ON (site_code) site_code, note_text
         FROM rm_site_notes
        WHERE period_from <= $2::DATE AND period_to >= $1::DATE
        ORDER BY site_code, period_to DESC, updated_at DESC`,
      [filters.dateFrom, filters.dateTo],
    ),
    getJSON<any>(`/api/rm/kpis-efficiency?${queryStr}`),
    getJSON<any>(`/api/rm/ticket-aging?${queryStr}`),
    getJSON<any>(`/api/rm/recurring-issues?${queryStr}&limit=4`),
    getJSON<any>(`/api/rm/territory-snapshot?${queryStr}`),
  ]);
```

(Keep the existing inline notes query exactly as it was — don't paraphrase it.)

- [ ] **Step 5: Update the returned `cost.topCategory` shape**

In the `return { … }` block at the bottom, update the `topCategory:` line. Change from:

```ts
topCategory: kpisCost.data.topCategory
  ? {
      name:       kpisCost.data.topCategory.displayName,
      value:      kpisCost.data.topCategory.total,
      pctOfTotal: kpisCost.data.topCategory.pctOfTotal ?? 0,
    }
  : null,
```

to:

```ts
topCategory: kpisCost.data.topCategory
  ? {
      name:         kpisCost.data.topCategory.displayName,
      value:        kpisCost.data.topCategory.total,
      pctOfTotal:   kpisCost.data.topCategory.pctOfTotal ?? 0,
      contributors: kpisCost.data.topCategory.contributors ?? [],
    }
  : null,
```

- [ ] **Step 6: Update the returned `costPerLitre` shape**

Change from:

```ts
costPerLitre: {
  value:       kpisCost.data.costPerLitre.current,
  fleetMedian: kpisCost.data.costPerLitre.fleetMedian,
},
```

to:

```ts
costPerLitre: {
  value: kpisCost.data.costPerLitre.current,
  vsLM:  kpisCost.data.costPerLitre.vsLM ?? null,
},
```

(Task 7 already added `vsLM` to the API. `fleetMedian` is intentionally not forwarded — the dashboard still reads it from the API, but the print payload drops it.)

- [ ] **Step 7: Drop the `topMovers` block from the cost payload**

Delete these lines from the returned `cost` block:

```ts
topMovers: {
  rising:  topMovers.data.rising  || [],
  falling: topMovers.data.falling || [],
},
```

Note: the `topMovers` variable in the destructuring stays (so we still fetch it in parallel — but we no longer surface it on page 1). Cheap insurance: we keep the parallel fetch in case pages 4+ want it later. If you want to drop the fetch entirely, remove `topMovers,` from the destructure list and the `getJSON<any>('/api/rm/top-movers?...')` line — but that's optional cleanup.

Actually do the cleanup: remove `topMovers,` from the destructure and the corresponding fetch line. The endpoint stays alive for other consumers; we just stop calling it here.

- [ ] **Step 8: Add the `territory` block to the returned payload**

Just before `efficiency: { … }` near the end of the return, add:

```ts
territory: {
  snapshot: territorySnap.data.snapshot || [],
},
```

- [ ] **Step 9: Add the additive efficiency fields**

In the returned `efficiency: { … }` block, after the existing `callouts,` line, add:

```ts
ticketsOpened: kpisEff.data.ticketsOpened ?? {
  value: 0, avgResponseHours: null, vsLM: null, contributors: [],
},
noActionOpen: kpisEff.data.noActionOpen ?? {
  value: 0, vsLM: 0, oldestSites: [],
},
waitingThirdParty: kpisEff.data.waitingThirdParty ?? {
  value: 0, vsLM: 0,
},
```

The `?? { … }` fallback handles the case where the API hasn't been deployed yet (e.g., during a staged rollout) so the print page never blows up.

- [ ] **Step 10: TS check**

```bash
cd "/Users/allen/Documents/PROJECTS/Sales dashboard" && npx tsc --noEmit 2>&1 | grep -E "buildReportPayload|CostPerformancePage" | head -30
```

Expected: no errors mentioning these two files. `CostPerformancePage` may show errors complaining about the missing `topMovers` and `fleetMedian` — that's expected, we fix it in Part 3.

- [ ] **Step 11: Commit**

```bash
git add lib/buildReportPayload.ts
git commit -m "feat(payload): extend ReportPayload with territory + additive efficiency fields"
```

---

# Part 3 — Page 1 visual rebuild

### Task 11: Extend `print.css` with new tile and territory styles

**Files:**
- Modify: `app/reports/rm/print/print.css`

We KEEP the existing `.cp-*` rules (page 1 styles) so the rewrite has familiar building blocks, and ADD the new ones for the snapshot layout.

- [ ] **Step 1: Update `.cp-kpi-strip` to allow custom column counts**

Find this rule (around line 305):

```css
.cp-kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6pt;
}
```

Leave it alone — it's still the 4-cost-tile row. We add modifier classes for other layouts.

- [ ] **Step 2: Add the lens-divider, two-metric-tile, contributor-list, and territory styles**

Append to the end of `print.css`:

```css
/* ── Page 1 (v2) snapshot additions ────────────────────────────────── */

/* Lens dividers — section labels with left border */
.cp-lens {
  display: flex;
  align-items: center;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.7pt;
  text-transform: uppercase;
  padding-left: 8pt;
  margin-top: 2pt;
  margin-bottom: 2pt;
}
.cp-lens-cost {
  border-left: 2.5pt solid #1e3a5f;
  color: #1e3a5f;
}
.cp-lens-eff {
  border-left: 2.5pt solid #ea580c;
  color: #ea580c;
}

/* Efficiency tile row — 2 tiles, each is a "two-metric" tile */
.cp-eff-strip {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6pt;
}
.cp-eff-tile {
  border: 0.5pt solid #e5e7eb;
  background: #f8fafc;
  border-radius: 4pt;
  padding: 8pt 10pt;
  display: flex;
  flex-direction: column;
  gap: 3pt;
}
.cp-eff-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8pt;
}
.cp-eff-metric-left,
.cp-eff-metric-right {
  display: flex;
  flex-direction: column;
  gap: 2pt;
}
.cp-eff-metric-right {
  text-align: right;
}
.cp-eff-metric-label {
  font-size: 6.5pt;
  font-weight: 700;
  letter-spacing: 0.4pt;
  text-transform: uppercase;
  color: #64748b;
}
.cp-eff-metric-value-big {
  font-size: 14pt;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.05;
}
.cp-eff-metric-value-sm {
  font-size: 11pt;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.1;
}
.cp-eff-metric-sub {
  font-size: 7pt;
  color: #475569;
}

/* Divider line in two-metric / contributor tiles */
.cp-tile-divider {
  border-bottom: 0.5pt solid #e5e7eb;
  margin: 6pt 0 4pt;
}

/* Contributor list (top 3 sites/tickets/breaches) */
.cp-contrib-label {
  font-size: 6.5pt;
  font-weight: 700;
  letter-spacing: 0.4pt;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 1pt;
}
.cp-contrib-list {
  display: flex;
  flex-direction: column;
  gap: 1pt;
}
.cp-contrib-row {
  display: flex;
  align-items: baseline;
  font-size: 7.5pt;
  gap: 4pt;
}
.cp-contrib-rank {
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  width: 8pt;
}
.cp-contrib-site {
  flex: 1;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-contrib-detail {
  color: #475569;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Trend chart bar value labels — rendered as <text> inside the SVG */
.cp-trend-bar-label {
  font-size: 7pt;
  font-weight: 600;
  fill: #0f172a;
}

/* Territory Snapshot strip */
.cp-territory {
  display: flex;
  flex-direction: column;
  gap: 4pt;
}
.cp-territory-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 2pt;
}
.cp-territory-title {
  font-size: 9pt;
  font-weight: 600;
  color: #0f172a;
}
.cp-territory-sub {
  font-size: 7pt;
  color: #64748b;
}
.cp-territory-row {
  display: grid;
  grid-template-columns: 70pt 1fr 50pt 60pt;
  gap: 10pt;
  align-items: center;
  font-size: 8pt;
}
.cp-territory-tm {
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.2pt;
}
.cp-territory-bar-track {
  height: 10pt;
  background: #f1f5f9;
  border-radius: 2pt;
  overflow: hidden;
}
.cp-territory-bar {
  display: block;
  height: 100%;
  border-radius: 2pt;
}
.cp-territory-bar-1 { background: #1e3a5f; }
.cp-territory-bar-2 { background: #3b82f6; }
.cp-territory-spend {
  text-align: right;
  font-weight: 600;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.cp-territory-yoy {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Chart heights — landscape page 1 needs charts a bit tighter */
.cp-chart-card-sm {
  /* SVG fills the container; height set inline on the inner div */
}

/* Title-row in chart cards: left label + right meta */
.cp-chart-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 2pt;
}
.cp-chart-meta {
  font-size: 7pt;
  color: #94a3b8;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/reports/rm/print/print.css
git commit -m "feat(print/css): add v2 page-1 styles (lens, eff-tile, territory)"
```

---

### Task 12: Update the page-1 title in the print route

**Files:**
- Modify: `app/reports/rm/print/page.tsx`

- [ ] **Step 1: Change the PageFrame title**

In `app/reports/rm/print/page.tsx`, around line 64, change:

```tsx
<PageFrame
  pageIndex={1}
  pageTotal={totalPages}
  pageTitle="Cost Performance"
  pageMeta={payload.cost.topCategory ? `Top category: ${payload.cost.topCategory.name}` : undefined}
  period={period}
>
```

to:

```tsx
<PageFrame
  pageIndex={1}
  pageTotal={totalPages}
  pageTitle="Cost & Operational Snapshot"
  pageMeta={payload.cost.topCategory ? `Top category: ${payload.cost.topCategory.name}` : undefined}
  period={period}
>
```

- [ ] **Step 2: Commit (don't push yet — we'll bundle with the component rewrite)**

```bash
git add app/reports/rm/print/page.tsx
git commit -m "feat(print): rename page 1 to 'Cost & Operational Snapshot'"
```

---

### Task 13: Rewrite `CostPerformancePage.tsx`

This is the biggest task. We replace the file wholesale — it's the cleanest path. The existing structure (KPI strip → charts → movers) is too rigid for the new layout (cost tiles → eff tiles → charts → territory).

**Files:**
- Modify: `components/print/CostPerformancePage.tsx` (full rewrite)

- [ ] **Step 1: Replace the file contents**

Replace the **entire** contents of `components/print/CostPerformancePage.tsx` with:

```tsx
'use client';
// components/print/CostPerformancePage.tsx
// Page 1 — Cost & Operational Snapshot.
//   4 cost tiles + 2 efficiency tiles + side-by-side Pareto / Trend
//   + Territory Snapshot strip.
import React from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer,
  Cell, CartesianGrid, LabelList,
} from 'recharts';
import type { ReportPayload } from '@/lib/buildReportPayload';
import { shortCategory } from '@/lib/categoryAbbrev';
import { Arrow } from './Arrow';
import { formatDelta } from '@/lib/format-delta';

interface Props {
  cost:       ReportPayload['cost'];
  efficiency: ReportPayload['efficiency'];
  territory:  ReportPayload['territory'];
}

function fmtCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPerLitre(n: number | null): string {
  if (n === null) return '—';
  const cents = n * 100;
  if (Math.abs(cents) >= 100) return `$${n.toFixed(2)}/L`;
  if (Math.abs(cents) >= 1)   return `${cents.toFixed(1)}¢/L`;
  return `${cents.toFixed(2)}¢/L`;
}

function fmtHours(n: number | null): string {
  if (n === null) return '—';
  return `${n.toFixed(1)}h`;
}

const PARETO_TIER_COLOR = ['#1e3a5f', '#3b82f6', '#93c5fd', '#cbd5e1'];

export default function CostPerformancePage({ cost, efficiency, territory }: Props) {
  // ── Pareto data ─────────────────────────────────────────────────
  const paretoData = cost.pareto.slice(0, 10).map(p => ({
    ...p,
    tier: p.cumulativePct <= 50 ? 0 : p.cumulativePct <= 80 ? 1 : p.cumulativePct <= 95 ? 2 : 3,
  }));
  const eightyIdx = paretoData.findIndex(p => p.cumulativePct >= 80);
  const paretoCaption = eightyIdx >= 0
    ? `${eightyIdx + 1} categories drive 80% of period spend`
    : `${paretoData.length} categories shown`;

  // ── Trend merged (bars for current year, lines for prior + budget) ─
  const trendMerged = cost.trend.current.map((p, i) => ({
    month:   p.month,
    current: p.value,
    prior:   cost.trend.priorYear[i]?.value ?? 0,
    budget:  cost.trend.budget[i]?.value    ?? 0,
  }));

  // ── Cost-tile deltas ────────────────────────────────────────────
  const ytdLy   = formatDelta(cost.ytd.vsLY,     'down');
  const ytdBud  = formatDelta(cost.ytd.vsBudget, 'down');
  const mtdLm   = formatDelta(cost.mtd.vsLM,     'down');
  const mtdBud  = formatDelta(cost.mtd.vsBudget, 'down');
  const cpLm    = formatDelta(cost.costPerLitre.vsLM, 'down');

  // ── Efficiency-tile deltas ──────────────────────────────────────
  const respLm  = formatDelta(efficiency.ticketsOpened.vsLM, 'down');
  // Backlog vsLM are integer count deltas, not percents — treat them as deltas where
  // up = bad (more open). We render with custom magnitude (no decimal).
  const noActLm = formatDelta(efficiency.noActionOpen.vsLM, 'down', { decimals: 0 });
  const waitLm  = formatDelta(efficiency.waitingThirdParty.vsLM, 'down', { decimals: 0 });

  // ── Territory bar tiers (top 2 navy, next 2 blue) ───────────────
  const tmRows = territory.snapshot.slice(0, 5);

  return (
    <div className="cp-wrap">
      {/* ── COST PERFORMANCE lens ──────────────────────────────── */}
      <div className="cp-lens cp-lens-cost">COST PERFORMANCE</div>

      {/* 4 cost KPI tiles */}
      <div className="cp-kpi-strip">
        {/* YTD */}
        <div className="cp-kpi">
          <div className="cp-kpi-label">YTD R&amp;M Cost</div>
          <div className="cp-kpi-value">{fmtCurrency(cost.ytd.value)}</div>
          <div className="cp-kpi-sub">
            <span className={ytdLy.cls}><Arrow direction={ytdLy.direction} />{ytdLy.magnitude}%</span> LY
            {' · '}
            <span className={ytdBud.cls}><Arrow direction={ytdBud.direction} />{ytdBud.magnitude}%</span> Bud
          </div>
        </div>

        {/* MTD */}
        <div className="cp-kpi">
          <div className="cp-kpi-label">MTD R&amp;M Cost</div>
          <div className="cp-kpi-value">{fmtCurrency(cost.mtd.value)}</div>
          <div className="cp-kpi-sub">
            <span className={mtdLm.cls}><Arrow direction={mtdLm.direction} />{mtdLm.magnitude}%</span> LM
            {' · '}
            <span className={mtdBud.cls}><Arrow direction={mtdBud.direction} />{mtdBud.magnitude}%</span> Bud
          </div>
        </div>

        {/* Cost / Litre */}
        <div className="cp-kpi">
          <div className="cp-kpi-label">Cost / Litre</div>
          <div className="cp-kpi-value">{fmtPerLitre(cost.costPerLitre.value)}</div>
          <div className="cp-kpi-sub">
            <span className={cpLm.cls}><Arrow direction={cpLm.direction} />{cpLm.magnitude}¢</span> vs LM
          </div>
        </div>

        {/* Top Category · MTD with top-3 contributors */}
        <div className="cp-kpi">
          <div className="cp-kpi-label">Top Category · MTD</div>
          <div className="cp-kpi-value cp-kpi-cat">{cost.topCategory?.name || '—'}</div>
          <div className="cp-kpi-sub">
            {cost.topCategory
              ? `${fmtCurrency(cost.topCategory.value)} · ${cost.topCategory.pctOfTotal.toFixed(0)}% of MTD`
              : 'no data'}
          </div>
          {cost.topCategory && cost.topCategory.contributors.length > 0 && (
            <>
              <div className="cp-tile-divider" />
              <div className="cp-contrib-label">Top contributors</div>
              <div className="cp-contrib-list">
                {cost.topCategory.contributors.map(c => (
                  <div key={c.rank} className="cp-contrib-row">
                    <span className="cp-contrib-rank">{c.rank}</span>
                    <span className="cp-contrib-site">{c.siteName}</span>
                    <span className="cp-contrib-detail">{fmtCurrency(c.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── OPERATIONAL EFFICIENCY lens ────────────────────────── */}
      <div className="cp-lens cp-lens-eff">OPERATIONAL EFFICIENCY</div>

      {/* 2 efficiency tiles (two-metric layout) */}
      <div className="cp-eff-strip">
        {/* Tile 5: Tickets Opened + Avg Response */}
        <div className="cp-eff-tile">
          <div className="cp-eff-row">
            <div className="cp-eff-metric-left">
              <div className="cp-eff-metric-label">Tickets Opened · MTD</div>
              <div className="cp-eff-metric-value-big">{efficiency.ticketsOpened.value}</div>
            </div>
            <div className="cp-eff-metric-right">
              <div className="cp-eff-metric-label">Avg Response</div>
              <div className="cp-eff-metric-value-sm">{fmtHours(efficiency.ticketsOpened.avgResponseHours)}</div>
              <div className="cp-eff-metric-sub">
                <span className={respLm.cls}>
                  <Arrow direction={respLm.direction} />{respLm.magnitude}h
                </span> LM
              </div>
            </div>
          </div>
          <div className="cp-tile-divider" />
          <div className="cp-contrib-label">Top contributing sites</div>
          <div className="cp-contrib-list">
            {efficiency.ticketsOpened.contributors.length === 0 ? (
              <div className="cp-contrib-row"><span className="cp-contrib-site" style={{ fontStyle: 'italic', color: '#94a3b8', fontWeight: 400 }}>no tickets in period</span></div>
            ) : (
              efficiency.ticketsOpened.contributors.map(c => (
                <div key={c.rank} className="cp-contrib-row">
                  <span className="cp-contrib-rank">{c.rank}</span>
                  <span className="cp-contrib-site">{c.siteName}</span>
                  <span className="cp-contrib-detail">{c.count} tickets</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tile 6: Backlog Health (no-action + waiting) */}
        <div className="cp-eff-tile">
          <div className="cp-eff-row">
            <div className="cp-eff-metric-left">
              <div className="cp-eff-metric-label">No-Action Open</div>
              <div className="cp-eff-metric-value-big">{efficiency.noActionOpen.value}</div>
              <div className="cp-eff-metric-sub">
                <span className={noActLm.cls}>
                  <Arrow direction={noActLm.direction} />{noActLm.magnitude}
                </span> LM
              </div>
            </div>
            <div className="cp-eff-metric-right">
              <div className="cp-eff-metric-label">Waiting 3rd Party</div>
              <div className="cp-eff-metric-value-sm">{efficiency.waitingThirdParty.value}</div>
              <div className="cp-eff-metric-sub">
                <span className={waitLm.cls}>
                  <Arrow direction={waitLm.direction} />{waitLm.magnitude}
                </span> LM
              </div>
            </div>
          </div>
          <div className="cp-tile-divider" />
          <div className="cp-contrib-label">Most un-actioned sites</div>
          <div className="cp-contrib-list">
            {efficiency.noActionOpen.oldestSites.length === 0 ? (
              <div className="cp-contrib-row"><span className="cp-contrib-site" style={{ fontStyle: 'italic', color: '#94a3b8', fontWeight: 400 }}>no open backlog</span></div>
            ) : (
              efficiency.noActionOpen.oldestSites.map(s => (
                <div key={s.rank} className="cp-contrib-row">
                  <span className="cp-contrib-rank">{s.rank}</span>
                  <span className="cp-contrib-site">{s.siteName}</span>
                  <span className="cp-contrib-detail">
                    {s.openCount} open{s.staleCount > 0 ? ` · ${s.staleCount} >30d` : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Charts row (Pareto + Trend, side by side) ──────────── */}
      <div className="cp-charts">
        <div className="cp-chart-card">
          <div className="cp-chart-header">
            <div className="cp-chart-title">Cost Pareto · by category</div>
            <div className="cp-chart-meta">MTD</div>
          </div>
          <div style={{ width: '100%', height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={paretoData} margin={{ top: 6, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 7 }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                  tickFormatter={(v: string) => shortCategory(v)}
                />
                <YAxis yAxisId="left"  tick={{ fontSize: 8 }} tickFormatter={(v) => fmtCurrency(v)} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 8 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Bar yAxisId="left" dataKey="value" isAnimationActive={false}>
                  {paretoData.map((p, i) => <Cell key={i} fill={PARETO_TIER_COLOR[p.tier]} />)}
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="cumulativePct" stroke="#dc2626" strokeWidth={1.6} dot={{ r: 2 }} isAnimationActive={false} />
                <ReferenceLine yAxisId="right" y={80} stroke="#dc2626" strokeDasharray="4 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 8, color: '#64748b', marginTop: 2 }}>{paretoCaption}</div>
        </div>

        <div className="cp-chart-card">
          <div className="cp-chart-header">
            <div className="cp-chart-title">Cost Trend · monthly</div>
            <div className="cp-chart-meta">
              <span style={{ background: '#1e3a5f', display: 'inline-block', width: 6, height: 6, marginRight: 3, verticalAlign: '-0px' }} />
              2026 &nbsp;
              <span style={{ borderTop: '1px dashed #94a3b8', display: 'inline-block', width: 8, marginRight: 3, verticalAlign: '2px' }} />
              2025 &nbsp;
              <span style={{ borderTop: '1px dashed #15803d', display: 'inline-block', width: 8, marginRight: 3, verticalAlign: '2px' }} />
              Bud
            </div>
          </div>
          <div style={{ width: '100%', height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendMerged} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 8 }} />
                <YAxis tick={{ fontSize: 8 }} tickFormatter={(v) => fmtCurrency(v)} />
                <Bar dataKey="current" fill="#1e3a5f" isAnimationActive={false} maxBarSize={22}>
                  <LabelList dataKey="current" position="top" className="cp-trend-bar-label"
                             formatter={(v: number) => v > 0 ? fmtCurrency(v) : ''} />
                </Bar>
                <Line type="monotone" dataKey="prior"  stroke="#94a3b8" strokeWidth={1.3} strokeDasharray="3 2" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="budget" stroke="#15803d" strokeWidth={1.3} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Territory Snapshot ─────────────────────────────────── */}
      <div className="cp-territory">
        <div className="cp-territory-header">
          <div className="cp-territory-title">Territory Snapshot · MTD spend &amp; YoY</div>
          <div className="cp-territory-sub">By Territory Manager</div>
        </div>
        {tmRows.length === 0 ? (
          <div style={{ fontSize: 8, color: '#94a3b8', fontStyle: 'italic' }}>no territory data in period</div>
        ) : (
          tmRows.map((tm, i) => {
            const barClass = i < 2 ? 'cp-territory-bar-1' : 'cp-territory-bar-2';
            const yoy = formatDelta(tm.yoyPct, 'down', { flatThreshold: 1 });
            return (
              <div key={tm.tmName} className="cp-territory-row">
                <span className="cp-territory-tm">{tm.tmName}</span>
                <span className="cp-territory-bar-track">
                  <span className={`cp-territory-bar ${barClass}`} style={{ width: `${tm.barPctOfMax}%` }} />
                </span>
                <span className="cp-territory-spend">{fmtCurrency(tm.mtdSpend)}</span>
                <span className={`cp-territory-yoy ${yoy.cls}`}>
                  <Arrow direction={yoy.direction} />{yoy.magnitude}% YoY
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the consumer in `app/reports/rm/print/page.tsx`**

Find the `<CostPerformancePage data={payload.cost} />` call (around line 68) and change it to:

```tsx
<CostPerformancePage
  cost={payload.cost}
  efficiency={payload.efficiency}
  territory={payload.territory}
/>
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd "/Users/allen/Documents/PROJECTS/Sales dashboard" && npx tsc --noEmit 2>&1 | grep -E "CostPerformancePage|print/page" | head -20
```

Expected: no errors. If there are errors, they'll be specific (missing imports, prop name typos) and should be fixed before commit.

- [ ] **Step 4: Visual preview in browser**

Start dev server (`npm run dev` in another terminal). Open in browser:

```
http://localhost:3000/reports/rm/preview?from=2026-04-01&to=2026-04-30
```

(The print route requires a HMAC token, but there's a separate preview route at `/reports/rm/preview` mentioned in the recon — verify it accepts these params. If not, generate a PDF via the dashboard "Generate Report" button and inspect the PDF.)

Eyeball the page:
- [ ] Header reads "Cost & Operational Snapshot" with "REDAN COUPON · R&M REPORT" eyebrow
- [ ] 4 cost tiles in a row; top-category tile shows top-3 contributors below a divider
- [ ] 2 efficiency tiles below, each with a two-metric layout + top-3 list
- [ ] All arrows render as solid triangles, not missing-glyph boxes
- [ ] Pareto chart + Trend chart side-by-side; Trend uses bars + dashed lines + green dashed budget reference
- [ ] Territory Snapshot below with horizontal bars + spend + YoY
- [ ] Whole page fits — no clipping at the bottom, no overflow into page 2

If the layout overflows: reduce the chart heights from 170 to 150 (in the `style={{ height: 170 }}` literals) and/or trim row gaps from 10pt → 8pt in `.cp-wrap` (CSS).

- [ ] **Step 5: Commit**

```bash
git add components/print/CostPerformancePage.tsx app/reports/rm/print/page.tsx
git commit -m "feat(print): rebuild page 1 as Cost & Operational Snapshot"
```

---

# Part 4 — End-to-end QA

### Task 14: Generate a real PDF and walk the acceptance criteria

This task is verification, not implementation. No commits.

- [ ] **Step 1: Generate a test PDF**

From the dashboard: open `http://localhost:3000/dashboard/rm`, select a period with known data (recommend a full month, e.g. April 2026), click "Generate Report". Save the PDF.

Alternatively from the command line:

```bash
curl -X POST "http://localhost:3000/api/reports/rm/generate" \
  -H "Content-Type: application/json" \
  -d '{"dateFrom":"2026-04-01","dateTo":"2026-04-30"}' \
  --output /tmp/test-page1.pdf
open /tmp/test-page1.pdf
```

- [ ] **Step 2: Walk the acceptance criteria**

Confirm each item from `docs/superpowers/specs/2026-05-19-rm-page-1-redesign-design.md`:

- [ ] PDF opens; every arrow renders cleanly (zero missing-glyph boxes)
- [ ] Header reads `REDAN COUPON · R&M REPORT`
- [ ] Filename is `Redan-Coupon-RM-Report-2026-04-01_to_2026-04-30.pdf`
- [ ] Page 1 has 4 cost tiles in row 1, 2 efficiency tiles in row 2, charts side-by-side, Territory Snapshot at bottom
- [ ] Top Category tile is MTD-scoped (verify by mental math against `kpis-cost?dateFrom=...&dateTo=...` response)
- [ ] Top Category tile shows top-3 contributors
- [ ] Cost/Litre tile shows only value + `▼/▲ vs LM` (no fleet median row)
- [ ] Tickets Opened tile shows count + avg response (hours) + top 3 contributing sites
- [ ] Backlog Health tile shows no-action count on left, waiting-3rd-party count on right, top 3 un-actioned sites with stale-30d count
- [ ] Cost Trend chart shows bars for current year + dashed line for prior year + horizontal dashed green for budget; bar values labelled above each bar
- [ ] Territory Snapshot shows 4–5 TM rows with horizontal bar, spend, signed YoY%
- [ ] Pages 2–6 render identically to before this PR (eyeball-diff against a saved baseline PDF)
- [ ] Existing dashboard at `/dashboard/rm` continues to render correctly
- [ ] PDF generates in <5s

- [ ] **Step 3: If any check fails, file follow-up tasks**

For each failed criterion, note the specific issue. Small issues (e.g., chart height off by 10pt, label colour wrong) get fixed in this PR. Bigger issues (e.g., territory snapshot showing wrong data, no-action count off) get filed as separate bugs and addressed before merging.

- [ ] **Step 4: Final commit if any polish needed**

```bash
git status
# review any uncommitted polish
git add -A
git commit -m "fix(print): page-1 polish from QA pass"
```

---

## Notes for the implementer

1. **Order matters.** Part 1 → Part 2 → Part 3 → Part 4. Within Part 2, Task 7 → Task 8 → Task 9 → Task 10. The payload-type update in Task 10 depends on the API changes in 7, 8, 9.

2. **Don't change `openTickets` semantics in `kpis-efficiency`.** It's documented as "open right now, ignores filters" and the dashboard relies on it. We add new fields instead.

3. **The existing `cost-trend` endpoint already returns `priorYearSeries` and `budgetSeries`.** The spec doc's reference to "add priorYear and budget" was an error in transcription from the v2 design. Use what's already there.

4. **If you spot the notes-not-printing bug while doing QA** — note it but don't fix it. It's a separate ticket. The spec explicitly defers it.

5. **`resolution_minutes` is a proxy for `avgResponseHours`.** This is documented in the spec. If the user pushes back on the number after seeing it, the right fix is to add a real first-response field upstream — not a quick patch here.

6. **Chart heights.** Set to 170pt per the design. If the page overflows, the safe reduction is to 150pt and/or `.cp-wrap { gap: 8pt; }` from 10pt.

7. **Recharts `<LabelList>` and bar value labels.** The `cp-trend-bar-label` CSS class uses `fill:` (SVG attribute) not `color:` — important because LabelList renders inside the SVG. If labels don't show in print, check that `printBackground: true` is set in the Puppeteer config (it is, in `lib/renderPdf.ts`).

8. **Territory rows ≤ 5.** The endpoint already orders by spend desc; we slice to 5 in the component as a safety. If the data has 6+ TMs (unlikely), tail rows are dropped — flag if discovered.

## Self-review notes

- All tasks reference exact files and line numbers.
- Brand rename + filename change have no associated test (they're string changes); covered by manual `grep` verification in Task 1 Step 2.
- The SVG-arrow + delta-formatter refactor is the only TDD'd piece — it's the one that justifies a test (pure logic with several branches).
- API route changes use manual `curl` verification because the repo has no API-route test framework. Following the established pattern.
- Visual changes (Tasks 11–13) verified end-to-end via Task 14's acceptance walk. Visual diff against a saved baseline catches regressions on pages 2–6.
- No placeholders or "TBDs" in any task. Every code block is complete and copy-pasteable.
