// components/maintenance/TopDescriptionsPanel.tsx
'use client';

import { useEffect, useState } from 'react';

interface Row {
  descriptionNorm:   string;
  sampleDescription: string;
  occurrences:       number;
  totalSpend:        number;
  avgSpend:          number;
  categorySlug:      string | null;
  categoryName:      string | null;
}

interface Filters { dateFrom?: string; dateTo?: string; territory?: string; category?: string; }

interface Props {
  filters: Filters;
  onPickDescription: (descriptionNorm: string, label: string) => void;
}

export default function TopDescriptionsPanel({ filters, onPickDescription }: Props) {
  const [by, setBy] = useState<'spend' | 'count'>('spend');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams({ by, limit: '20' });
    if (filters.dateFrom)  p.set('dateFrom',  filters.dateFrom);
    if (filters.dateTo)    p.set('dateTo',    filters.dateTo);
    if (filters.territory) p.set('territory', filters.territory);
    if (filters.category)  p.set('category',  filters.category);

    setLoading(true);
    fetch(`/api/maintenance/top-descriptions?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [by, JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Where the money is going</h3>
        <div className="flex gap-1">
          {(['spend','count'] as const).map(t => (
            <button
              key={t}
              onClick={() => setBy(t)}
              className={`rounded px-2 py-0.5 text-xs ${by === t ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}
            >
              {t === 'spend' ? 'By spend' : 'By count'}
            </button>
          ))}
        </div>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Description</th>
              <th className="px-3 py-1">Category</th>
              <th className="px-3 py-1 text-right">{by === 'spend' ? 'Total' : 'Count'}</th>
              <th className="px-3 py-1 text-right">{by === 'spend' ? 'Count' : 'Total'}</th>
              <th className="px-3 py-1 text-right">Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.descriptionNorm}
                  onClick={() => onPickDescription(r.descriptionNorm, r.sampleDescription)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1">{r.sampleDescription}</td>
                <td className="px-3 py-1 text-gray-600">{r.categoryName || '—'}</td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {by === 'spend' ? r.totalSpend.toLocaleString() : r.occurrences}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {by === 'spend' ? r.occurrences : r.totalSpend.toLocaleString()}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{r.avgSpend.toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">No data.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
