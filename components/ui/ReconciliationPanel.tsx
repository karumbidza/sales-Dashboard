// components/ui/ReconciliationPanel.tsx
'use client';

import { useEffect, useState } from 'react';
import { Filters } from '@/app/dashboard/page';

interface Props { filters: Filters; }

export default function ReconciliationPanel({ filters }: Props) {
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    const month = filters.dateFrom || new Date().toISOString().slice(0, 7) + '-01';
    const p = new URLSearchParams({ month, flagged: String(onlyFlagged) });
    if (filters.territory) p.set('territory', filters.territory);

    setLoading(true);
    fetch(`/api/reconciliation?${p}`)
      .then(r => r.json())
      .then(d => { setData(d.data || []); setSummary(d.summary); })
      .finally(() => setLoading(false));
  }, [filters, onlyFlagged]);

  return (
    <div className="mt-5">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
        <h3 className="font-semibold text-amber-900 text-sm mb-1">⚠ Status vs Invoice Reconciliation</h3>
        <p className="text-xs text-amber-700">
          Compares <strong>Status Report volumes</strong> (true sales) against
          <strong> Dynamics invoiced volumes</strong> (financial). Sites with &gt;2% variance are flagged.
        </p>
        {summary && (
          <div className="flex gap-6 mt-3">
            <div className="text-center">
              <div className="text-xl font-bold text-amber-900">{summary.total_sites}</div>
              <div className="text-xs text-amber-600">Total Sites</div>
            </div>
            <div className="text-center">
              <div className={`text-xl font-bold ${summary.flagged_sites > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {summary.flagged_sites}
              </div>
              <div className="text-xs text-amber-600">Flagged (Gap &gt;2%)</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-amber-900">
                {summary.total_variance?.toLocaleString('en', { maximumFractionDigits: 0 })} L
              </div>
              <div className="text-xs text-amber-600">Total Variance</div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Control Gap Report</h3>
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={e => setOnlyFlagged(e.target.checked)}
              className="rounded"
            />
            Show flagged only
          </label>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-300 text-sm">Loading…</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="min-w-full text-xs">
              <thead className="bg-[#1e3a5f]">
                <tr>
                  {['Site', 'Territory', 'MOSO', 'Status Vol (L)', 'Invoiced Vol (L)', 'Variance (L)', 'Variance %', 'Status'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-white whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-50 ${r.is_flagged ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.site_name}</td>
                    <td className="px-3 py-2 text-gray-500">{r.territory_name || '—'}</td>
                    <td className="px-3 py-2">
                      {r.moso && <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs">{r.moso}</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.status_volume?.toLocaleString('en')}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.invoiced_volume?.toLocaleString('en')}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${r.variance > 0 ? 'text-emerald-600' : r.variance < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {r.variance > 0 ? '+' : ''}{r.variance?.toLocaleString('en')}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${r.is_flagged ? 'text-red-600' : 'text-gray-500'}`}>
                      {r.variance_pct != null ? `${r.variance_pct > 0 ? '+' : ''}${r.variance_pct?.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {r.is_flagged
                        ? <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-semibold">⚠ FLAGGED</span>
                        : <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-xs">✓ OK</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length === 0 && (
              <div className="text-center py-8 text-gray-300">No reconciliation data for selected period</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
