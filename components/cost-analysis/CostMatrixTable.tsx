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
  cells: Map<string, CostCell>;
  categoryStats: Map<string, { mean: number; std: number }>;
}

function pivot(rows: CostCell[]): PivotShape {
  const bySite = new Map<string, { siteCode: string; siteName: string; totalCost: number }>();
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
      cells.set(key, {
        ...r,
        categorySlug: colKey === '__rest__' ? null : colKey,
        categoryName: colKey === '__rest__' ? 'Other / Rest' : r.categoryName,
      });
    }
  }

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
