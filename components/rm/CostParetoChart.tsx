'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts';
import type { RMFilters } from './RMFilterBar';

interface ParetoItem {
  labelKey: string;
  label:    string;
  cost:     number;
  cumulativePct: number;
  tier:     1 | 2 | 3 | 4;
}

interface ParetoResponse {
  dimension: 'category' | 'site';
  total:     number;
  items:     ParetoItem[];
  itemsTo80: number;
}

const TIER_COLOR: Record<number, string> = {
  1: '#1e3a5f',  // top
  2: '#3b82f6',
  3: '#93c5fd',
  4: '#cbd5e1',  // tail
};

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

interface Props {
  filters: RMFilters;
}

export default function CostParetoChart({ filters }: Props) {
  const router = useRouter();
  const [dimension, setDimension] = useState<'category' | 'site'>('category');
  const [data, setData] = useState<ParetoResponse | null>(null);
  const [loading, setLoading] = useState(true);

  function onBarClick(it: any) {
    const labelKey = it?.payload?.labelKey || it?.labelKey;
    if (!labelKey) return;
    if (dimension === 'category') {
      router.push(`/dashboard/category/${encodeURIComponent(labelKey)}`);
    }
    // No site drill-in for cost — site is already a dashboard filter.
  }

  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
      category:  filters.category,
      dimension,
    }).toString();
    setLoading(true);
    fetch(`/api/rm/cost-pareto?${qs}`)
      .then(r => r.json())
      .then(j => setData(j.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters, dimension]);

  const items = (data?.items || []).slice(0, 12);  // cap at 12 for readability

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-medium text-gray-800">Cost Pareto</div>
        <div className="flex gap-0.5">
          <button onClick={() => setDimension('category')}
                  className={`text-[10px] px-2 py-0.5 rounded ${dimension === 'category' ? 'bg-[#1e3a5f] text-white' : 'border border-gray-300 text-gray-600'}`}>
            By category
          </button>
          <button onClick={() => setDimension('site')}
                  className={`text-[10px] px-2 py-0.5 rounded ${dimension === 'site' ? 'bg-[#1e3a5f] text-white' : 'border border-gray-300 text-gray-600'}`}>
            By site
          </button>
        </div>
      </div>

      <div style={{ height: 280 }}>
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">No data in window</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={items} margin={{ top: 8, right: 30, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={50} />
              <YAxis yAxisId="left"  tick={{ fontSize: 10 }} tickFormatter={(v) => fmtCurrency(v)} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                formatter={(v: number, name: string) => name === 'cumulativePct' ? `${v}%` : fmtCurrency(v)}
              />
              <Bar yAxisId="left" dataKey="cost" onClick={onBarClick} cursor={dimension === 'category' ? 'pointer' : 'default'}>
                {items.map((it, idx) => <Cell key={idx} fill={TIER_COLOR[it.tier]} />)}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="cumulativePct" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} />
              <ReferenceLine yAxisId="right" y={80} stroke="#dc2626" strokeDasharray="4 3"
                             label={{ value: '80%', position: 'insideTopRight', fontSize: 9, fill: '#dc2626' }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="text-[10px] text-gray-500 mt-2 flex items-center justify-between">
        <span>{data && `${data.itemsTo80} ${data.dimension === 'category' ? 'categories' : 'sites'} drive 80% of cost`}</span>
        {dimension === 'category' && <span className="italic">click a bar to deep-dive</span>}
      </div>
    </div>
  );
}
