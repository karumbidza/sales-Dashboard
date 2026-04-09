// components/ui/UnmatchedRowsPanel.tsx
'use client';

import { useEffect, useState } from 'react';

type SheetFilter = 'all' | 'STATUS REPORT' | 'PETROTRADE' | 'MARGIN';

interface Row {
  rawSiteCode: string;
  sheet: 'STATUS REPORT' | 'PETROTRADE' | 'MARGIN';
  rowCount: number;
  firstDate: string | null;
  lastDate: string | null;
  lastSeen: string | null;
  lastSource: string | null;
}

interface ApiResponse {
  data: Row[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  counts: {
    all: number;
    statusReport: number;
    petrotrade: number;
    margin: number;
    distinctCodes: number;
  };
}

const PAGE_SIZE = 20;

const SHEET_PILLS: { key: SheetFilter; label: string; tone: string; countKey: keyof ApiResponse['counts'] }[] = [
  { key: 'all',           label: 'All',           tone: 'bg-gray-100 text-gray-700 border-gray-200',     countKey: 'all' },
  { key: 'STATUS REPORT', label: 'Status Report', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', countKey: 'statusReport' },
  { key: 'PETROTRADE',    label: 'Petrotrade',    tone: 'bg-blue-50 text-blue-700 border-blue-200',         countKey: 'petrotrade' },
  { key: 'MARGIN',        label: 'Margin',        tone: 'bg-amber-50 text-amber-700 border-amber-200',      countKey: 'margin' },
];

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

export default function UnmatchedRowsPanel() {
  const [sheet, setSheet] = useState<SheetFilter>('all');
  const [page, setPage]   = useState(1);
  const [data, setData]   = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setPage(1); }, [sheet]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (sheet !== 'all') params.set('sheet', sheet);
    fetch(`/api/unmatched-rows?${params}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { /* swallow */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sheet, page]);

  const counts = data?.counts || { all: 0, statusReport: 0, petrotrade: 0, margin: 0, distinctCodes: 0 };
  const total = data?.total || 0;
  const pageCount = data?.pageCount || 1;
  const start = (page - 1) * PAGE_SIZE + 1;
  const end   = Math.min(page * PAGE_SIZE, total);

  if (counts.all === 0) {
    return (
      <div className="card mt-5">
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-gray-800">Unmatched Submissions</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Rows that ingest dropped because their <code>SITE CODE</code> isn't in NAME INDEX.
          </p>
        </div>
        <div className="text-center text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg py-6">
          ✓ Nothing dropped. Every status report row matched a NAME INDEX entry.
        </div>
      </div>
    );
  }

  return (
    <div className="card mt-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          Unmatched Submissions
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold uppercase tracking-wide">
            {counts.distinctCodes} site codes · {counts.all} rows
          </span>
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Rows ingest dropped because the <code>SITE CODE</code> wasn't in NAME INDEX.
          Add the code to the master sheet and re-upload to recover the data.
        </p>
      </div>

      {/* Sheet filter pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {SHEET_PILLS.map(p => (
          <button
            key={p.key}
            type="button"
            onClick={() => setSheet(p.key)}
            className={`text-xs px-2.5 py-1 rounded-full border font-medium transition ${
              sheet === p.key ? p.tone + ' ring-1 ring-offset-1 ring-gray-300' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {p.label}
            <span className="ml-1.5 text-[10px] font-semibold">{counts[p.countKey] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-100">
        <table className="min-w-full text-sm">
          <thead className="bg-[#1e3a5f]">
            <tr>
              {['Raw Site Code', 'Sheet', 'Rows Dropped', 'First Date', 'Last Date', 'Last Seen', 'Last Source File'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-white whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-gray-300">Loading…</td></tr>
            )}
            {!loading && (data?.data?.length ?? 0) === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-gray-300">No unmatched rows for this filter</td></tr>
            )}
            {!loading && data?.data?.map((r, i) => (
              <tr key={`${r.rawSiteCode}-${r.sheet}-${i}`} className="border-b border-gray-50 hover:bg-red-50/40">
                <td className="px-3 py-2.5">
                  <span className="font-mono text-xs font-semibold text-red-700">{r.rawSiteCode}</span>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{r.sheet}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-right font-mono text-gray-800">{r.rowCount}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{fmtDate(r.firstDate)}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{fmtDate(r.lastDate)}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{fmtDate(r.lastSeen)}</td>
                <td className="px-3 py-2.5 text-xs text-gray-400 truncate max-w-[200px]" title={r.lastSource || ''}>
                  {r.lastSource || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
        <span>{total === 0 ? '0 results' : `Showing ${start}–${end} of ${total} unmatched groups`}</span>
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
