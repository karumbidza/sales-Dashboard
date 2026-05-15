'use client';

import { useEffect, useState } from 'react';
import type { RMFilters } from './RMFilterBar';

interface RecurringRow {
  descriptionNorm: string;
  sampleSubject:   string | null;
  count:           number;
  siteCount:       number;
  categoryName:    string | null;
}

interface Props { filters: RMFilters }

export default function RecurringIssuesPanel({ filters }: Props) {
  const [data, setData] = useState<RecurringRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
      category:  filters.category,
      limit:     '4',
    }).toString();
    setLoading(true);
    fetch(`/api/rm/recurring-issues?${qs}`)
      .then(r => r.json())
      .then(j => setData(j.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [filters]);

  const totalRecurringTickets = data.reduce((a, b) => a + b.count, 0);

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 flex flex-col" style={{ minHeight: 280 }}>
      <div className="text-[11px] font-medium text-gray-800 mb-3">Recurring Issues — Top 4 (90d)</div>

      <div className="flex-1">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400 text-center px-4">
            No issues with ≥3 occurrences in the last 90 days
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Issue</th>
                <th className="text-right py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold w-20">Count</th>
                <th className="text-right py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold w-16">Sites</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={`${r.descriptionNorm}-${i}`} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-2">
                    <div className="text-gray-900 truncate max-w-md" title={r.sampleSubject || r.descriptionNorm}>
                      {r.sampleSubject || r.descriptionNorm}
                    </div>
                    {r.categoryName && (
                      <div className="text-[10px] text-gray-500 mt-0.5">{r.categoryName}</div>
                    )}
                  </td>
                  <td className="py-2 text-right font-medium text-gray-900">{r.count}</td>
                  <td className="py-2 text-right text-gray-500">{r.siteCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.length > 0 && (
        <div className="text-[10px] text-gray-500 mt-3">
          {totalRecurringTickets} tickets across {data.length} recurring issues
        </div>
      )}
    </div>
  );
}
