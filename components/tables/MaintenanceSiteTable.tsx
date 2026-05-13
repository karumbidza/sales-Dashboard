'use client';

import { useMemo, useState } from 'react';

export interface MaintSiteRow {
  siteCode: string;
  siteName: string;
  territoryCode: string | null;
  cost: number;
  volume: number;
  topCategory: string | null;
  costPerLitre: number | null;
}

type SortKey = 'site' | 'territory' | 'cost' | 'volume' | 'costPerLitre';

const PAGE_SIZE = 25;

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCpl(n: number | null) {
  if (n == null) return '—';
  if (n > 0 && n < 0.0001) return `$${n.toExponential(2)}`;
  return `$${n.toFixed(4)}`;
}

export default function MaintenanceSiteTable({ data, onRowClick }: { data: MaintSiteRow[]; onRowClick?: (row: MaintSiteRow) => void }) {
  const [sortBy, setSortBy]   = useState<SortKey>('costPerLitre');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage]       = useState(1);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a: any, b: any) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;       // nulls always last
      if (b == null) return -1;
      if (typeof a === 'number') return (a - b) * dir;
      return String(a).localeCompare(String(b)) * dir;
    };
    return [...data].sort((a, b) => {
      switch (sortBy) {
        case 'site':         return cmp(a.siteName, b.siteName);
        case 'territory':    return cmp(a.territoryCode, b.territoryCode);
        case 'cost':         return cmp(a.cost, b.cost);
        case 'volume':       return cmp(a.volume, b.volume);
        case 'costPerLitre': return cmp(a.costPerLitre, b.costPerLitre);
      }
    });
  }, [data, sortBy, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const slice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (k: SortKey) => {
    if (k === sortBy) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(k); setSortDir('desc'); }
    setPage(1);
  };

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 ${right ? 'text-right' : 'text-left'}`}
    >
      {children}{sortBy === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  if (data.length === 0) {
    return <p className="text-sm text-gray-400">No R&amp;M data for the selected filters.</p>;
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200">
          <tr>
            <Th k="site">Site</Th>
            <Th k="territory">Territory</Th>
            <Th k="volume" right>Volume (L)</Th>
            <Th k="cost" right>R&amp;M Cost</Th>
            <Th k="costPerLitre" right>Cost / Litre</Th>
            <th className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide text-left">Top Category</th>
          </tr>
        </thead>
        <tbody>
          {slice.map(r => (
            <tr key={r.siteCode} className={`border-b border-gray-100 hover:bg-gray-50 ${onRowClick ? 'cursor-pointer' : ''}`} onClick={() => onRowClick?.(r)}>
              <td className="px-3 py-2">{r.siteName}</td>
              <td className="px-3 py-2 text-gray-500">{r.territoryCode || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.volume.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">${fmtMoney(r.cost)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtCpl(r.costPerLitre)}</td>
              <td className="px-3 py-2 text-gray-500">{r.topCategory || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
          <span>Page {page} of {pageCount} — {sorted.length.toLocaleString()} sites</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border rounded disabled:opacity-40">Prev</button>
            <button disabled={page === pageCount} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border rounded disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
