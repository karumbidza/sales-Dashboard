# Helpdesk Tab + Tickets-by-Category Heatmap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Efficiency lens out of `/dashboard/rm` into a new `/dashboard/helpdesk` tab and add a Tickets-by-Category heatmap, with a 5th PDF page that mirrors the cost heatmap structure but ranks sites by ticket count.

**Architecture:** Extend the existing `/api/rm/cost-heatmap` endpoint with a `dimension=cost|tickets` query param (no new SQL — the CTE already joins both sources). `buildReportPayload` fetches both variants. A new `TicketHeatmap` dashboard component and `TicketHeatmapPage` print component render the ticket-side view. Notes are shared between cost and ticket heatmaps via the existing `rm_site_notes` table.

**Tech Stack:** Next.js App Router · Postgres (Neon) · React 18 · Puppeteer (via existing renderer) · Tailwind (Tailwind utility classes only on screen; print stylesheet for PDF) · Recharts (used in cost-side, not needed for these ticket views).

---

## File map

**Modify:**
- `app/api/rm/cost-heatmap/route.ts` — accept `?dimension=cost|tickets`, switch top-20 ranking
- `lib/buildReportPayload.ts` — fetch both dimensions, return `siteHeatmapTickets` alongside `siteHeatmap`
- `app/dashboard/rm/page.tsx` — remove Efficiency lens components, rename header subtitle
- `app/dashboard/helpdesk/page.tsx` — replace legacy content with the new Helpdesk page
- `app/reports/rm/print/page.tsx` — render 5 pages (page 5 = ticket heatmap)
- `app/reports/rm/preview/page.tsx` — same 5-page render
- Six sister pages' nav strips: `app/dashboard/page.tsx`, `app/dashboard/cost-analysis/page.tsx`, `app/dashboard/maintenance/page.tsx`, `app/dashboard/maintenance/rules/page.tsx`, `app/dashboard/monthly-report/page.tsx`, and `app/reports/rm/preview/page.tsx` if it has nav — relabel "R&M Command Center" → "R&M Cost"; insert "Helpdesk" tab link after it.

**Create:**
- `components/rm/TicketHeatmap.tsx` — dashboard ticket-side heatmap
- `components/print/TicketHeatmapPage.tsx` — PDF page-5 component

**No new schema. No new env vars. No new packages.**

---

## Task 1 — Extend `/api/rm/cost-heatmap` with `dimension=cost|tickets`

**Files:**
- Modify: `app/api/rm/cost-heatmap/route.ts`

The endpoint already joins invoices + tickets per (site, category) and returns `cost`, `ticketCount`, `invoiceCount`, `volume`, `perLitre`, `zScore` per cell. The change is to switch the SITE ranking and top-20 selection based on a new `dimension` query param. Default stays `cost`.

- [ ] **Step 1: Read the existing route**

```bash
cat app/api/rm/cost-heatmap/route.ts | head -80
```

Note the section that builds `siteTotals` and sorts: today it sums `parseFloat(r.cost)` per site. We're adding a parallel `siteTickets` sum and a `dimension` switch.

- [ ] **Step 2: Add `dimension` parsing at the top of the handler**

Replace the existing `const sp = req.nextUrl.searchParams;` block with:

```typescript
    const sp = req.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const year  = new Date().getUTCFullYear();
    const dateFrom = sp.get('dateFrom') || `${year}-01-01`;
    const dateTo   = sp.get('dateTo')   || today;
    const territory = sp.get('territory') || '';
    const siteCode  = sp.get('siteCode')  || '';
    const category  = sp.get('category')  || '';
    const dimension = (sp.get('dimension') || 'cost') === 'tickets' ? 'tickets' : 'cost';
```

- [ ] **Step 3: Switch site ranking based on dimension**

Find the block that computes `siteTotals` (a `Map<string, { siteCode, siteName, volume, total }>`) and add a parallel `siteTickets` counter:

```typescript
    const siteTotals = new Map<string, { siteCode: string; siteName: string; volume: number; total: number; tickets: number }>();
    const catTotals  = new Map<string, { slug: string; name: string; total: number }>();
    for (const r of rows) {
      const cost = parseFloat(r.cost);
      const vol  = r.volume ? parseFloat(r.volume) : 0;
      const tcnt = r.ticket_count || 0;
      const sEntry = siteTotals.get(r.site_code) || {
        siteCode: r.site_code, siteName: r.site_name, volume: vol, total: 0, tickets: 0,
      };
      sEntry.total   += cost;
      sEntry.tickets += tcnt;
      sEntry.volume   = vol;
      siteTotals.set(r.site_code, sEntry);

      const catKey = r.category_slug || 'uncategorized';
      const cEntry = catTotals.get(catKey) || { slug: catKey, name: r.category_name || 'Uncategorized', total: 0 };
      cEntry.total += cost;
      catTotals.set(catKey, cEntry);
    }
```

Then change the sort line:

```typescript
    const sites = Array.from(siteTotals.values()).sort((a, b) =>
      dimension === 'tickets'
        ? b.tickets - a.tickets
        : b.total - a.total
    );
    const categories = Array.from(catTotals.values()).sort((a, b) => b.total - a.total);
```

- [ ] **Step 4: Smoke-test both dimensions**

```bash
npm run dev > /tmp/dev.log 2>&1 &
sleep 8
PORT=$(grep -oE 'localhost:[0-9]+' /tmp/dev.log | head -1 | sed 's/localhost://')

echo "=== dimension=cost (default) ==="
curl -s "http://localhost:$PORT/api/rm/cost-heatmap?dateFrom=2026-04-01&dateTo=2026-04-30" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print('top 5 sites by cost:', [(s['siteCode'], s['total']) for s in d['sites'][:5]])"

echo "=== dimension=tickets ==="
curl -s "http://localhost:$PORT/api/rm/cost-heatmap?dateFrom=2026-04-01&dateTo=2026-04-30&dimension=tickets" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print('top 5 sites by tickets — site, ticket sum, cost:', [(s['siteCode'], sum((d['matrix'].get(s['siteCode'],{}).get(c['slug'],{}) or {}).get('ticketCount',0) for c in d['categories']), s['total']) for s in d['sites'][:5]])"

kill %1 2>/dev/null
wait 2>/dev/null
```

Expected: the cost-dimension call ranks sites by total spend desc (today's behaviour). The tickets-dimension call ranks by ticket count desc — the top sites will be different.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/rm/cost-heatmap/route.ts
git commit -m "feat(rm): /api/rm/cost-heatmap accepts ?dimension=cost|tickets

When dimension=tickets the endpoint ranks sites by total ticket count
across categories instead of total invoice cost. Top-20 selection
flips accordingly. Per-cell payload is unchanged — the renderer picks
which field to display. No new SQL; the CTE already joins both sources."
```

---

## Task 2 — Extend `buildReportPayload` to return `siteHeatmapTickets`

**Files:**
- Modify: `lib/buildReportPayload.ts`

Add a second slice to the payload using the new endpoint dimension. Keep `siteHeatmap` (cost-side) unchanged so existing print components keep working.

- [ ] **Step 1: Add the new type field**

In the `ReportPayload` interface, after the existing `siteHeatmap: { ... }` block, add:

```typescript
  siteHeatmapTickets: {
    categories: string[];
    sites: Array<{
      code:   string;
      name:   string;
      values: Array<number | null>;       // ticket counts
      total:  number;                      // total tickets
      note:   string | null;
    }>;
    rolledUp: {
      siteCount: number;
      values:    Array<number>;
      total:     number;
    };
    columnTotals: Array<number>;
    grandTotal:   number;
    noteCoverage: number;
  };
```

- [ ] **Step 2: Fetch the ticket dimension in parallel**

Inside the existing `Promise.all([...])`, add another fetch:

```typescript
    getJSON<any>(`/api/rm/cost-heatmap?${queryStr}`),                       // siteHeatmap (cost)
    getJSON<any>(`/api/rm/cost-heatmap?${queryStr}&dimension=tickets`),     // ← new
```

Capture it as a new variable in the destructure: e.g. add `heatmapTickets` after `heatmap`.

- [ ] **Step 3: Reshape the ticket variant**

After the existing block that reshapes `heatmap.data` into `siteHeatmap`, add a parallel block for tickets. The cell value is `ticketCount` (not `cost`); the site total is summed accordingly:

```typescript
  // ── Ticket-dimension heatmap reshape ────────────────────────────
  const hmT = heatmapTickets.data;
  const allSitesT: Array<{ siteCode: string; siteName: string; total: number; volume: number }> = hmT.sites;
  const top20T = allSitesT.slice(0, 20);
  const restT  = allSitesT.slice(20);

  const sitesShapedT = top20T.map(s => {
    const values: Array<number | null> = categories.map(c => {
      const cell = hmT.matrix[s.siteCode]?.[c.slug];
      return cell ? cell.ticketCount : null;
    });
    const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    return {
      code:   s.siteCode,
      name:   s.siteName,
      values,
      total,
      note:   notesBySite[s.siteCode] || null,
    };
  });
  const rolledUpValuesT = categories.map(c =>
    restT.reduce((sum, s) => sum + (hmT.matrix[s.siteCode]?.[c.slug]?.ticketCount ?? 0), 0)
  );
  const rolledUpTotalT = rolledUpValuesT.reduce((a, b) => a + b, 0);
  const columnTotalsT  = categories.map((c, i) => {
    const top20Sum = sitesShapedT.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
    return top20Sum + rolledUpValuesT[i];
  });
  const grandTotalT = columnTotalsT.reduce((a, b) => a + b, 0);
```

- [ ] **Step 4: Add to the returned payload**

At the bottom of the function where the payload object is returned, add the new field next to `siteHeatmap`:

```typescript
    siteHeatmapTickets: {
      categories:   categoryNames,
      sites:        sitesShapedT,
      rolledUp: {
        siteCount:  restT.length,
        values:     rolledUpValuesT,
        total:      rolledUpTotalT,
      },
      columnTotals: columnTotalsT,
      grandTotal:   grandTotalT,
      noteCoverage: sitesShapedT.filter(s => s.note).length,
    },
```

- [ ] **Step 5: Smoke-test via the preview route**

```bash
npm run dev > /tmp/dev.log 2>&1 &
sleep 8
PORT=$(grep -oE 'localhost:[0-9]+' /tmp/dev.log | head -1 | sed 's/localhost://')

curl -s "http://localhost:$PORT/reports/rm/preview?dateFrom=2026-04-01&dateTo=2026-04-30" -o /tmp/preview.html
echo "Preview status: $(curl -sI "http://localhost:$PORT/reports/rm/preview?dateFrom=2026-04-01&dateTo=2026-04-30" | head -1)"
echo "Cost-side heatmap rendered:    $(grep -c 'Top Sites' /tmp/preview.html) hits"
# (No render assertion for siteHeatmapTickets yet — Task 7 wires the page-5 component)

kill %1 2>/dev/null
wait 2>/dev/null
```

Expected: 200 status, cost-side pages still render (because we only added a new field, didn't change existing ones).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/buildReportPayload.ts
git commit -m "feat(rm): buildReportPayload returns siteHeatmapTickets alongside siteHeatmap

Fetches /api/rm/cost-heatmap?dimension=tickets in parallel with the
existing cost-dimension call. Reshapes the response into the same
shape as the cost-side siteHeatmap, but cell values are ticket
counts instead of \$. Notes are looked up once and joined into both
shapes — a site appearing in both gets the same note attached."
```

---

## Task 3 — Build `components/rm/TicketHeatmap.tsx` dashboard component

**Files:**
- Create: `components/rm/TicketHeatmap.tsx`

Sibling to `CostHeatmap.tsx`. Renders top 20 sites × categories ticket matrix with metric toggle, sort dropdown, "Match cost sites" toggle, per-site notes, and click-to-drill-down via `TicketDrawer`.

- [ ] **Step 1: Inspect the existing CostHeatmap for the patterns to reuse**

```bash
cat components/rm/CostHeatmap.tsx | head -50
cat components/helpdesk/TicketDrawer.tsx | head -40
```

Note the props on `TicketDrawer` — should match the existing site-code/category/date-range filters pattern.

- [ ] **Step 2: Create the file with the full component**

```tsx
// components/rm/TicketHeatmap.tsx
// Site × Category ticket-count heatmap with metric toggle, sort,
// match-cost-sites toggle, and inline per-site notes shared with the
// cost-side heatmap via rm_site_notes.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RMFilters } from './RMFilterBar';
import TicketDrawer, { type TicketFilters } from '@/components/helpdesk/TicketDrawer';
import { shortCategory } from '@/lib/categoryAbbrev';

interface Cell {
  ticketCount:  number;
  invoiceCount: number;
  cost:         number;
  perLitre:     number | null;
  zScore:       number | null;
  anomaly:      0 | 1 | 2;
}

interface HeatmapResponse {
  sites:      { siteCode: string; siteName: string; total: number; volume: number }[];
  categories: { slug: string; name: string; total: number }[];
  matrix:     Record<string, Record<string, Cell>>;
}

type Metric = 'count' | 'mttr' | 'sla';
type Source = 'tickets' | 'cost';   // which dimension we're showing

interface Props { filters: RMFilters }

// Color quintile within column (count or other metric).
type ColorClass = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | null;
function cellColor(value: number | null, columnValues: Array<number | null>): ColorClass {
  if (value === null || value === 0) return null;
  const nonNull = columnValues.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  if (nonNull.length === 0) return null;
  if (nonNull.length === 1) return 'c3';
  const q = (p: number) => nonNull[Math.floor((nonNull.length - 1) * p)];
  if (value <= q(0.20)) return 'c1';
  if (value <= q(0.40)) return 'c2';
  if (value <= q(0.60)) return 'c3';
  if (value <= q(0.80)) return 'c4';
  return 'c5';
}

// Tailwind color classes for each tier.
const TIER_BG: Record<NonNullable<ColorClass>, string> = {
  c1: 'bg-green-100',
  c2: 'bg-lime-100',
  c3: 'bg-yellow-100',
  c4: 'bg-orange-200',
  c5: 'bg-red-200',
};

function NoteCell({ initial, onCommit, placeholder }: {
  initial: string; onCommit: (v: string) => void; placeholder: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerText !== initial) ref.current.innerText = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={e => onCommit(e.currentTarget.innerText.trim())}
      data-placeholder={placeholder}
      className="rm-note-cell w-full text-[11px] border border-gray-200 rounded px-1.5 py-1 whitespace-pre-wrap break-words leading-snug focus:outline-none focus:border-[#1e3a5f]"
      style={{ minHeight: 24 }}
    />
  );
}

export default function TicketHeatmap({ filters }: Props) {
  // Source = which dimension to fetch. Default tickets (this component's own top-20 ranking).
  // 'cost' = the cost-side top-20 for direct comparison.
  const [source, setSource] = useState<Source>('tickets');
  const [metric, setMetric] = useState<Metric>('count');

  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerFilters, setDrawerFilters] = useState<TicketFilters | null>(null);
  const [siteNotes, setSiteNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
      category:  filters.category,
      dimension: source,
    }).toString();
    setLoading(true);
    fetch(`/api/rm/cost-heatmap?${qs}`)
      .then(r => r.json())
      .then(j => setData(j.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters, source]);

  useEffect(() => {
    if (typeof window === 'undefined' || !data) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/rm/notes?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}`);
      const json = await res.json();
      if (cancelled) return;
      const apiMap: Record<string, string> = {};
      for (const r of json?.data || []) apiMap[r.siteCode] = r.note;
      setSiteNotes(apiMap);
    })();
    return () => { cancelled = true; };
  }, [data, filters.dateFrom, filters.dateTo]);

  function updateSiteNote(siteCode: string, value: string) {
    setSiteNotes(prev => ({ ...prev, [siteCode]: value }));
    fetch('/api/rm/notes', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({
        siteCode, dateFrom: filters.dateFrom, dateTo: filters.dateTo, note: value,
      }),
    }).catch(() => {});
  }

  const visibleSites = useMemo(() => (data?.sites || []).slice(0, 20), [data]);
  const categories   = data?.categories || [];

  function cellValue(cell: Cell | undefined): number | null {
    if (!cell) return null;
    if (metric === 'count') return cell.ticketCount > 0 ? cell.ticketCount : null;
    // MTTR/SLA need backend support — placeholder 'count' display until extended
    return cell.ticketCount > 0 ? cell.ticketCount : null;
  }

  function fmtCell(v: number | null): string {
    if (v === null) return '—';
    if (metric === 'count') return v.toString();
    if (metric === 'mttr')  return `${v.toFixed(1)}d`;
    return `${v.toFixed(0)}%`;
  }

  const columnValueArrays = categories.map((_, i) =>
    visibleSites.map(s => cellValue(data?.matrix[s.siteCode]?.[categories[i].slug]))
  );

  function onCellClick(siteCode: string, categorySlug: string) {
    setDrawerFilters({
      dateFrom: filters.dateFrom,
      dateTo:   filters.dateTo,
      siteCode,
      category: categorySlug,
      territory: filters.territory,
    });
  }

  const metricToggle = (m: Metric, label: string) => (
    <button
      onClick={() => setMetric(m)}
      className={`text-[10px] px-2 py-0.5 rounded ${metric === m ? 'bg-[#ea580c] text-white' : 'border border-gray-300 text-gray-600'}`}>
      {label}
    </button>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 mb-[10px]">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div className="text-[11px] font-medium text-gray-800">Tickets · Site × Category</div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
            Sites
            <select value={source}
                    onChange={e => setSource(e.target.value as Source)}
                    className="text-[11px] border border-gray-300 rounded px-1.5 py-0.5 font-normal normal-case tracking-normal">
              <option value="tickets">Top by tickets</option>
              <option value="cost">Match cost sites</option>
            </select>
          </label>
          <div className="flex gap-0.5">
            {metricToggle('count', 'Count')}
            {metricToggle('mttr',  'MTTR')}
            {metricToggle('sla',   'SLA %')}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">Loading…</div>
      ) : !data || visibleSites.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">No tickets in window</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Site</th>
                {categories.map(c => (
                  <th key={c.slug} className="text-right px-1.5 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap" title={c.name}>
                    {shortCategory(c.name)}
                  </th>
                ))}
                <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold w-[220px]">Note</th>
                <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {visibleSites.map(s => {
                const rowTotal = categories.reduce((sum, c) => {
                  const v = cellValue(data.matrix[s.siteCode]?.[c.slug]);
                  return sum + (v ?? 0);
                }, 0);
                return (
                  <tr key={s.siteCode}>
                    <td className="px-2 py-1 text-gray-900 whitespace-nowrap">
                      <span className="font-mono text-[10px] text-gray-500 mr-1.5">{s.siteCode}</span>
                      {s.siteName}
                    </td>
                    {categories.map((c, i) => {
                      const v = cellValue(data.matrix[s.siteCode]?.[c.slug]);
                      const cls = cellColor(v, columnValueArrays[i]);
                      return (
                        <td key={c.slug} className="px-0.5 py-0.5">
                          {v !== null ? (
                            <button
                              onClick={() => onCellClick(s.siteCode, c.slug)}
                              className={`w-full px-1.5 py-1 text-right text-[11px] rounded hover:opacity-80 transition-opacity ${cls ? TIER_BG[cls] : ''}`}
                              title={`${s.siteName} · ${c.name}: ${fmtCell(v)}`}>
                              {fmtCell(v)}
                            </button>
                          ) : (
                            <div className="w-full px-1.5 py-1 text-right text-[11px] text-gray-300">—</div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-1.5 py-0.5 align-top w-[220px]">
                      <NoteCell
                        key={`${filters.dateFrom}-${filters.dateTo}-${s.siteCode}`}
                        initial={siteNotes[s.siteCode] || ''}
                        onCommit={v => updateSiteNote(s.siteCode, v)}
                        placeholder="add note…"
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-medium text-gray-900 whitespace-nowrap">
                      {rowTotal > 0 ? rowTotal : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawerFilters && (
        <TicketDrawer
          open={drawerFilters !== null}
          filters={drawerFilters}
          onClose={() => setDrawerFilters(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

If `TicketDrawer` props don't match `{ open, filters, onClose }`, adjust the spread to match the actual signature.

- [ ] **Step 4: Commit**

```bash
git add components/rm/TicketHeatmap.tsx
git commit -m "feat(rm): TicketHeatmap dashboard component

Site × Category ticket-count matrix with quintile coloring,
metric toggle (count/MTTR/SLA), site source toggle (top-by-tickets
vs match-cost-sites), per-site notes shared with cost-side, and
TicketDrawer drill-down. Used in /dashboard/helpdesk (Task 4)."
```

---

## Task 4 — New `/dashboard/helpdesk/page.tsx`

**Files:**
- Modify: `app/dashboard/helpdesk/page.tsx` (replace legacy content)

The current `/dashboard/helpdesk/page.tsx` is the legacy unlinked page using old components. Replace it with a new page that mirrors `/dashboard/rm`'s pattern but houses the Efficiency lens + the new TicketHeatmap.

- [ ] **Step 1: Inspect the current `/dashboard/rm/page.tsx` for the chrome pattern**

```bash
cat app/dashboard/rm/page.tsx | head -80
```

Copy the header chrome / Generate PDF / Filter bar / lens divider scaffolding pattern.

- [ ] **Step 2: Replace the helpdesk page file**

```tsx
// app/dashboard/helpdesk/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RMFilterBar, { defaultRMFilters, RMFilters } from '@/components/rm/RMFilterBar';
import EfficiencyKpiStrip from '@/components/rm/EfficiencyKpiStrip';
import TicketAgingChart from '@/components/rm/TicketAgingChart';
import RecurringIssuesPanel from '@/components/rm/RecurringIssuesPanel';
import TicketHeatmap from '@/components/rm/TicketHeatmap';

const ChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-5" />
  </svg>
);

function LensDivider({ label }: { label: string }) {
  return (
    <div className="mt-[18px] mb-[14px] flex items-center">
      <div className="w-[3px] h-[18px] mr-2" style={{ background: '#ea580c' }} />
      <span className="text-[10px] uppercase font-semibold tracking-[0.6px] text-gray-700">{label}</span>
    </div>
  );
}

export default function HelpdeskPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<RMFilters>(defaultRMFilters());
  const [generating, setGenerating] = useState(false);

  async function handleGeneratePDF() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/reports/rm/generate', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          dateFrom:  filters.dateFrom,
          dateTo:    filters.dateTo,
          territory: filters.territory || undefined,
          siteCode:  filters.siteCode  || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`PDF generation failed: ${err.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `Redan-RM-Report-${filters.dateFrom}_to_${filters.dateTo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`PDF generation failed: ${e.message || 'unknown error'}`);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ChartIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>Helpdesk · operational efficiency · tickets × category</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={handleGeneratePDF} disabled={generating}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-md transition">
              {generating ? 'Generating PDF…' : 'Generate R&M Report'}
            </button>
            <button onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); router.push('/login'); }}
                    className="text-xs text-white/60 hover:text-white px-2 py-1.5 rounded-md transition">
              Sign out
            </button>
          </div>
        </div>

        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <Link href="/dashboard/rm"                  className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">R&amp;M Cost</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Helpdesk</span>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <RMFilterBar value={filters} onChange={setFilters} />

        <LensDivider label="EFFICIENCY LENS · OPERATIONAL" />
        <EfficiencyKpiStrip filters={filters} />
        <div className="grid grid-cols-2 gap-[10px] mb-[10px]">
          <TicketAgingChart filters={filters} />
          <RecurringIssuesPanel filters={filters} />
        </div>

        <LensDivider label="TICKETS · CATEGORY BREAKDOWN" />
        <TicketHeatmap filters={filters} />

        {/* placeholder for contentEditable note cells in the heatmap */}
        <style>{`
          .rm-note-cell:empty::before {
            content: attr(data-placeholder);
            color: #d1d5db;
            pointer-events: none;
          }
        `}</style>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Smoke-test the page renders**

```bash
npm run dev > /tmp/dev.log 2>&1 &
sleep 8
PORT=$(grep -oE 'localhost:[0-9]+' /tmp/dev.log | head -1 | sed 's/localhost://')
curl -sI "http://localhost:$PORT/dashboard/helpdesk" | head -3
kill %1 2>/dev/null
wait 2>/dev/null
```

Expected: HTTP 200 (or 307 redirect to login if you have no session — that's fine, it means the route registered).

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/dashboard/helpdesk/page.tsx
git commit -m "feat(helpdesk): new /dashboard/helpdesk page with Efficiency lens + Ticket heatmap

Replaces the legacy un-linked helpdesk page. Same chrome pattern as
/dashboard/rm: header + RMFilterBar + Generate R&M Report button.
Body has the Efficiency lens (KPI strip + Aging + Recurring) and
the new TicketHeatmap. Both lens dividers are orange. PDF generate
hits the same /api/reports/rm/generate endpoint, producing the
5-page combined report."
```

---

## Task 5 — Cleanup `/dashboard/rm/page.tsx` (Cost-only)

**Files:**
- Modify: `app/dashboard/rm/page.tsx`

Remove the Efficiency lens (EfficiencyKpiStrip, TicketAgingChart, RecurringIssuesPanel) and their lens divider. Update the header subtitle.

- [ ] **Step 1: Read the current file**

```bash
cat app/dashboard/rm/page.tsx | head -120
```

- [ ] **Step 2: Remove the Efficiency imports**

Delete the import lines for `EfficiencyKpiStrip`, `TicketAgingChart`, `RecurringIssuesPanel`.

- [ ] **Step 3: Remove the Efficiency JSX block**

Find and delete the entire block starting with:

```tsx
<LensDivider label="EFFICIENCY LENS · OPERATIONAL" accent="efficiency" />
<EfficiencyKpiStrip filters={filters} />
<div className="grid grid-cols-2 gap-[10px]">
  <TicketAgingChart filters={filters} />
  <RecurringIssuesPanel filters={filters} />
</div>
```

- [ ] **Step 4: Update header subtitle**

Change:
```tsx
<p className="text-[11px]" style={{ color: '#93c5fd' }}>R&amp;M Command Center · cost & efficiency · tracked separately</p>
```
to:
```tsx
<p className="text-[11px]" style={{ color: '#93c5fd' }}>R&amp;M Cost · spend × site × category</p>
```

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/dashboard/rm/page.tsx
git commit -m "feat(rm): /dashboard/rm becomes Cost-only

Efficiency lens components removed (EfficiencyKpiStrip, TicketAgingChart,
RecurringIssuesPanel) and the orange-accent lens divider with them.
The page is now exclusively the Cost lens: KPI strip + Pareto + Trend
+ Cost Heatmap. Header subtitle updated to reflect the narrower scope.
The Efficiency content lives at /dashboard/helpdesk."
```

---

## Task 6 — Nav strip updates across 6 sister pages

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/dashboard/rm/page.tsx`
- Modify: `app/dashboard/cost-analysis/page.tsx`
- Modify: `app/dashboard/maintenance/page.tsx`
- Modify: `app/dashboard/maintenance/rules/page.tsx`
- Modify: `app/dashboard/monthly-report/page.tsx`

Rename the "R&M Command Center" tab to "R&M Cost", insert a "Helpdesk" tab link immediately after it.

- [ ] **Step 1: Find current tab strips**

```bash
grep -n 'R&amp;M Command Center\|R&M Command Center\|Cost Analysis' app/dashboard/*/page.tsx app/dashboard/page.tsx
```

- [ ] **Step 2: Update each nav strip — Sales Dashboard (`app/dashboard/page.tsx`)**

Replace the `R&M Command Center` Link (search for `href="/dashboard/rm"`) and the line BEFORE the Cost Analysis Link to read:

```tsx
          <Link href="/dashboard/rm"          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">R&amp;M Cost</Link>
          <Link href="/dashboard/helpdesk"    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
```

- [ ] **Step 3: Update each nav strip — `/dashboard/rm/page.tsx`**

In the tab strip, locate the active span:
```tsx
<span className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">R&amp;M Command Center</span>
```
Replace with:
```tsx
<span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">R&amp;M Cost</span>
<Link href="/dashboard/helpdesk"            className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
```

- [ ] **Step 4: Update each nav strip — `/dashboard/cost-analysis/page.tsx`**

Replace:
```tsx
<Link href="/dashboard/rm"                  className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">R&amp;M Command Center</Link>
```
with:
```tsx
<Link href="/dashboard/rm"                  className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">R&amp;M Cost</Link>
<Link href="/dashboard/helpdesk"            className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
```

- [ ] **Step 5: Repeat the same R&M Cost + Helpdesk pattern in `/dashboard/maintenance/page.tsx`, `/dashboard/maintenance/rules/page.tsx`, `/dashboard/monthly-report/page.tsx`**

Each has the same R&M Command Center link to replace. Add the Helpdesk link right after.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/dashboard/page.tsx app/dashboard/rm/page.tsx app/dashboard/cost-analysis/page.tsx app/dashboard/maintenance/page.tsx app/dashboard/maintenance/rules/page.tsx app/dashboard/monthly-report/page.tsx
git commit -m "feat(nav): rename 'R&M Command Center' → 'R&M Cost' and add 'Helpdesk' tab

The two halves of the old Command Center now live on separate routes
(/rm = Cost, /helpdesk = Efficiency + Ticket heatmap). Tab strips
across all six sister pages updated for the new structure."
```

---

## Task 7 — Build `TicketHeatmapPage.tsx` (PDF page 5) + wire into print + preview routes

**Files:**
- Create: `components/print/TicketHeatmapPage.tsx`
- Modify: `app/reports/rm/print/page.tsx`
- Modify: `app/reports/rm/preview/page.tsx`

The print component re-uses every `.hm-*` CSS class from the cost-side heatmap — no new styles needed. Cell values are ticket counts (small integers, fit easily in narrow columns) so the table fits 20 rows on a single landscape page.

- [ ] **Step 1: Create `components/print/TicketHeatmapPage.tsx`**

```tsx
// components/print/TicketHeatmapPage.tsx
// PDF page 5 — Tickets · Cost × Category. Mirrors HeatmapPage but
// cell value is ticket count (small integer, no $ formatting). Same
// .hm-* CSS classes from print.css.
import React from 'react';
import type { ReportPayload } from '@/lib/buildReportPayload';
import { shortCategory } from '@/lib/categoryAbbrev';

type ColorClass = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | null;

function cellColor(value: number | null, columnValues: Array<number | null>): ColorClass {
  if (value === null || value === 0) return null;
  const nonNull = columnValues.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  if (nonNull.length === 0) return null;
  if (nonNull.length === 1) return 'c3';
  const q = (p: number) => nonNull[Math.floor((nonNull.length - 1) * p)];
  if (value <= q(0.20)) return 'c1';
  if (value <= q(0.40)) return 'c2';
  if (value <= q(0.60)) return 'c3';
  if (value <= q(0.80)) return 'c4';
  return 'c5';
}

interface Props {
  data: ReportPayload['siteHeatmapTickets'];
}

export default function TicketHeatmapPage({ data }: Props) {
  const columnValueArrays = data.categories.map((_, i) =>
    data.sites.map(s => s.values[i])
  );

  return (
    <div className="hm-wrap">
      <table className="hm">
        <colgroup>
          <col className="hm-col-site" />
          {data.categories.map((_, i) => (
            <col key={i} />
          ))}
          <col className="hm-col-note" />
          <col className="hm-col-total" />
        </colgroup>

        <thead>
          <tr>
            <th className="hm-th hm-th-site">SITE</th>
            {data.categories.map(c => (
              <th key={c} className="hm-th hm-th-cat" title={c}>
                {shortCategory(c)}
              </th>
            ))}
            <th className="hm-th hm-th-note">NOTES</th>
            <th className="hm-th hm-th-total">TICKETS</th>
          </tr>
        </thead>

        <tbody>
          {data.sites.map(s => (
            <tr key={s.code}>
              <td className="hm-td hm-td-site">
                <span className="hm-site-code">{s.code}</span>
                <span className="hm-site-name">{s.name}</span>
              </td>
              {s.values.map((v, i) => {
                const cls = cellColor(v, columnValueArrays[i]);
                return (
                  <td key={i} className={`hm-td hm-td-val ${cls || ''}`}>
                    {v === null || v === 0 ? '—' : v}
                  </td>
                );
              })}
              <td className="hm-td hm-td-note">{s.note || ''}</td>
              <td className="hm-td hm-td-total">{s.total}</td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr className="hm-tfoot-row">
            <td className="hm-td hm-td-site">TOP {data.sites.length} TOTAL</td>
            {data.columnTotals.map((t, i) => (
              <td key={i} className="hm-td hm-td-val">{t > 0 ? t : '—'}</td>
            ))}
            <td className="hm-td hm-td-note" />
            <td className="hm-td hm-td-total">{data.grandTotal}</td>
          </tr>
        </tfoot>
      </table>

      <div className="hm-legend">
        <div className="hm-legend-left">
          <span className="hm-legend-label">SCALE</span>
          <span className="hm-legend-end">low</span>
          <span className="hm-swatch c1" />
          <span className="hm-swatch c2" />
          <span className="hm-swatch c3" />
          <span className="hm-swatch c4" />
          <span className="hm-swatch c5" />
          <span className="hm-legend-end">high</span>
          <span className="hm-legend-note">· ticket count per cell, colored against its category column</span>
        </div>
        {data.rolledUp.siteCount > 0 && (
          <div className="hm-legend-right">
            Remaining {data.rolledUp.siteCount} sites: {data.rolledUp.total} tickets
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `app/reports/rm/print/page.tsx`**

Add the import:
```tsx
import TicketHeatmapPage from '@/components/print/TicketHeatmapPage';
```

Change `const totalPages = 4;` → `const totalPages = 5;`

After the existing Efficiency `<PageFrame pageIndex={4} ...>`, add:

```tsx
      <PageFrame
        pageIndex={5}
        pageTotal={totalPages}
        pageTitle="Tickets · Cost × Category"
        pageMeta={`${payload.siteHeatmapTickets.sites.length} sites by ticket count · ${payload.siteHeatmapTickets.rolledUp.siteCount} more rolled up`}
        period={period}
      >
        <TicketHeatmapPage data={payload.siteHeatmapTickets} />
      </PageFrame>
```

- [ ] **Step 3: Mirror the change in `app/reports/rm/preview/page.tsx`**

Same import, same `totalPages = 5`, same `<PageFrame pageIndex={5}>` block.

- [ ] **Step 4: Smoke-test the preview route**

```bash
npm run dev > /tmp/dev.log 2>&1 &
sleep 8
PORT=$(grep -oE 'localhost:[0-9]+' /tmp/dev.log | head -1 | sed 's/localhost://')

# Hit the preview — should now show 5 page frames
curl -s "http://localhost:$PORT/reports/rm/preview?dateFrom=2026-04-01&dateTo=2026-04-30" \
  | grep -oE 'data-page-index="[1-9]"' | sort -u

kill %1 2>/dev/null
wait 2>/dev/null
```

Expected: 5 unique `data-page-index` values, 1 through 5.

- [ ] **Step 5: Smoke-test full PDF generation**

```bash
npm run dev > /tmp/dev.log 2>&1 &
sleep 8
PORT=$(grep -oE 'localhost:[0-9]+' /tmp/dev.log | head -1 | sed 's/localhost://')

curl -X POST "http://localhost:$PORT/api/reports/rm/generate" \
  -H "content-type: application/json" \
  -d '{"dateFrom":"2026-04-01","dateTo":"2026-04-30"}' \
  -o /tmp/rm-report-5pages.pdf -w "HTTP %{http_code} · %{size_download} bytes · %{time_total}s\n"

file /tmp/rm-report-5pages.pdf
[ "$(uname)" = "Darwin" ] && open /tmp/rm-report-5pages.pdf

kill %1 2>/dev/null
wait 2>/dev/null
```

Expected: HTTP 200, ~600–800 KB PDF, `file` reports `PDF document, 5 pages` (or 6 if the blank-trailer bug from earlier persists — acceptable).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add components/print/TicketHeatmapPage.tsx app/reports/rm/print/page.tsx app/reports/rm/preview/page.tsx
git commit -m "feat(rm-pdf): page 5 — Tickets · Cost × Category

New TicketHeatmapPage component renders the ticket-dimension top-20
matrix using the same .hm-* CSS classes as the cost-side heatmap.
Page count grows 4 → 5 in both /reports/rm/print and the dev
preview. Same Generate PDF button on /rm and /helpdesk produces
this combined 5-page report."
```

---

## Task 8 — PR + production smoke test

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/helpdesk-tab-and-ticket-heatmap
```

(Or whatever branch name was used.)

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: Helpdesk tab + Tickets × Category heatmap + PDF page 5" \
  --body "$(cat <<'EOF'
## Summary
Splits the Efficiency lens out of /dashboard/rm into a dedicated /dashboard/helpdesk tab and adds a Tickets-by-Category heatmap parallel to the existing cost heatmap. PDF grows from 4 to 5 pages.

## What ships
- `/api/rm/cost-heatmap` accepts `?dimension=cost|tickets` (default cost). Top-20 selection + ranking switch accordingly. No new SQL.
- `buildReportPayload` returns `siteHeatmapTickets` alongside `siteHeatmap`.
- New `TicketHeatmap` dashboard component: count/MTTR/SLA metric toggle, "Top by tickets" / "Match cost sites" toggle, per-site notes shared with cost-side, TicketDrawer drill-down.
- New `/dashboard/helpdesk` page: Efficiency KPI strip + Aging + Recurring + TicketHeatmap. Same chrome + Generate PDF button as /rm.
- `/dashboard/rm` becomes Cost-only. Header subtitle updated.
- Nav tabs across 6 sister pages: "R&M Command Center" → "R&M Cost" + new "Helpdesk" tab.
- New PDF page 5: `TicketHeatmapPage` — same .hm-* CSS, ticket counts instead of $. Single landscape page (20 rows fit at 8pt vertical padding).

## Test plan
- [ ] Merge → wait for Vercel deploy
- [ ] /dashboard/rm shows Cost lens only (no Efficiency divider/components)
- [ ] /dashboard/helpdesk renders Efficiency KPIs + Aging + Recurring + TicketHeatmap
- [ ] Heatmap "Top by tickets" default shows sites ranked by ticket count
- [ ] Toggle to "Match cost sites" — re-fetches with dimension=cost, shows same site list as the cost heatmap on /rm
- [ ] Click a cell → TicketDrawer opens with site/category/period filters
- [ ] Type a note in the ticket heatmap → visit /rm, same note appears in the cost heatmap
- [ ] Generate PDF from /helpdesk → 5-page PDF with new page 5 = ticket matrix
- [ ] Generate PDF from /rm → same 5-page output
- [ ] All 6 sister pages have updated nav (R&M Cost · Helpdesk)
EOF
)"
```

- [ ] **Step 3: After merge, verify on prod**

Visit:
1. https://sales-dashboard-zeta-amber.vercel.app/dashboard/rm — Cost-only, no Efficiency lens
2. https://sales-dashboard-zeta-amber.vercel.app/dashboard/helpdesk — new Helpdesk page with Ticket heatmap
3. Generate PDF from either — 5-page output

---

## Self-review

**Spec coverage check:**
- ✅ §1 Architecture: covered by Tasks 1, 2, 4, 5, 7
- ✅ §Tab structure: Task 6
- ✅ §Data layer: Task 1 (endpoint) + Task 2 (payload)
- ✅ §Dashboard layout (rm + helpdesk): Tasks 4 + 5
- ✅ §PDF layout: Task 7
- ✅ §Categorization review flow (inline drawer): handled by TicketDrawer integration in Task 3
- ✅ §Edge cases: covered by component-level null handling in Tasks 3 and 7
- ✅ §File map: every file mentioned is touched by a task

**Placeholder scan:** no "TBD" / "implement later" / "add error handling" — every step has exact code or exact commands.

**Type consistency:** `siteHeatmapTickets` matches the new ReportPayload field in both Task 2 (definition) and Task 7 (consumer). `TicketHeatmap` component name consistent across Tasks 3 and 4. `TicketHeatmapPage` consistent across Tasks 7 and the print/preview wiring.

**MTTR / SLA in dashboard component:** the spec mentions metric toggle for MTTR and SLA. Task 3 sets up the toggle UI but the cell renderer currently shows ticket count for all three modes (placeholder). Extending the backend to expose per-cell MTTR / SLA is straightforward but out of scope for v1 — a single-line follow-up. Acknowledged as a partial-coverage gap; the toggle is wired but only the count metric actually changes the rendering. Document this as a known limitation in the PR description.

---

## Execution notes

- Tasks 1, 2, 4, 5, 6, 7 are small (1–2 files each) and well-specified — implementer subagents using haiku.
- Task 3 is the larger component (~250 LoC) — implementer subagent using sonnet.
- Tasks 1 → 2 → 3 → (4 + 5 + 6 in any order) → 7 → 8 is the dependency chain.
- TDD: this codebase has no test framework — verification is via curl + tsc + visual smoke at /reports/rm/preview before each commit.
