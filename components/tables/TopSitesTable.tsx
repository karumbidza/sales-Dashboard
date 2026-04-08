// components/tables/TopSitesTable.tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

const SiteDetailModal = dynamic(() => import('@/components/ui/SiteDetailModal'), { ssr: false });

interface Props {
  data: any[];
  dateFrom?: string;
  dateTo?: string;
}

import { fmtVsBudget, vsBudgetBadgeClass } from '@/lib/formatters';

function fmtVol(n: number)  { return n?.toLocaleString('en', { maximumFractionDigits: 0 }) ?? '—'; }
function fmtPct(n: number | null) { return n != null ? `${n.toFixed(1)}%` : '—'; }

function PctBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-300">—</span>;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${vsBudgetBadgeClass(value)}`}>
      {fmtVsBudget(value)}
    </span>
  );
}

function MosoBadge({ value }: { value: string }) {
  const colors: Record<string, string> = {
    CLCO: 'bg-blue-100 text-blue-700',
    COCO: 'bg-purple-100 text-purple-700',
    CODO: 'bg-teal-100 text-teal-700',
    DODO: 'bg-orange-100 text-orange-700',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${colors[value] || 'bg-gray-100 text-gray-600'}`}>
      {value}
    </span>
  );
}

type SortKey = 'rank' | 'volume' | 'avgDaily' | 'vsBudgetPct' | 'contributionPct';

export default function TopSitesTable({ data, dateFrom, dateTo }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [drillSite, setDrillSite] = useState<string | null>(null);

  const today = new Date();
  const df = dateFrom || new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const dt = dateTo   || today.toISOString().split('T')[0];

  const sorted = [...data].sort((a, b) => {
    const va = a[sortKey] ?? 0;
    const vb = b[sortKey] ?? 0;
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSort(key, sortDir === 'asc' ? 'desc' : 'asc');
    else setSort(key, key === 'rank' ? 'asc' : 'desc');
  };
  const setSort = (k: SortKey, d: 'asc' | 'desc') => { setSortKey(k); setSortDir(d); };

  const Th = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      className="px-3 py-2.5 text-left text-xs font-semibold text-white cursor-pointer select-none whitespace-nowrap hover:bg-blue-800"
      onClick={() => toggleSort(k)}
    >
      {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  if (!data.length) return (
    <div className="text-center py-8 text-gray-300 text-sm">No site data for selected period</div>
  );

  // Compute cumulative contribution for Pareto
  let cumulative = 0;

  return <>
    <div className="overflow-x-auto rounded-lg border border-gray-100">
      <table className="min-w-full text-sm">
        <thead className="bg-[#1e3a5f]">
          <tr>
            <Th label="#"            k="rank" />
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white">Site</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white">Territory</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white">MOSO</th>
            <Th label="Volume (L)"   k="volume" />
            <Th label="Avg Daily"    k="avgDaily" />
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white">Budget (L)</th>
            <Th label="Vs Budget"    k="vsBudgetPct" />
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white">Vs Stretch</th>
            <Th label="Contribution" k="contributionPct" />
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white">Cumulative</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((site, i) => {
            cumulative += site.contributionPct ?? 0;
            const rankColors = ['#f59e0b', '#9ca3af', '#cd7c3a'];
            return (
              <tr key={site.siteCode}
                className="border-b border-gray-50 hover:bg-blue-50 transition-colors cursor-pointer"
                onClick={() => setDrillSite(site.siteCode)}
                title="Click to view site details"
              >
                <td className="px-3 py-2.5">
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white"
                    style={{ background: rankColors[i] || '#1e3a5f' }}
                  >
                    {site.rank}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{site.siteName}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{site.territoryName || '—'}</td>
                <td className="px-3 py-2.5">
                  {site.moso ? <MosoBadge value={site.moso} /> : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-800">{fmtVol(site.volume)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-500">{fmtVol(site.avgDaily)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-gray-400">{fmtVol(site.budgetVolume)}</td>
                <td className="px-3 py-2.5 text-right"><PctBadge value={site.vsBudgetPct} /></td>
                <td className="px-3 py-2.5 text-right"><PctBadge value={site.vsStretchPct} /></td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <div className="w-16 bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full"
                        style={{ width: `${Math.min(site.contributionPct * 3, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-600 tabular-nums w-10 text-right">
                      {fmtPct(site.contributionPct)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-xs text-gray-400 tabular-nums">
                  {cumulative.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-gray-50 border-t border-gray-200">
          <tr>
            <td colSpan={4} className="px-3 py-2 text-xs font-semibold text-gray-600">TOTAL</td>
            <td className="px-3 py-2 text-right font-mono font-semibold text-gray-800">
              {fmtVol(data.reduce((s, r) => s + (r.volume ?? 0), 0))}
            </td>
            <td className="px-3 py-2 text-right font-mono text-gray-400">
              {fmtVol(data.reduce((s, r) => s + (r.avgDaily ?? 0), 0) / (data.length || 1))}
            </td>
            <td colSpan={5} />
          </tr>
        </tfoot>
      </table>
    </div>

    {drillSite && (
      <SiteDetailModal
        siteCode={drillSite}
        dateFrom={df}
        dateTo={dt}
        onClose={() => setDrillSite(null)}
      />
    )}
  </>;
}
