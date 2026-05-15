'use client';

import { useEffect, useState } from 'react';
import type { RMFilters } from './RMFilterBar';

interface AgingBucket {
  bucket:     '0-30' | '31-60' | '61-90' | '90+';
  count:      number;
  byPriority: Record<string, number>;
}

interface AgingResponse {
  buckets:    AgingBucket[];
  oldestDays: number;
  over90:     number;
  total:      number;
}

const BUCKET_COLORS: Record<string, string> = {
  '0-30':  '#86efac',   // green
  '31-60': '#fcd34d',   // amber
  '61-90': '#fb923c',   // orange
  '90+':   '#ef4444',   // red
};

interface Props { filters: RMFilters }

export default function TicketAgingChart({ filters }: Props) {
  const [data, setData] = useState<AgingResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
      category:  filters.category,
    }).toString();
    setLoading(true);
    fetch(`/api/rm/ticket-aging?${qs}`)
      .then(r => r.json())
      .then(j => setData(j.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const maxCount = data ? Math.max(1, ...data.buckets.map(b => b.count)) : 1;

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 flex flex-col" style={{ minHeight: 280 }}>
      <div className="text-[11px] font-medium text-gray-800 mb-3">Open Ticket Aging</div>

      <div className="flex-1 flex flex-col gap-2 justify-center">
        {loading ? (
          <div className="text-xs text-gray-400 text-center">Loading…</div>
        ) : !data || data.total === 0 ? (
          <div className="text-xs text-gray-400 text-center">No open tickets</div>
        ) : (
          data.buckets.map(b => {
            const pct = (b.count / maxCount) * 100;
            return (
              <div key={b.bucket} className="flex items-center gap-2">
                <div className="w-[60px] text-[11px] font-medium text-gray-700">{b.bucket} d</div>
                <div className="flex-1 h-7 bg-gray-100 rounded relative overflow-hidden">
                  <div className="h-full rounded transition-all flex items-center px-2 text-[10px] text-gray-900 font-medium"
                       style={{ width: `${pct}%`, background: BUCKET_COLORS[b.bucket] }}>
                    {b.count > 0 && pct > 8 ? `${b.count}` : ''}
                  </div>
                </div>
                <div className="w-[40px] text-right text-[11px] font-medium text-gray-900">{b.count}</div>
              </div>
            );
          })
        )}
      </div>

      {data && data.total > 0 && (
        <div className="text-[10px] text-gray-500 mt-3">
          {data.over90} tickets &gt; 90 days · oldest open: {data.oldestDays}d
        </div>
      )}
    </div>
  );
}
