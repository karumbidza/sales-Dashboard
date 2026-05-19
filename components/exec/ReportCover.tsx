'use client';

import React from 'react';

export interface CoverData {
  monthLabel: string;
  generatedAt: string;
  volume:  KpiTrio;
  revenue: KpiTrio;
  rmCost:  KpiTrio;
  tickets: KpiTrio;
  rmAsPctOfRevenueCurr:  number | null;
  rmAsPctOfRevenuePrior: number | null;
}

interface KpiTrio {
  current: number;
  prior:   number;
  deltaPct: number | null;
}

interface Props {
  cover: CoverData;
}

function fmtNumber(n: number, opts?: { decimals?: number; currency?: boolean }): string {
  const decimals = opts?.decimals ?? 0;
  const prefix = opts?.currency ? '$' : '';
  if (Math.abs(n) >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${prefix}${(n / 1_000).toFixed(decimals === 0 ? 1 : decimals)}K`;
  return `${prefix}${n.toFixed(decimals)}`;
}

function DeltaPill({ deltaPct, goodDirection }: { deltaPct: number | null; goodDirection: 'up' | 'down' | 'neutral' }) {
  if (deltaPct === null) return <span className="text-xs text-gray-400">—</span>;
  const isUp = deltaPct > 0;
  const arrow = isUp ? '▲' : deltaPct < 0 ? '▼' : '•';
  let color = 'text-gray-500';
  if (goodDirection !== 'neutral') {
    const isGood = (isUp && goodDirection === 'up') || (!isUp && goodDirection === 'down');
    color = isGood ? 'text-green-600' : 'text-red-600';
  }
  return (
    <span className={`text-xs font-medium ${color}`}>
      {arrow} {Math.abs(deltaPct).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  label, value, deltaPct, goodDirection, sublabel,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  goodDirection: 'up' | 'down' | 'neutral';
  sublabel?: string;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mb-1">{value}</div>
      <div className="flex items-center gap-2">
        <DeltaPill deltaPct={deltaPct} goodDirection={goodDirection} />
        {sublabel && <span className="text-xs text-gray-500">{sublabel}</span>}
      </div>
    </div>
  );
}

export default function ReportCover({ cover }: Props) {
  const generatedAt = new Date(cover.generatedAt).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const rmPctCurr  = cover.rmAsPctOfRevenueCurr;
  const rmPctPrior = cover.rmAsPctOfRevenuePrior;

  return (
    <section className="p-8" id="exec-report-cover">
      <div className="text-center mb-12 mt-12">
        <div className="text-sm text-gray-500 uppercase tracking-widest mb-2">Redan Coupon</div>
        <h1 className="text-4xl font-bold text-gray-900 mb-3">Monthly Executive Report</h1>
        <div className="text-2xl text-gray-700 mb-2">{cover.monthLabel}</div>
        <div className="text-sm text-gray-500">Generated {generatedAt}</div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <KpiCard
          label="Fuel Volume"
          value={fmtNumber(cover.volume.current) + ' L'}
          deltaPct={cover.volume.deltaPct}
          goodDirection="up"
          sublabel="vs prior month"
        />
        <KpiCard
          label="Revenue"
          value={fmtNumber(cover.revenue.current, { currency: true })}
          deltaPct={cover.revenue.deltaPct}
          goodDirection="up"
          sublabel="vs prior month"
        />
        <KpiCard
          label="R&M Cost"
          value={fmtNumber(cover.rmCost.current, { currency: true })}
          deltaPct={cover.rmCost.deltaPct}
          goodDirection="down"
          sublabel="vs prior month"
        />
        <KpiCard
          label="Helpdesk Tickets"
          value={cover.tickets.current.toString()}
          deltaPct={cover.tickets.deltaPct}
          goodDirection="neutral"
          sublabel="vs prior month"
        />
      </div>

      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">R&M as % of Revenue</div>
        <div className="text-xl font-semibold text-gray-900">
          {rmPctCurr !== null ? rmPctCurr.toFixed(3) + '%' : '—'}
          {rmPctPrior !== null && (
            <span className="text-sm text-gray-500 ml-3 font-normal">
              prior month: {rmPctPrior.toFixed(3)}%
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
