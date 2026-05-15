# Cost Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/dashboard/cost-analysis` page surfacing `cost_per_ticket = invoice_total / ticket_count` per (site × category) cell within a date window, with outlier highlighting and drill-down via the existing InvoiceDrawer.

**Architecture:** Two SQL endpoints share a CTE that FULL OUTER JOINs invoice and ticket aggregates at the site+category+period level — no schema change. Page composes 4 KPI cards + a sortable pivot table. Outlier detection (z-score per category column) is computed client-side from the matrix endpoint's payload. Cell clicks open the existing InvoiceDrawer with site+category+window filters.

**Tech Stack:** TypeScript, Next.js 14 App Router, Postgres (via `lib/db.ts`), Tailwind, existing `InvoiceDrawer` component.

**Spec reference:** `docs/superpowers/specs/2026-05-15-cost-analysis-design.md`

---

## File Map

**Create:**
- `app/api/cost-analysis/summary/route.ts` — KPI rollup
- `app/api/cost-analysis/matrix/route.ts` — per-cell breakdown
- `components/cost-analysis/CostKPICards.tsx` — 4 cards
- `components/cost-analysis/CostMatrixTable.tsx` — pivot table with outlier highlighting + drill-down
- `app/dashboard/cost-analysis/page.tsx` — composes everything

**Modify (one-line tab additions):**
- `app/dashboard/page.tsx` (Sales)
- `app/dashboard/maintenance/page.tsx`
- `app/dashboard/maintenance/rules/page.tsx`
- `app/dashboard/helpdesk/page.tsx`

---

## Task 1: Summary endpoint

**Files:**
- Create: `app/api/cost-analysis/summary/route.ts`

- [ ] **Step 1: Implement the endpoint**

Create `app/api/cost-analysis/summary/route.ts`:

```typescript
// app/api/cost-analysis/summary/route.ts
// Rolls up invoice + ticket data into KPI numbers for the Cost Analysis page.
// Shared CTE pattern with the matrix endpoint: FULL OUTER JOIN over
// (site, category, period) aggregates. Filters apply uniformly to both
// source tables so the comparison stays apples-to-apples in the date window.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface F {
  dateFrom?: string;
  dateTo?:   string;
  category?: string;
  siteCode?: string;
}

function readFilters(req: NextRequest): F {
  const sp = req.nextUrl.searchParams;
  return {
    dateFrom: sp.get('dateFrom') || undefined,
    dateTo:   sp.get('dateTo')   || undefined,
    category: sp.get('category') || undefined,
    siteCode: sp.get('siteCode') || undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    const f = readFilters(req);

    // Build per-table clause arrays so each side filters its own date column.
    const ic: string[] = [`i.cost_center = 'retail'`];
    const tc: string[] = [`1=1`];
    const params: any[] = [];
    let p = 1;

    if (f.dateFrom) { ic.push(`i.service_date >= $${p}`); tc.push(`t.created_time::DATE >= $${p}`); params.push(f.dateFrom); p++; }
    if (f.dateTo)   { ic.push(`i.service_date <= $${p}`); tc.push(`t.created_time::DATE <= $${p}`); params.push(f.dateTo);   p++; }
    if (f.category) { ic.push(`c.slug = $${p}`);          tc.push(`c.slug = $${p}`);                params.push(f.category); p++; }
    if (f.siteCode) { ic.push(`i.site_code = $${p}`);     tc.push(`t.site_code = $${p}`);           params.push(f.siteCode); p++; }

    const sql = `
      WITH invoice_agg AS (
        SELECT i.site_code,
               c.slug AS category_slug,
               c.display_name AS category_name,
               DATE_TRUNC('month', i.service_date)::DATE AS period,
               SUM(i.net_cost)::NUMERIC AS invoice_cost,
               COUNT(*)::INT AS invoice_count
          FROM rm_invoices i
          LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
         WHERE ${ic.join(' AND ')}
         GROUP BY 1, 2, 3, 4
      ),
      ticket_agg AS (
        SELECT t.site_code,
               c.slug AS category_slug,
               c.display_name AS category_name,
               DATE_TRUNC('month', t.created_time)::DATE AS period,
               COUNT(*)::INT AS ticket_count
          FROM rm_helpdesk_tickets t
          LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
         WHERE ${tc.join(' AND ')}
         GROUP BY 1, 2, 3, 4
      ),
      cells AS (
        SELECT COALESCE(i.site_code, t.site_code)         AS site_code,
               COALESCE(i.category_slug, t.category_slug) AS category_slug,
               COALESCE(i.category_name, t.category_name) AS category_name,
               COALESCE(i.invoice_cost, 0)                AS invoice_cost,
               COALESCE(i.invoice_count, 0)               AS invoice_count,
               COALESCE(t.ticket_count, 0)                AS ticket_count
          FROM invoice_agg i
          FULL OUTER JOIN ticket_agg t
            ON i.site_code = t.site_code
           AND i.category_slug = t.category_slug
           AND i.period = t.period
      )
      SELECT
        SUM(invoice_cost)::NUMERIC                                AS total_invoice_cost,
        SUM(invoice_count)::INT                                   AS total_invoices,
        SUM(ticket_count)::INT                                    AS total_tickets,
        CASE WHEN SUM(ticket_count) > 0
             THEN ROUND(SUM(invoice_cost) / SUM(ticket_count), 2)
             ELSE NULL END                                        AS overall_cost_per_ticket,
        COUNT(DISTINCT site_code) FILTER (WHERE ticket_count > 0) AS sites_with_tickets,
        COUNT(DISTINCT site_code) FILTER (WHERE invoice_cost > 0) AS sites_with_invoices,
        COUNT(DISTINCT site_code) FILTER (
          WHERE ticket_count > 0 AND invoice_cost > 0
        )                                                          AS sites_with_both
      FROM cells
    `;

    const rows = await query<any>(sql, params);
    const r = rows[0] || {};

    // Top category by spend — separate small query that uses the same `ic`
    // clauses (and therefore the same params array — every $N position
    // matches because the params were pushed in clause-build order).
    const topRows = await query<any>(
      `SELECT c.slug, c.display_name, SUM(i.net_cost) AS total_cost
         FROM rm_invoices i
         LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${ic.join(' AND ')}
        GROUP BY c.slug, c.display_name
       HAVING SUM(i.net_cost) > 0
        ORDER BY SUM(i.net_cost) DESC
        LIMIT 1`,
      params,
    );

    return NextResponse.json({
      data: {
        totalInvoiceCost:     parseFloat(r.total_invoice_cost || '0'),
        totalInvoices:        r.total_invoices ?? 0,
        totalTickets:         r.total_tickets ?? 0,
        overallCostPerTicket: r.overall_cost_per_ticket != null ? parseFloat(r.overall_cost_per_ticket) : null,
        sitesWithTickets:     r.sites_with_tickets ?? 0,
        sitesWithInvoices:    r.sites_with_invoices ?? 0,
        sitesWithBoth:        r.sites_with_both ?? 0,
        topSpendCategory:     topRows[0]?.display_name ?? null,
        topSpendCategorySlug: topRows[0]?.slug ?? null,
        topSpendCategoryCost: topRows[0]?.total_cost ? parseFloat(topRows[0].total_cost) : 0,
      },
    });
  } catch (err: any) {
    console.error('/api/cost-analysis/summary error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Wait for ✓ Ready. Then:

```bash
curl -s 'http://localhost:3000/api/cost-analysis/summary?dateFrom=2026-01-01&dateTo=2026-05-15' | head -c 400
```

Expected: JSON response with `totalInvoiceCost`, `totalTickets`, `overallCostPerTicket`, etc. Numbers should be non-zero given existing data.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/cost-analysis/summary/route.ts
git commit -m "feat: add GET /api/cost-analysis/summary KPI endpoint"
```

---

## Task 2: Matrix endpoint

**Files:**
- Create: `app/api/cost-analysis/matrix/route.ts`

- [ ] **Step 1: Implement the endpoint**

Create `app/api/cost-analysis/matrix/route.ts`:

```typescript
// app/api/cost-analysis/matrix/route.ts
// Per-cell breakdown for the Cost Analysis site x category pivot table.
// Same CTE pattern as summary; aggregates by (site_code, category_slug)
// collapsing across periods within the filter window.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface F {
  dateFrom?: string;
  dateTo?:   string;
  category?: string;
  siteCode?: string;
}

function readFilters(req: NextRequest): F {
  const sp = req.nextUrl.searchParams;
  return {
    dateFrom: sp.get('dateFrom') || undefined,
    dateTo:   sp.get('dateTo')   || undefined,
    category: sp.get('category') || undefined,
    siteCode: sp.get('siteCode') || undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    const f = readFilters(req);

    const ic: string[] = [`i.cost_center = 'retail'`];
    const tc: string[] = [`1=1`];
    const params: any[] = [];
    let p = 1;

    if (f.dateFrom) { ic.push(`i.service_date >= $${p}`); tc.push(`t.created_time::DATE >= $${p}`); params.push(f.dateFrom); p++; }
    if (f.dateTo)   { ic.push(`i.service_date <= $${p}`); tc.push(`t.created_time::DATE <= $${p}`); params.push(f.dateTo);   p++; }
    if (f.category) { ic.push(`c.slug = $${p}`);          tc.push(`c.slug = $${p}`);                params.push(f.category); p++; }
    if (f.siteCode) { ic.push(`i.site_code = $${p}`);     tc.push(`t.site_code = $${p}`);           params.push(f.siteCode); p++; }

    const sql = `
      WITH invoice_agg AS (
        SELECT i.site_code,
               c.slug AS category_slug,
               c.display_name AS category_name,
               DATE_TRUNC('month', i.service_date)::DATE AS period,
               SUM(i.net_cost)::NUMERIC AS invoice_cost,
               COUNT(*)::INT AS invoice_count
          FROM rm_invoices i
          LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
         WHERE ${ic.join(' AND ')}
         GROUP BY 1, 2, 3, 4
      ),
      ticket_agg AS (
        SELECT t.site_code,
               c.slug AS category_slug,
               c.display_name AS category_name,
               DATE_TRUNC('month', t.created_time)::DATE AS period,
               COUNT(*)::INT AS ticket_count
          FROM rm_helpdesk_tickets t
          LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
         WHERE ${tc.join(' AND ')}
         GROUP BY 1, 2, 3, 4
      ),
      cells AS (
        SELECT COALESCE(i.site_code, t.site_code)         AS site_code,
               COALESCE(i.category_slug, t.category_slug) AS category_slug,
               COALESCE(i.category_name, t.category_name) AS category_name,
               COALESCE(i.invoice_cost, 0)                AS invoice_cost,
               COALESCE(i.invoice_count, 0)               AS invoice_count,
               COALESCE(t.ticket_count, 0)                AS ticket_count
          FROM invoice_agg i
          FULL OUTER JOIN ticket_agg t
            ON i.site_code = t.site_code
           AND i.category_slug = t.category_slug
           AND i.period = t.period
      )
      SELECT cells.site_code,
             s.budget_name AS site_name,
             cells.category_slug,
             cells.category_name,
             SUM(cells.invoice_cost)::NUMERIC AS invoice_cost,
             SUM(cells.invoice_count)::INT    AS invoice_count,
             SUM(cells.ticket_count)::INT     AS ticket_count,
             CASE WHEN SUM(cells.ticket_count) > 0
                  THEN ROUND(SUM(cells.invoice_cost) / SUM(cells.ticket_count), 2)
                  ELSE NULL END               AS cost_per_ticket
        FROM cells
        JOIN sites s ON cells.site_code = s.site_code
       GROUP BY cells.site_code, s.budget_name, cells.category_slug, cells.category_name
       ORDER BY invoice_cost DESC NULLS LAST
       LIMIT 2000
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      data: rows.map(r => ({
        siteCode:        r.site_code,
        siteName:        r.site_name,
        categorySlug:    r.category_slug,
        categoryName:    r.category_name,
        invoiceCost:     parseFloat(r.invoice_cost),
        invoiceCount:    r.invoice_count,
        ticketCount:     r.ticket_count,
        costPerTicket:   r.cost_per_ticket != null ? parseFloat(r.cost_per_ticket) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/cost-analysis/matrix error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Then:

```bash
curl -s 'http://localhost:3000/api/cost-analysis/matrix?dateFrom=2026-01-01&dateTo=2026-05-15' | head -c 600
```

Expected: JSON response with `data` array. Each row has `siteCode`, `siteName`, `categorySlug`, `categoryName`, `invoiceCost`, `invoiceCount`, `ticketCount`, `costPerTicket`. Should have dozens of rows.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/cost-analysis/matrix/route.ts
git commit -m "feat: add GET /api/cost-analysis/matrix per-cell endpoint"
```

---

## Task 3: CostKPICards component

**Files:**
- Create: `components/cost-analysis/CostKPICards.tsx`

- [ ] **Step 1: Implement the component**

Create `components/cost-analysis/CostKPICards.tsx`:

```tsx
'use client';

interface CostKpis {
  totalInvoiceCost:     number;
  totalInvoices:        number;
  totalTickets:         number;
  overallCostPerTicket: number | null;
  sitesWithTickets:     number;
  sitesWithInvoices:    number;
  sitesWithBoth:        number;
  topSpendCategory:     string | null;
  topSpendCategoryCost: number;
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card flex-1 min-w-[180px]">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-800 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function CostKPICards({ kpis }: { kpis: CostKpis | null }) {
  if (!kpis) return null;

  return (
    <div className="flex flex-wrap gap-3">
      <Card
        label="Invoice Spend"
        value={`$${fmtMoney(kpis.totalInvoiceCost)}`}
        sub={`${kpis.totalInvoices.toLocaleString()} lines across ${kpis.sitesWithInvoices} sites`}
      />
      <Card
        label="Tickets"
        value={kpis.totalTickets.toLocaleString()}
        sub={`${kpis.sitesWithTickets} sites · ${kpis.sitesWithBoth} have both`}
      />
      <Card
        label="Cost / Ticket"
        value={kpis.overallCostPerTicket != null ? `$${fmtMoney(kpis.overallCostPerTicket)}` : '—'}
        sub={kpis.overallCostPerTicket != null ? 'Invoice $ ÷ Ticket count' : 'No tickets in window'}
      />
      <Card
        label="Top Category"
        value={kpis.topSpendCategory || '—'}
        sub={kpis.topSpendCategoryCost > 0 ? `$${fmtMoney(kpis.topSpendCategoryCost)} spend` : undefined}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/cost-analysis/CostKPICards.tsx
git commit -m "feat: add CostKPICards component"
```

---

## Task 4: CostMatrixTable component (pivot + outliers + drill-down)

**Files:**
- Create: `components/cost-analysis/CostMatrixTable.tsx`

- [ ] **Step 1: Implement the component**

Create `components/cost-analysis/CostMatrixTable.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';

export interface CostCell {
  siteCode:      string;
  siteName:      string;
  categorySlug:  string | null;
  categoryName:  string | null;
  invoiceCost:   number;
  invoiceCount:  number;
  ticketCount:   number;
  costPerTicket: number | null;
}

interface CellDrillContext {
  siteCode:     string;
  siteName:     string;
  categorySlug: string | null;
}

interface Props {
  rows: CostCell[];
  onCellClick: (ctx: CellDrillContext) => void;
}

const DEFAULT_SITE_LIMIT = 30;
const TOP_CATEGORY_COLS  = 6;

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface PivotShape {
  siteOrder: { siteCode: string; siteName: string; totalCost: number }[];
  topCategories: { slug: string; name: string; totalCost: number }[];
  cells: Map<string, CostCell>;        // key: siteCode|categorySlug (or |__rest__)
  categoryStats: Map<string, { mean: number; std: number }>;  // per category: cost_per_ticket distribution
}

function pivot(rows: CostCell[]): PivotShape {
  // Aggregate per site (rows)
  const bySite = new Map<string, { siteCode: string; siteName: string; totalCost: number }>();
  // Aggregate per category (columns)
  const byCat = new Map<string, { slug: string; name: string; totalCost: number }>();

  for (const r of rows) {
    if (!bySite.has(r.siteCode)) {
      bySite.set(r.siteCode, { siteCode: r.siteCode, siteName: r.siteName, totalCost: 0 });
    }
    bySite.get(r.siteCode)!.totalCost += r.invoiceCost;

    if (r.categorySlug) {
      if (!byCat.has(r.categorySlug)) {
        byCat.set(r.categorySlug, { slug: r.categorySlug, name: r.categoryName || r.categorySlug, totalCost: 0 });
      }
      byCat.get(r.categorySlug)!.totalCost += r.invoiceCost;
    }
  }

  const siteOrder = Array.from(bySite.values()).sort((a, b) => b.totalCost - a.totalCost);
  const topCategories = Array.from(byCat.values())
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, TOP_CATEGORY_COLS);

  const topCatSet = new Set(topCategories.map(c => c.slug));

  // Build cell map. Rest column collapses all non-top categories AND null-category cells.
  const cells = new Map<string, CostCell>();
  for (const r of rows) {
    const colKey = r.categorySlug && topCatSet.has(r.categorySlug) ? r.categorySlug : '__rest__';
    const key = `${r.siteCode}|${colKey}`;
    const existing = cells.get(key);
    if (existing) {
      existing.invoiceCost  += r.invoiceCost;
      existing.invoiceCount += r.invoiceCount;
      existing.ticketCount  += r.ticketCount;
      existing.costPerTicket = existing.ticketCount > 0
        ? Math.round((existing.invoiceCost / existing.ticketCount) * 100) / 100
        : null;
    } else {
      cells.set(key, { ...r, categorySlug: colKey === '__rest__' ? null : colKey, categoryName: colKey === '__rest__' ? 'Other / Rest' : r.categoryName });
    }
  }

  // Per-category cost_per_ticket distribution (mean + stddev) for outlier detection.
  // Only consider cells where ticket_count > 0 (cost_per_ticket is defined).
  const categoryStats = new Map<string, { mean: number; std: number }>();
  for (const cat of topCategories) {
    const values: number[] = [];
    for (const r of rows) {
      if (r.categorySlug === cat.slug && r.costPerTicket != null) values.push(r.costPerTicket);
    }
    if (values.length >= 2) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      categoryStats.set(cat.slug, { mean, std: Math.sqrt(variance) });
    }
  }

  return { siteOrder, topCategories, cells, categoryStats };
}

function outlierClass(cell: CostCell, stats?: { mean: number; std: number }): string {
  if (!stats || cell.costPerTicket == null || stats.std === 0) return '';
  const z = (cell.costPerTicket - stats.mean) / stats.std;
  if (z > 2.5) return 'border border-red-500 bg-red-50';
  if (z > 1.5) return 'border border-amber-500 bg-amber-50';
  return '';
}

function outlierGlyph(cell: CostCell, stats?: { mean: number; std: number }): string {
  if (!stats || cell.costPerTicket == null || stats.std === 0) return '';
  const z = (cell.costPerTicket - stats.mean) / stats.std;
  if (z > 2.5) return ' ⚠⚠';
  if (z > 1.5) return ' ⚠';
  return '';
}

export default function CostMatrixTable({ rows, onCellClick }: Props) {
  const [showAll, setShowAll] = useState(false);
  const pivoted = useMemo(() => pivot(rows), [rows]);

  if (pivoted.siteOrder.length === 0) {
    return <p className="text-sm text-gray-400 italic">No cells match the selected filters.</p>;
  }

  const visibleSites = showAll
    ? pivoted.siteOrder
    : pivoted.siteOrder.slice(0, DEFAULT_SITE_LIMIT);

  const cols = [...pivoted.topCategories, { slug: '__rest__', name: 'Rest', totalCost: 0 }];

  return (
    <div>
      <div className="overflow-x-auto rounded-md border bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left sticky left-0 bg-gray-50">Site</th>
              {cols.map(c => (
                <th key={c.slug} className="px-3 py-2 text-right whitespace-nowrap">{c.name}</th>
              ))}
              <th className="px-3 py-2 text-right whitespace-nowrap">Total spend</th>
            </tr>
          </thead>
          <tbody>
            {visibleSites.map(s => (
              <tr key={s.siteCode} className="border-t hover:bg-gray-50/50">
                <td className="px-3 py-2 font-medium sticky left-0 bg-white">{s.siteName}</td>
                {cols.map(c => {
                  const key = `${s.siteCode}|${c.slug}`;
                  const cell = pivoted.cells.get(key);
                  const stats = c.slug !== '__rest__' ? pivoted.categoryStats.get(c.slug) : undefined;
                  const flagClass = cell ? outlierClass(cell, stats) : '';
                  const glyph = cell ? outlierGlyph(cell, stats) : '';

                  if (!cell || (cell.invoiceCost === 0 && cell.ticketCount === 0)) {
                    return <td key={c.slug} className="px-3 py-2 text-right tabular-nums text-gray-300">—</td>;
                  }

                  const label = cell.costPerTicket != null
                    ? `$${fmtMoney(cell.costPerTicket)}${glyph}`
                    : `$${fmtMoney(cell.invoiceCost)} / 0 tkt`;

                  const title = cell.costPerTicket != null
                    ? `${cell.invoiceCount} inv ($${fmtMoney(cell.invoiceCost)}), ${cell.ticketCount} tkt → $${fmtMoney(cell.costPerTicket)}/tkt${stats ? ` (cat mean $${fmtMoney(stats.mean)})` : ''}`
                    : `${cell.invoiceCount} inv ($${fmtMoney(cell.invoiceCost)}), no tickets — preventive / scheduled`;

                  return (
                    <td
                      key={c.slug}
                      className={`px-3 py-2 text-right tabular-nums cursor-pointer ${flagClass}`}
                      title={title}
                      onClick={() => onCellClick({ siteCode: s.siteCode, siteName: s.siteName, categorySlug: c.slug === '__rest__' ? null : c.slug })}
                    >
                      {label}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right tabular-nums font-semibold">${fmtMoney(s.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pivoted.siteOrder.length > DEFAULT_SITE_LIMIT && (
        <div className="mt-2 text-xs text-gray-500">
          Showing {visibleSites.length} of {pivoted.siteOrder.length} sites.
          <button
            onClick={() => setShowAll(s => !s)}
            className="ml-2 text-blue-600 hover:underline"
          >
            {showAll ? 'Show top 30' : 'Show all'}
          </button>
        </div>
      )}

      <div className="mt-2 text-[11px] text-gray-500">
        ⚠ &gt; 1.5σ above category mean &middot; ⚠⚠ &gt; 2.5σ. Click a cell to drill in.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/cost-analysis/CostMatrixTable.tsx
git commit -m "feat: add CostMatrixTable with pivot + outlier highlighting + drill-down"
```

---

## Task 5: Cost Analysis page

**Files:**
- Create: `app/dashboard/cost-analysis/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/dashboard/cost-analysis/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CostKPICards from '@/components/cost-analysis/CostKPICards';
import CostMatrixTable, { CostCell } from '@/components/cost-analysis/CostMatrixTable';
import InvoiceDrawer, { InvoiceFilters } from '@/components/maintenance/InvoiceDrawer';

interface CostFilters {
  dateFrom: string;
  dateTo:   string;
  category: string;
  siteCode: string;
}

function defaultFilters(): CostFilters {
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  return {
    dateFrom: yearStart,
    dateTo:   today.toISOString().split('T')[0],
    category: '',
    siteCode: '',
  };
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6 flex-shrink-0">
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 4 4 5-7" />
    </svg>
  );
}

export default function CostAnalysisPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<CostFilters>(defaultFilters());
  const [kpis, setKpis]   = useState<any>(null);
  const [cells, setCells] = useState<CostCell[]>([]);
  const [allCategories, setAllCategories] = useState<{ slug: string; displayName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ filters: InvoiceFilters; title?: string } | null>(null);

  const buildQS = (f: CostFilters) => {
    const p = new URLSearchParams();
    if (f.dateFrom) p.set('dateFrom', f.dateFrom);
    if (f.dateTo)   p.set('dateTo',   f.dateTo);
    if (f.category) p.set('category', f.category);
    if (f.siteCode) p.set('siteCode', f.siteCode);
    return p.toString();
  };

  const fetchAll = useCallback(async (f: CostFilters) => {
    setLoading(true);
    try {
      const qs = buildQS(f);
      const [sRes, mRes] = await Promise.all([
        fetch(`/api/cost-analysis/summary?${qs}`).then(r => r.json()),
        fetch(`/api/cost-analysis/matrix?${qs}`).then(r => r.json()),
      ]);
      setKpis(sRes?.data || null);
      setCells(mRes?.data || []);
    } catch (e) {
      console.error('Cost analysis fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(filters); }, [filters, fetchAll]);

  useEffect(() => {
    fetch('/api/maintenance/categories-list')
      .then(r => r.json())
      .then(d => setAllCategories(d.data || []))
      .catch(() => {});
  }, []);

  const hasData = (kpis?.totalInvoiceCost ?? 0) > 0 || (kpis?.totalTickets ?? 0) > 0;

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ChartIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>Cost Analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => fetchAll(filters)}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition">
              Refresh
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
          <Link href="/dashboard/maintenance"         className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/helpdesk"            className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Cost Analysis</span>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <div className="card flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
            <input type="date" value={filters.dateFrom}
                   onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                   className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
            <input type="date" value={filters.dateTo}
                   onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                   className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
            <select value={filters.category}
                    onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
                    className="text-sm border rounded px-2 py-1">
              <option value="">All categories</option>
              {allCategories.map(c => <option key={c.slug} value={c.slug}>{c.displayName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Site code</label>
            <input type="text" placeholder="e.g. ZIN-074" value={filters.siteCode}
                   onChange={e => setFilters(f => ({ ...f, siteCode: e.target.value.toUpperCase() }))}
                   className="text-sm border rounded px-2 py-1" />
          </div>
        </div>

        {loading && (
          <div className="card mt-5 text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading cost analysis…</p>
          </div>
        )}

        {!loading && !hasData && (
          <div className="card mt-5 text-center py-12">
            <p className="text-sm text-gray-500 mb-3">No invoices or tickets match the selected filters.</p>
            <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
              Go to Data Management to upload →
            </Link>
          </div>
        )}

        {!loading && hasData && (
          <>
            <div className="mt-5">
              <CostKPICards kpis={kpis} />
            </div>

            <div className="card mt-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Site × Category Cost / Ticket</h2>
              <CostMatrixTable
                rows={cells}
                onCellClick={(ctx) => setDrawer({
                  filters: {
                    siteCode: ctx.siteCode,
                    category: ctx.categorySlug || undefined,
                    dateFrom: filters.dateFrom,
                    dateTo:   filters.dateTo,
                  },
                  title: `Invoices: ${ctx.siteName}${ctx.categorySlug ? ` · ${ctx.categorySlug}` : ''}`,
                })}
              />
            </div>

            <InvoiceDrawer
              open={drawer != null}
              filters={drawer?.filters || {}}
              title={drawer?.title}
              onClose={() => setDrawer(null)}
              onReclassified={() => fetchAll(filters)}
            />
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and smoke test**

```bash
npx tsc --noEmit
npm run dev
```

Then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard/cost-analysis
```

Expected: 200 or 307 (redirect to login is fine).

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/cost-analysis/page.tsx
git commit -m "feat: add /dashboard/cost-analysis page composing KPI cards + matrix + drawer"
```

---

## Task 6: Add Cost Analysis tab link to 4 sister pages

**Files:**
- Modify: `app/dashboard/page.tsx` (Sales)
- Modify: `app/dashboard/maintenance/page.tsx`
- Modify: `app/dashboard/maintenance/rules/page.tsx`
- Modify: `app/dashboard/helpdesk/page.tsx`

- [ ] **Step 1: Add tab link to Sales dashboard**

In `app/dashboard/page.tsx`, find the tab bar block ending with the Helpdesk link:

```tsx
          <Link
            href="/dashboard/helpdesk"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
          >
            Helpdesk
          </Link>
        </div>
      </header>
```

Replace with:

```tsx
          <Link
            href="/dashboard/helpdesk"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
          >
            Helpdesk
          </Link>
          <Link
            href="/dashboard/cost-analysis"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
          >
            Cost Analysis
          </Link>
        </div>
      </header>
```

- [ ] **Step 2: Add tab link to Maintenance page**

In `app/dashboard/maintenance/page.tsx`, find:

```tsx
          <Link href="/dashboard/helpdesk" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
        </div>
```

Replace with:

```tsx
          <Link href="/dashboard/helpdesk" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
          <Link href="/dashboard/cost-analysis" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
```

- [ ] **Step 3: Add tab link to Rules page**

In `app/dashboard/maintenance/rules/page.tsx`, find:

```tsx
          <Link href="/dashboard/helpdesk"    className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
        </div>
```

Replace with:

```tsx
          <Link href="/dashboard/helpdesk"    className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
          <Link href="/dashboard/cost-analysis" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
```

- [ ] **Step 4: Add tab link to Helpdesk page**

In `app/dashboard/helpdesk/page.tsx`, find the tab bar's final `<span>` for Helpdesk:

```tsx
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Helpdesk</span>
        </div>
```

Replace with:

```tsx
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Helpdesk</span>
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
```

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add app/dashboard/page.tsx app/dashboard/maintenance/page.tsx app/dashboard/maintenance/rules/page.tsx app/dashboard/helpdesk/page.tsx
git commit -m "feat: add Cost Analysis tab link to Sales, Maintenance, Rules, Helpdesk pages"
```

---

## Task 7: End-to-end smoke test

**Files:**
- None (manual verification)

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/cost-analysis
gh pr create --title "feat: add Cost Analysis dashboard (invoice x ticket relationship)" \
  --body "Implements docs/superpowers/specs/2026-05-15-cost-analysis-design.md - new /dashboard/cost-analysis page with KPI cards, site x category cost-per-ticket matrix, outlier highlighting, drill-down via InvoiceDrawer."
```

Merge via GitHub UI. Vercel deploys automatically.

- [ ] **Step 2: Visit the page on production**

Open `/dashboard/cost-analysis` on the live URL. Confirm:
- Page loads, tab strip shows Cost Analysis as the active tab.
- KPI cards populate: Invoice Spend, Tickets, Cost / Ticket, Top Category.
- Site × Category matrix renders with rows (top 30 sites) and columns (top 6 categories + Rest).
- Some cells have amber/red outlier borders.

- [ ] **Step 3: Verify drill-down**

Click a non-empty cell. The InvoiceDrawer slides in with invoices for that site+category in the filter window. Reclassify a category in the drawer and confirm the page refreshes after save.

- [ ] **Step 4: Verify tab links on sibling pages**

Visit each of: Sales Dashboard, Maintenance, Rules, Helpdesk. Confirm Cost Analysis link exists in each header and routes correctly.

- [ ] **Step 5: Verify filter behavior**

On Cost Analysis, narrow the date range to a single month, switch category, type a site code. Confirm KPIs and matrix refetch and show coherent narrower data.

- [ ] **Step 6: Report anomalies**

Note any cell that should be flagged but isn't (or vice versa), any drill-down that returns wrong invoices, any sorting that doesn't match the data.
