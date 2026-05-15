'use client';

import { useEffect, useState } from 'react';

interface Row {
  descriptionNorm: string;
  sampleSubject:   string;
  count:           number;
  categorySlug:    string | null;
  categoryName:    string | null;
}

interface Filters { dateFrom?: string; dateTo?: string; priority?: string; category?: string; siteCode?: string; }

interface Props {
  filters: Filters;
  onPickDescription: (descriptionNorm: string, label: string) => void;
}

export default function TopRecurringPanel({ filters, onPickDescription }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams({ limit: '20' });
    if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   p.set('dateTo',   filters.dateTo);
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.category) p.set('category', filters.category);
    if (filters.siteCode) p.set('siteCode', filters.siteCode);

    setLoading(true);
    fetch(`/api/helpdesk/recurring?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Top Recurring Problems</h3>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Subject</th>
              <th className="px-3 py-1">Category</th>
              <th className="px-3 py-1 text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.descriptionNorm}
                  onClick={() => onPickDescription(r.descriptionNorm, r.sampleSubject)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1">{r.sampleSubject}</td>
                <td className="px-3 py-1 text-gray-600">{r.categoryName || '—'}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.count}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-500">No data.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
