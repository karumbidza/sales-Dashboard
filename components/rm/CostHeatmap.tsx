'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RMFilters } from './RMFilterBar';
import InvoiceDrawer, { InvoiceFilters } from '@/components/maintenance/InvoiceDrawer';

interface Cell {
  cost: number;
  perLitre: number | null;
  zScore:   number | null;
  ticketCount:  number;
  invoiceCount: number;
  anomaly: 0 | 1 | 2;
}

interface HeatmapResponse {
  sites:      { siteCode: string; siteName: string; total: number; volume: number }[];
  categories: { slug: string; name: string; total: number }[];
  matrix:     Record<string, Record<string, Cell>>;
}

type Metric = 'cost' | 'perLitre' | 'zScore';

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPerLitre(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1)    return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

// 4-step blue ramp for $ YTD mode (by quartile)
function costColor(value: number, max: number): { bg: string; text: string } {
  if (max === 0 || value === 0) return { bg: '#f3f4f6', text: '#9ca3af' };
  const ratio = value / max;
  if (ratio < 0.25) return { bg: '#dbeafe', text: '#1e3a5f' };
  if (ratio < 0.50) return { bg: '#93c5fd', text: '#1e3a5f' };
  if (ratio < 0.75) return { bg: '#3b82f6', text: '#ffffff' };
  return { bg: '#1e3a5f', text: '#ffffff' };
}

// Diverging red/blue ramp for z-score (centered at 0)
function zScoreColor(z: number | null): { bg: string; text: string } {
  if (z === null) return { bg: '#f3f4f6', text: '#9ca3af' };
  if (z >  2)  return { bg: '#b91c1c', text: '#ffffff' };
  if (z >  1)  return { bg: '#fca5a5', text: '#7f1d1d' };
  if (z > -1)  return { bg: '#f3f4f6', text: '#374151' };
  if (z > -2)  return { bg: '#bfdbfe', text: '#1e3a5f' };
  return { bg: '#1e3a5f', text: '#ffffff' };
}

interface Props { filters: RMFilters }

export default function CostHeatmap({ filters }: Props) {
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<Metric>('cost');
  const [showAll, setShowAll] = useState(false);
  const [drawerFilters, setDrawerFilters] = useState<InvoiceFilters | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
      category:  filters.category,
    }).toString();
    setLoading(true);
    fetch(`/api/rm/cost-heatmap?${qs}`)
      .then(r => r.json())
      .then(j => setData(j.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const visibleSites = useMemo(() => {
    if (!data) return [];
    const cap = showAll ? data.sites.length : 12;
    return data.sites.slice(0, cap);
  }, [data, showAll]);

  // Cap categories shown to 7 (6 top + "Rest" aggregate)
  const { displayCats, restCat } = useMemo(() => {
    if (!data) return { displayCats: [], restCat: null as { slug: string; name: string; total: number } | null };
    if (data.categories.length <= 7) return { displayCats: data.categories, restCat: null };
    const top = data.categories.slice(0, 6);
    const rest = data.categories.slice(6);
    const restTotal = rest.reduce((a, b) => a + b.total, 0);
    return {
      displayCats: top,
      restCat: { slug: '__rest__', name: 'Rest', total: restTotal },
    };
  }, [data]);

  const maxCost = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const s of data.sites) {
      for (const c of data.categories) {
        const cell = data.matrix[s.siteCode]?.[c.slug];
        if (cell && cell.cost > m) m = cell.cost;
      }
    }
    return m;
  }, [data]);

  function getCellValue(cell: Cell | undefined): { display: string; color: { bg: string; text: string } } {
    if (!cell) return { display: '—', color: { bg: '#f3f4f6', text: '#9ca3af' } };
    if (metric === 'cost')      return { display: fmtCurrency(cell.cost),      color: costColor(cell.cost, maxCost) };
    if (metric === 'perLitre')  return { display: fmtPerLitre(cell.perLitre),  color: cell.perLitre !== null ? costColor(cell.perLitre, 0.1) : { bg: '#f3f4f6', text: '#9ca3af' } };
    return { display: cell.zScore !== null ? cell.zScore.toFixed(1) : '—',     color: zScoreColor(cell.zScore) };
  }

  function getRestCellSum(siteCode: string): Cell {
    if (!data || !restCat) return { cost: 0, perLitre: null, zScore: null, ticketCount: 0, invoiceCount: 0, anomaly: 0 };
    const restSlugs = data.categories.slice(6).map(c => c.slug);
    let cost = 0, tickets = 0, invoices = 0;
    for (const slug of restSlugs) {
      const c = data.matrix[siteCode]?.[slug];
      if (c) { cost += c.cost; tickets += c.ticketCount; invoices += c.invoiceCount; }
    }
    const vol = data.sites.find(s => s.siteCode === siteCode)?.volume || 0;
    return { cost, perLitre: vol > 0 ? cost / vol : null, zScore: null, ticketCount: tickets, invoiceCount: invoices, anomaly: 0 };
  }

  function onCellClick(siteCode: string, categorySlug: string | null) {
    setDrawerFilters({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      siteCode,
      territory: filters.territory,
      category:  categorySlug && categorySlug !== '__rest__' ? categorySlug : '',
    });
  }

  const metricToggle = (m: Metric, label: string) => (
    <button onClick={() => setMetric(m)}
            className={`text-[10px] px-2 py-0.5 rounded ${metric === m ? 'bg-[#1e3a5f] text-white' : 'border border-gray-300 text-gray-600'}`}>
      {label}
    </button>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 mb-[10px]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-medium text-gray-800">Site × Category Cost</div>
        <div className="flex gap-0.5">
          {metricToggle('cost',     '$ YTD')}
          {metricToggle('perLitre', '$/L')}
          {metricToggle('zScore',   'z-score')}
        </div>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">Loading…</div>
      ) : !data || data.sites.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">No data in window</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Site</th>
                {displayCats.map(c => (
                  <th key={c.slug} className="text-right px-1.5 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap">
                    {c.name}
                  </th>
                ))}
                {restCat && (
                  <th className="text-right px-1.5 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Rest</th>
                )}
                <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {visibleSites.map(s => (
                <tr key={s.siteCode}>
                  <td className="px-2 py-1 text-gray-900 whitespace-nowrap">
                    <span className="font-mono text-[10px] text-gray-500 mr-1.5">{s.siteCode}</span>
                    {s.siteName}
                  </td>
                  {displayCats.map(c => {
                    const cell = data.matrix[s.siteCode]?.[c.slug];
                    const { display, color } = getCellValue(cell);
                    const marker = cell?.anomaly === 2 ? ' ⚠⚠' : cell?.anomaly === 1 ? ' ⚠' : '';
                    return (
                      <td key={c.slug} className="px-0.5 py-0.5">
                        {cell ? (
                          <button
                            onClick={() => onCellClick(s.siteCode, c.slug)}
                            className="w-full px-1.5 py-1 text-right text-[11px] rounded hover:opacity-80 transition-opacity"
                            style={{ background: color.bg, color: color.text }}
                            title={`${s.siteName} · ${c.name}: ${display}${marker}\nInvoices: ${cell.invoiceCount} · Tickets: ${cell.ticketCount}${cell.zScore !== null ? `\nz = ${cell.zScore}σ` : ''}`}>
                            {display}{marker}
                          </button>
                        ) : (
                          <div className="w-full px-1.5 py-1 text-right text-[11px] text-gray-300">—</div>
                        )}
                      </td>
                    );
                  })}
                  {restCat && (
                    <td className="px-0.5 py-0.5">
                      {(() => {
                        const cell = getRestCellSum(s.siteCode);
                        const { display, color } = getCellValue(cell);
                        return (
                          <button
                            onClick={() => onCellClick(s.siteCode, null)}
                            className="w-full px-1.5 py-1 text-right text-[11px] rounded hover:opacity-80"
                            style={{ background: color.bg, color: color.text }}>
                            {display}
                          </button>
                        );
                      })()}
                    </td>
                  )}
                  <td className="px-2 py-1 text-right font-medium text-gray-900 whitespace-nowrap">
                    {fmtCurrency(s.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!showAll && data.sites.length > 12 && (
            <div className="text-[10px] text-gray-500 mt-2 flex items-center justify-between">
              <span>{data.sites.length - 12} more sites · click any cell for invoice detail</span>
              <button onClick={() => setShowAll(true)} className="text-[#1e3a5f] hover:underline font-medium">
                Show all
              </button>
            </div>
          )}
          {showAll && (
            <div className="text-[10px] text-gray-500 mt-2">
              <button onClick={() => setShowAll(false)} className="text-[#1e3a5f] hover:underline font-medium">
                Collapse to top 12
              </button>
            </div>
          )}
        </div>
      )}

      {drawerFilters && (
        <InvoiceDrawer
          open={drawerFilters !== null}
          filters={drawerFilters}
          onClose={() => setDrawerFilters(null)}
          onReclassified={() => {}}
        />
      )}
    </div>
  );
}
