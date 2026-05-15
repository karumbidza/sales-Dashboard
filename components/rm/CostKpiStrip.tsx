'use client';

import { useEffect, useState } from 'react';
import type { RMFilters } from './RMFilterBar';

interface KpiData {
  ytd: {
    current: number; priorYear: number; deltaPctLY: number | null;
    budget: number;  deltaPctBudget: number | null;
  };
  mtd: {
    current: number; priorMonth: number; deltaPctMoM: number | null;
    budget: number;  deltaPctBudget: number | null;
  };
  costPerLitre: { current: number | null; fleetMedian: number | null };
  topCategory:  { displayName: string; total: number; pctOfTotal: number | null } | null;
}

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPerLitre(n: number | null): string {
  if (n === null) return '—';
  // n is $/L. Convert to cents/L for legibility (most values are 0.1–5¢/L).
  const cents = n * 100;
  if (Math.abs(cents) >= 100) return `$${n.toFixed(2)}/L`;
  if (Math.abs(cents) >= 1)   return `${cents.toFixed(1)}¢/L`;
  return `${cents.toFixed(2)}¢/L`;
}

function Delta({ pct, goodDirection }: { pct: number | null; goodDirection: 'up' | 'down' }) {
  if (pct === null) return <span className="text-gray-400">—</span>;
  const isUp = pct > 0;
  const arrow = isUp ? '▲' : pct < 0 ? '▼' : '•';
  const isGood = (isUp && goodDirection === 'up') || (!isUp && goodDirection === 'down');
  const color = isGood ? 'text-[#15803d]' : 'text-[#b91c1c]';
  return <span className={color}>{arrow} {Math.abs(pct).toFixed(1)}%</span>;
}

function Card({ label, value, subLine }: { label: string; value: string; subLine: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-md p-3 flex flex-col gap-1" style={{ minHeight: 88 }}>
      <div className="text-[10px] uppercase tracking-[0.3px] font-semibold text-gray-500">{label}</div>
      <div className="text-[19px] font-medium text-gray-900 leading-tight">{value}</div>
      <div className="text-[10px] text-gray-600 flex flex-wrap gap-x-2">{subLine}</div>
    </div>
  );
}

interface Props {
  filters: RMFilters;
}

export default function CostKpiStrip({ filters }: Props) {
  const [data, setData] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
      category:  filters.category,
    }).toString();
    setLoading(true);
    fetch(`/api/rm/kpis-cost?${qs}`)
      .then(r => r.json())
      .then(j => { if (j.error) throw new Error(j.error); setData(j.data); setError(null); })
      .catch(e => setError(e.message || 'Error'))
      .finally(() => setLoading(false));
  }, [filters]);

  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-2 mb-[10px]">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="bg-gray-50 rounded-md p-3 animate-pulse" style={{ minHeight: 88 }}>
            <div className="h-2 w-16 bg-gray-200 rounded mb-2" />
            <div className="h-5 w-24 bg-gray-200 rounded mb-2" />
            <div className="h-2 w-32 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-3 text-xs text-red-700 mb-[10px]">
        Cost KPIs unavailable: {error || 'no data'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2 mb-[10px]">
      <Card
        label="YTD R&M Cost"
        value={fmtCurrency(data.ytd.current)}
        subLine={
          <>
            <span><Delta pct={data.ytd.deltaPctLY} goodDirection="down" /> vs LY</span>
            <span>·</span>
            <span><Delta pct={data.ytd.deltaPctBudget} goodDirection="down" /> vs Bud</span>
          </>
        }
      />
      <Card
        label="MTD R&M Cost"
        value={fmtCurrency(data.mtd.current)}
        subLine={
          <>
            <span><Delta pct={data.mtd.deltaPctMoM} goodDirection="down" /> vs LM</span>
            <span>·</span>
            <span><Delta pct={data.mtd.deltaPctBudget} goodDirection="down" /> vs Bud</span>
          </>
        }
      />
      <Card
        label="Cost / Litre"
        value={fmtPerLitre(data.costPerLitre.current)}
        subLine={
          <span className="text-gray-500">
            fleet median: {fmtPerLitre(data.costPerLitre.fleetMedian)}
          </span>
        }
      />
      <Card
        label="Top Category"
        value={data.topCategory?.displayName || '—'}
        subLine={
          data.topCategory ? (
            <>
              <span>{fmtCurrency(data.topCategory.total)}</span>
              {data.topCategory.pctOfTotal !== null && (
                <>
                  <span>·</span>
                  <span>{data.topCategory.pctOfTotal.toFixed(0)}% of total</span>
                </>
              )}
            </>
          ) : <span className="text-gray-400">no data</span>
        }
      />
    </div>
  );
}
