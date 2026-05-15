'use client';

import React from 'react';

export interface HelpdeskData {
  slaHitRate: number | null;
  slaHitRateBaseline: number | null;
  avgResolutionMinutes: number | null;
  avgResolutionMinutesPrior: number | null;
  openAtMonthEnd: {
    total: number;
    byPriority: Record<string, number>;
  };
  topContractors: Array<{
    provider: string;
    ticketCount: number;
    avgResolutionMinutes: number | null;
    slaHitPct: number | null;
  }>;
  topRecurring: Array<{
    descriptionNorm: string;
    sampleSubject: string | null;
    count: number;
    categoryName: string | null;
  }>;
}

interface Props {
  helpdesk: HelpdeskData;
}

function fmtMinutes(m: number | null): string {
  if (m === null) return '—';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
  const d = Math.floor(h / 24);
  const hRem = h % 24;
  return hRem === 0 ? `${d}d` : `${d}d ${hRem}h`;
}

function MetricBlock({
  label, value, comparison,
}: { label: string; value: string; comparison?: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      {comparison && <div className="text-xs text-gray-500 mt-1">{comparison}</div>}
    </div>
  );
}

export default function HelpdeskSection({ helpdesk }: Props) {
  const slaCurr = helpdesk.slaHitRate;
  const slaBase = helpdesk.slaHitRateBaseline;
  const slaDelta = (slaCurr !== null && slaBase !== null) ? +(slaCurr - slaBase).toFixed(1) : null;

  const resCurr = helpdesk.avgResolutionMinutes;
  const resPrior = helpdesk.avgResolutionMinutesPrior;

  const priorityOrder = ['Urgent', 'High', 'Medium', 'Low', 'Unspecified'];
  const sortedPriorities = Object.entries(helpdesk.openAtMonthEnd.byPriority)
    .sort(([a], [b]) => {
      const ai = priorityOrder.indexOf(a);
      const bi = priorityOrder.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  return (
    <section className="p-8 break-before-page" id="exec-report-helpdesk">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Helpdesk Performance</h2>
      <p className="text-sm text-gray-500 mb-6">Service-level metrics and operational state</p>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <MetricBlock
          label="SLA Hit Rate"
          value={slaCurr !== null ? `${slaCurr.toFixed(1)}%` : '—'}
          comparison={
            slaBase !== null
              ? `vs 90-day baseline: ${slaBase.toFixed(1)}% ${slaDelta !== null ? `(${slaDelta >= 0 ? '+' : ''}${slaDelta}pp)` : ''}`
              : undefined
          }
        />
        <MetricBlock
          label="Avg Resolution"
          value={fmtMinutes(resCurr)}
          comparison={resPrior !== null ? `prior month: ${fmtMinutes(resPrior)}` : undefined}
        />
        <MetricBlock
          label="Open at Month-End"
          value={helpdesk.openAtMonthEnd.total.toString()}
          comparison={
            sortedPriorities.length > 0
              ? sortedPriorities.map(([p, n]) => `${p}: ${n}`).join(' · ')
              : undefined
          }
        />
      </div>

      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-700 mb-2">Top Service Providers</h3>
        {helpdesk.topContractors.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No tickets with assigned providers in this period.</p>
        ) : (
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2 text-right">Tickets</th>
                <th className="px-3 py-2 text-right">Avg Resolution</th>
                <th className="px-3 py-2 text-right">SLA Hit %</th>
              </tr>
            </thead>
            <tbody>
              {helpdesk.topContractors.map(c => (
                <tr key={c.provider} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-900">{c.provider}</td>
                  <td className="px-3 py-2 text-right">{c.ticketCount}</td>
                  <td className="px-3 py-2 text-right">{fmtMinutes(c.avgResolutionMinutes)}</td>
                  <td className="px-3 py-2 text-right">
                    {c.slaHitPct !== null ? `${c.slaHitPct.toFixed(0)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-700 mb-2">Top Recurring Problems</h3>
        {helpdesk.topRecurring.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No tickets in this period.</p>
        ) : (
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Issue</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {helpdesk.topRecurring.map((r, i) => (
                <tr key={r.descriptionNorm || `r-${i}`} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-900 max-w-md truncate" title={r.sampleSubject || undefined}>
                    {r.sampleSubject || r.descriptionNorm || '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.categoryName || '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
