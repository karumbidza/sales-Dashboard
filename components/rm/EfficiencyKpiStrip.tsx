'use client';

import { useEffect, useState } from 'react';
import type { RMFilters } from './RMFilterBar';

interface KpiData {
  openTickets:       { total: number; urgent: number };
  noActionOpen?:     { value: number; vsLM: number; openCount?: number; pendingCount?: number };
  waitingThirdParty?:{ value: number; vsLM: number };
  mttr:              { days: number | null; priorMonthDays: number | null };
  slaHit:            { hitPct: number | null; breachCount: number };
  repeats:           { siteCount: number };
}

function Card({ label, value, subLine, tooltip }: { label: string; value: string; subLine: React.ReactNode; tooltip?: string }) {
  return (
    <div
      className="bg-gray-50 rounded-md p-3 flex flex-col gap-1"
      style={{ minHeight: 88 }}
      title={tooltip}
    >
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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-[10px]">
        {[0,1,2,3,4].map(i => (
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

  const noActionValue = data.noActionOpen?.value ?? 0;
  const waitingValue  = data.waitingThirdParty?.value ?? 0;
  const noActionVsLM  = data.noActionOpen?.vsLM ?? 0;
  const waitingVsLM   = data.waitingThirdParty?.vsLM ?? 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-[10px]">
      <Card
        label="No-Action Open"
        value={noActionValue.toString()}
        tooltip={
          data.noActionOpen?.openCount !== undefined
            ? `Breakdown: ${data.noActionOpen.openCount} Open + ${data.noActionOpen.pendingCount ?? 0} Pending`
            : undefined
        }
        subLine={
          <div className="flex items-center justify-between gap-2">
            <span>
              {(data.noActionOpen?.openCount ?? 0)}+{(data.noActionOpen?.pendingCount ?? 0)}{' '}
              <span className="text-gray-400">(Open · Pending)</span>
            </span>
            {noActionVsLM !== 0 && (
              <span className={noActionVsLM > 0 ? 'text-[#b91c1c]' : 'text-[#15803d]'}>
                {noActionVsLM > 0 ? '▲' : '▼'} {Math.abs(noActionVsLM)} LM
              </span>
            )}
          </div>
        }
      />
      <Card
        label="Waiting 3rd Party"
        value={waitingValue.toString()}
        subLine={
          waitingVsLM === 0
            ? <span className="text-gray-500">unchanged vs LM</span>
            : <span className={waitingVsLM > 0 ? 'text-[#b91c1c]' : 'text-[#15803d]'}>
                {waitingVsLM > 0 ? '▲' : '▼'} {Math.abs(waitingVsLM)} vs LM
              </span>
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
