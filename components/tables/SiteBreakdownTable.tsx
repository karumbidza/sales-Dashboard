// components/tables/SiteBreakdownTable.tsx
'use client';

import { useState, useEffect } from 'react';
import { fmtVsBudget, vsBudgetBadgeClass } from '@/lib/formatters';

const PAGE_SIZE = 20;

function fmtVol(n: number)  { return n?.toLocaleString('en', { maximumFractionDigits: 0 }) ?? '—'; }
function fmtRev(n: number)  { return n != null ? `$${n.toLocaleString('en', { maximumFractionDigits: 0 })}` : '—'; }
function fmtPct(n: number | null) { return n != null ? `${n.toFixed(1)}%` : '—'; }

function PctBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-300 text-xs">—</span>;
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${vsBudgetBadgeClass(value)}`}>{fmtVsBudget(value)}</span>;
}

interface Props { data: any[]; type: 'territory' | 'sites'; paginate?: boolean; }

export default function SiteBreakdownTable({ data, type, paginate = false }: Props) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [data]);

  if (!data?.length) return (
    <div className="text-center py-8 text-gray-300 text-sm">No data</div>
  );

  const total     = data.length;
  const pageCount = paginate ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;
  const visible   = paginate ? data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : data;
  const start     = paginate ? (page - 1) * PAGE_SIZE + 1 : 1;
  const end       = paginate ? Math.min(page * PAGE_SIZE, total) : total;

  if (type === 'territory') {
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-100">
        <table className="min-w-full text-sm">
          <thead className="bg-[#1e3a5f]">
            <tr>
              {['Territory', 'Sites', 'Volume (L)', 'Revenue', 'Avg Daily', 'Budget (L)', 'Vs Budget', 'Vs Stretch', 'Net Margin', 'Contribution', 'Diesel', 'Blend', 'ULP'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-white whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((t, i) => (
              <tr key={t.territoryCode || i} className="border-b border-gray-50 hover:bg-blue-50">
                <td className="px-3 py-2.5 font-semibold text-gray-800">{t.territoryName || t.territoryCode || 'Unassigned'}</td>
                <td className="px-3 py-2.5 text-center text-gray-500">{t.siteCount}</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmtVol(t.volume)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-500">{fmtRev(t.revenue)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-500">{fmtVol(t.avgDaily)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-400">{fmtVol(t.budgetVolume)}</td>
                <td className="px-3 py-2.5 text-right"><PctBadge value={t.vsBudgetPct} /></td>
                <td className="px-3 py-2.5 text-right"><PctBadge value={t.vsStretchPct} /></td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-700">
                  {t.netMarginCpl != null ? `$${(t.netMarginCpl / 100).toFixed(2)}/L` : '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-xs text-gray-500">{fmtPct(t.contributionPct)}</td>
                <td className="px-3 py-2.5 text-right text-xs text-blue-600">{fmtVol(t.dieselVol)}</td>
                <td className="px-3 py-2.5 text-right text-xs text-cyan-600">{fmtVol(t.blendVol)}</td>
                <td className="px-3 py-2.5 text-right text-xs text-emerald-600">{fmtVol(t.ulpVol)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-200">
            <tr>
              <td className="px-3 py-2 text-xs font-bold text-gray-700">TOTAL</td>
              <td className="px-3 py-2 text-center text-xs font-semibold">{data.reduce((s, r) => s + r.siteCount, 0)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold text-gray-800">{fmtVol(data.reduce((s, r) => s + r.volume, 0))}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-gray-500">{fmtRev(data.reduce((s, r) => s + r.revenue, 0))}</td>
              <td colSpan={9} />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  // Sites breakdown
  return (
    <div>
    <div className="overflow-x-auto rounded-lg border border-gray-100">
      <table className="min-w-full text-sm">
        <thead className="bg-[#1e3a5f]">
          <tr>
            {['Site', 'Territory', 'MOSO', 'Volume (L)', 'Revenue', 'Avg Daily', 'Budget', 'Vs Budget', 'Cash %', 'Coupon + Card (L)', 'Flex (L)', 'Net Margin'].map(h => (
              <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-white whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((s, i) => (
            <tr key={s.siteCode || i} className="border-b border-gray-50 hover:bg-blue-50">
              <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{s.siteName}</td>
              <td className="px-3 py-2.5 text-gray-500 text-xs">{s.territoryName || '—'}</td>
              <td className="px-3 py-2.5 text-xs">
                {s.moso && <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{s.moso}</span>}
              </td>
              <td className="px-3 py-2.5 text-right font-mono">{fmtVol(s.volume)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-500">{fmtRev(s.revenue)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-500">{fmtVol(s.avgDaily)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-gray-400">{fmtVol(s.budgetVolume)}</td>
              <td className="px-3 py-2.5 text-right"><PctBadge value={s.vsBudgetPct} /></td>
              <td className="px-3 py-2.5 text-right text-xs text-gray-500">{fmtPct(s.cashRatioPct)}</td>
              <td className="px-3 py-2.5 text-right text-xs font-mono text-gray-500">
                {((s.couponVolume || 0) + (s.cardVolume || 0)) > 0
                  ? fmtVol((s.couponVolume || 0) + (s.cardVolume || 0))
                  : '—'}
              </td>
              <td className="px-3 py-2.5 text-right text-xs font-mono text-gray-500">{s.flexVolume   > 0 ? fmtVol(s.flexVolume)   : '—'}</td>
              <td className="px-3 py-2.5 text-right text-xs font-mono text-gray-700">{s.netMarginCpl != null ? `$${(s.netMarginCpl / 100).toFixed(2)}/L` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {paginate && (
      <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
        <span>Showing {start}–{end} of {total}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
          >
            ← Prev
          </button>
          <span className="font-mono">{page} / {pageCount}</span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      </div>
    )}
    </div>
  );
}
