// components/ui/SiteActivityPanel.tsx
'use client';

import { useEffect, useState } from 'react';

type Status = 'all' | 'active' | 'late' | 'stale' | 'dormant' | 'prospective';

interface Row {
  siteCode: string;
  siteName: string;
  moso: string | null;
  territoryCode: string | null;
  territoryName: string | null;
  firstSaleDate: string | null;
  lastSaleDate:  string | null;
  daysReported:  number;
  daysSinceLast: number | null;
  status: Exclude<Status, 'all'>;
}

interface ApiResponse {
  data: Row[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  counts: Record<Status, number>;
  asOf: string;
}

const PAGE_SIZE = 20;

const STATUS_PILLS: { key: Status; label: string; tone: string }[] = [
  { key: 'all',         label: 'All',         tone: 'bg-gray-100 text-gray-700 border-gray-200' },
  { key: 'active',      label: 'Active',      tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'late',        label: 'Late',        tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'stale',       label: 'Stale',       tone: 'bg-orange-50 text-orange-700 border-orange-200' },
  { key: 'dormant',     label: 'Dormant',     tone: 'bg-red-50 text-red-700 border-red-200' },
  { key: 'prospective', label: 'Prospective', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
];

function statusBadge(s: Row['status']) {
  const map: Record<Row['status'], string> = {
    active:      'bg-emerald-100 text-emerald-800',
    late:        'bg-amber-100 text-amber-800',
    stale:       'bg-orange-100 text-orange-800',
    dormant:     'bg-red-100 text-red-800',
    prospective: 'bg-blue-100 text-blue-800',
  };
  return map[s] || 'bg-gray-100 text-gray-700';
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

export default function SiteActivityPanel() {
  const [status, setStatus] = useState<Status>('all');
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [data, setData]     = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setPage(1); }, [status, search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (status !== 'all') params.set('status', status);
    if (search.trim())    params.set('search', search.trim());
    fetch(`/api/site-activity?${params}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { /* swallow */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status, search, page]);

  const counts = data?.counts || { all: 0, active: 0, late: 0, stale: 0, dormant: 0, prospective: 0 };
  const total = data?.total || 0;
  const pageCount = data?.pageCount || 1;
  const start = (page - 1) * PAGE_SIZE + 1;
  const end   = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="card mt-5">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Site Submission Status</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Source of truth: <code>sales</code> table. Active = reported within 3 days
            (covers weekend catch-up). As of {data?.asOf || '—'}.
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search site code or name…"
          className="text-xs border border-gray-200 rounded-md px-3 py-1.5 w-56 focus:outline-none focus:border-blue-400"
        />
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUS_PILLS.map(p => (
          <button
            key={p.key}
            type="button"
            onClick={() => setStatus(p.key)}
            className={`text-xs px-2.5 py-1 rounded-full border font-medium transition ${
              status === p.key ? p.tone + ' ring-1 ring-offset-1 ring-gray-300' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {p.label}
            <span className="ml-1.5 text-[10px] font-semibold">{counts[p.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-100">
        <table className="min-w-full text-sm">
          <thead className="bg-[#1e3a5f]">
            <tr>
              {['Site', 'Territory', 'MOSO', 'Status', 'Last Report', 'Days Ago', 'First Report', 'Days Reported'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-white whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-gray-300">Loading…</td></tr>
            )}
            {!loading && (data?.data?.length ?? 0) === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-gray-300">No sites match</td></tr>
            )}
            {!loading && data?.data?.map(r => (
              <tr key={r.siteCode} className="border-b border-gray-50 hover:bg-blue-50">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-gray-800">{r.siteName}</div>
                  <div className="text-[10px] text-gray-400 font-mono">{r.siteCode}</div>
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{r.territoryName || '—'}</td>
                <td className="px-3 py-2.5 text-xs">
                  {r.moso && <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{r.moso}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${statusBadge(r.status)}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-600">{fmtDate(r.lastSaleDate)}</td>
                <td className="px-3 py-2.5 text-xs text-right font-mono text-gray-700">
                  {r.daysSinceLast != null ? `${r.daysSinceLast}d` : '—'}
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{fmtDate(r.firstSaleDate)}</td>
                <td className="px-3 py-2.5 text-xs text-right font-mono text-gray-500">{r.daysReported}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
        <span>{total === 0 ? '0 results' : `Showing ${start}–${end} of ${total}`}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
          >
            ← Prev
          </button>
          <span className="font-mono">{page} / {pageCount}</span>
          <button
            type="button"
            disabled={page >= pageCount || loading}
            onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40 hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
