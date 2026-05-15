'use client';

import { useEffect, useState } from 'react';
import type { RMFilters } from './RMFilterBar';

interface KpiData {
  openTickets: { total: number; urgent: number };
  mttr:        { days: number | null; priorMonthDays: number | null };
  slaHit:      { hitPct: number | null; breachCount: number };
  repeats:     { siteCount: number };
}

function Card({ label, value, subLine }: { label: string; value: string; subLine: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-md p-3 flex flex-col gap-1" style={{ minHeight: 88 }}>
      <div className="text-[10px] uppercase tracking-[0.3px] font-semibold text-gray-500">{label}</div>
      <div className="text-[19px] font-medium text-gray-900 leading-tight">{value}</div>
      <div className="text-[10px] text-gray-600">{subLine}</div>
    </div>
  );
}

function fmtDelta(curr: number | null, prior: number | null, badIfUp: boolean): React.ReactNode {
  if (curr === null || prior === null || prior === 0) return <span className="text-gray-400">no prior data</span>;
  const isUp = curr > prior;
  const arrow = isUp ? '▲' : curr < prior ? '▼' : '•';
  const isGood = badIfUp ? !isUp : isUp;
  const color = isGood ? 'text-[#15803d]' : 'text-[#b91c1c]';
  return <span className={color}>{arrow} vs {prior.toFixed(1)}d LM</span>;
}

interface Props { filters: RMFilters }

export default function EfficiencyKpiStrip({ filters }: Props) {
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
    fetch(`/api/rm/kpis-efficiency?${qs}`)
      .then(r => r.json())
      .then(j => { if (j.error) throw new Error(j.error); setData(j.data); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters]);

  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-2 mb-[10px]">
        {[0,1,2,3].map(i => (
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
        Efficiency KPIs unavailable: {error || 'no data'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2 mb-[10px]">
      <Card
        label="Open Tickets"
        value={data.openTickets.total.toString()}
        subLine={
          data.openTickets.urgent > 0
            ? <span className="text-[#b91c1c]">{data.openTickets.urgent} urgent</span>
            : <span className="text-gray-500">0 urgent</span>
        }
      />
      <Card
        label="MTTR"
        value={data.mttr.days !== null ? `${data.mttr.days}d` : '—'}
        subLine={fmtDelta(data.mttr.days, data.mttr.priorMonthDays, /* badIfUp */ true)}
      />
      <Card
        label="SLA Hit Rate"
        value={data.slaHit.hitPct !== null ? `${data.slaHit.hitPct.toFixed(1)}%` : '—'}
        subLine={
          data.slaHit.breachCount > 0
            ? <span className="text-[#b91c1c]">{data.slaHit.breachCount} breaches</span>
            : <span className="text-gray-500">0 breaches</span>
        }
      />
      <Card
        label="Repeat Issues"
        value={data.repeats.siteCount.toString()}
        subLine={<span className="text-gray-500">sites · 3+ same fault in 90d</span>}
      />
    </div>
  );
}
