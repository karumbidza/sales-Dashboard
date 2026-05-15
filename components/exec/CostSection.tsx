'use client';

import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceDot } from 'recharts';

export interface CostData {
  trend: Array<{
    period: string;
    rmCost: number;
    revenue: number;
    rmAsPctOfRevenue: number | null;
  }>;
  topCategories: Array<{
    slug: string;
    displayName: string;
    current: number;
    prior: number;
    momDeltaPct: number | null;
  }>;
}

interface Props {
  cost: CostData;
  currentPeriod: string; // "YYYY-MM"
}

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtDelta(d: number | null): { text: string; cls: string } {
  if (d === null) return { text: '—', cls: 'text-gray-400' };
  const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '•';
  const cls = d > 0 ? 'text-red-600' : d < 0 ? 'text-green-600' : 'text-gray-500';
  return { text: `${arrow} ${Math.abs(d).toFixed(1)}%`, cls };
}

export default function CostSection({ cost, currentPeriod }: Props) {
  const trendForChart = cost.trend.map(t => ({
    period: t.period,
    rmCost: t.rmCost,
    rmPctRevenue: t.rmAsPctOfRevenue ?? 0,
  }));

  const currentRow = cost.trend.find(t => t.period === currentPeriod);

  return (
    <section className="p-8 break-before-page" id="exec-report-cost">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Cost Justification</h2>
      <p className="text-sm text-gray-500 mb-6">R&M spending trend and top cost categories</p>

      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-700 mb-2">R&M Cost — Last 12 Months</h3>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendForChart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCurrency(v)} />
              <Tooltip formatter={(v: number) => fmtCurrency(v)} />
              <Line type="monotone" dataKey="rmCost" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
              {currentRow && (
                <ReferenceDot x={currentPeriod} y={currentRow.rmCost} r={6} fill="#dc2626" stroke="#fff" strokeWidth={2} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-700 mb-2">R&M as % of Revenue</h3>
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendForChart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toFixed(2) + '%'} />
              <Tooltip formatter={(v: number) => v.toFixed(3) + '%'} />
              <Line type="monotone" dataKey="rmPctRevenue" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-700 mb-2">Top Categories This Month</h3>
        {cost.topCategories.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No R&M spend in this period.</p>
        ) : (
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">This Month</th>
                <th className="px-3 py-2 text-right">Prior Month</th>
                <th className="px-3 py-2 text-right">MoM</th>
              </tr>
            </thead>
            <tbody>
              {cost.topCategories.map((c, i) => {
                const d = fmtDelta(c.momDeltaPct);
                return (
                  <tr key={c.slug || `null-${i}`} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-900">{c.displayName}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtCurrency(c.current)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtCurrency(c.prior)}</td>
                    <td className={`px-3 py-2 text-right text-xs font-medium ${d.cls}`}>{d.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
