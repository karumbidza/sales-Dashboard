'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { RMFilters } from './RMFilterBar';

interface TrendPoint { month: string; cost: number }
interface TrendResponse {
  year: number;
  priorYear: number;
  currentYear:     TrendPoint[];
  priorYearSeries: TrendPoint[];
}

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

interface Props { filters: RMFilters }

export default function CostTrendChart({ filters }: Props) {
  const [data, setData] = useState<TrendResponse | null>(null);
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
    fetch(`/api/rm/cost-trend?${qs}`)
      .then(r => r.json())
      .then(j => setData(j.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const merged = useMemo(() => {
    if (!data) return [];
    return data.currentYear.map((p, i) => ({
      month: p.month,
      current: p.cost,
      prior:   data.priorYearSeries[i]?.cost ?? 0,
    }));
  }, [data]);

  const caption = useMemo(() => {
    if (!data || merged.length === 0) return '';
    // Find the first month where current diverges meaningfully (>5%) from prior
    let aboveSince = -1;
    let belowSince = -1;
    for (let i = 0; i < merged.length; i++) {
      const c = merged[i].current;
      const p = merged[i].prior;
      if (c === 0 && p === 0) continue;
      if (p > 0 && c > p * 1.05 && aboveSince === -1) aboveSince = i;
      if (p > 0 && c < p * 0.95 && belowSince === -1) belowSince = i;
    }
    if (aboveSince > -1 && (belowSince === -1 || aboveSince <= belowSince)) {
      return `Above prior year since ${merged[aboveSince].month}`;
    }
    if (belowSince > -1) {
      return `Below prior year since ${merged[belowSince].month}`;
    }
    return 'Tracking close to prior year';
  }, [merged]);

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 flex flex-col" style={{ minHeight: 280 }}>
      <div className="text-[11px] font-medium text-gray-800 mb-2">
        Cost Trend — {data ? `${data.year} vs ${data.priorYear}` : 'YTD vs LY'}
      </div>

      <div className="flex-1" style={{ minHeight: 220 }}>
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : merged.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={merged} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtCurrency(v)} />
              <Tooltip formatter={(v: number) => fmtCurrency(v)} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              <Line type="monotone" dataKey="current" name={data?.year.toString() || 'Current'}
                    stroke="#1e3a5f" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="prior" name={data?.priorYear.toString() || 'Prior'}
                    stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 2" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="text-[10px] text-gray-500 mt-2">{caption}</div>
    </div>
  );
}
