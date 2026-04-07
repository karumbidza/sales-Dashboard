// components/ui/SiteDetailModal.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

interface Props {
  siteCode: string;
  dateFrom: string;
  dateTo: string;
  onClose: () => void;
}

function fmtVol(n: number)  { return n?.toLocaleString('en', { maximumFractionDigits: 0 }) ?? '—'; }
function fmtPct(n: number | null) { return n != null ? `${n.toFixed(1)}%` : '—'; }
function fmtRev(n: number)  { return n != null ? `$${n.toLocaleString('en', { maximumFractionDigits: 2 })}` : '—'; }

export default function SiteDetailModal({ siteCode, dateFrom, dateTo, onClose }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/site-details?siteCode=${siteCode}&dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(r => r.json())
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [siteCode, dateFrom, dateTo]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const vsBudgetColor = (pct: number | null) =>
    pct == null ? 'text-gray-400' : pct >= 100 ? 'text-emerald-600' : pct >= 85 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#1e3a5f] text-white px-6 py-4 rounded-t-2xl flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">
              {loading ? 'Loading…' : data?.siteInfo?.site_name || siteCode}
            </h2>
            {data?.siteInfo && (
              <div className="flex gap-3 mt-1">
                <span className="text-xs text-blue-200">{data.siteInfo.territory_name || 'Unassigned'}</span>
                {data.siteInfo.moso && (
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded">{data.siteInfo.moso}</span>
                )}
                {data.rank && (
                  <span className="text-xs text-blue-200">
                    Rank #{data.rank.territory_rank} of {data.rank.territory_site_count} in territory
                  </span>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-blue-200 hover:text-white text-xl leading-none ml-4">×</button>
        </div>

        {loading && (
          <div className="p-10 text-center text-gray-300">Loading site data…</div>
        )}

        {!loading && data && (
          <div className="p-6 space-y-6">
            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total Volume', value: `${fmtVol(data.kpis.total_volume)} L`, sub: `Budget: ${fmtVol(data.kpis.budget_volume)} L` },
                { label: 'Vs Budget', value: fmtPct(data.kpis.vs_budget_pct), color: vsBudgetColor(data.kpis.vs_budget_pct) },
                { label: 'Avg Daily', value: `${fmtVol(data.kpis.avg_daily)} L/d`, sub: `${data.kpis.days_traded} days` },
                { label: 'Cash Ratio', value: fmtPct(data.kpis.cash_ratio_pct), sub: 'Cash / Revenue' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{k.label}</p>
                  <p className={`text-xl font-bold ${k.color || 'text-gray-900'}`}>{k.value}</p>
                  {k.sub && <p className="text-xs text-gray-400 mt-1">{k.sub}</p>}
                </div>
              ))}
            </div>

            {/* Product mix */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Diesel', vol: data.kpis.diesel_volume, color: 'bg-blue-100 text-blue-800' },
                { label: 'Blend',  vol: data.kpis.blend_volume,  color: 'bg-cyan-100 text-cyan-800' },
                { label: 'ULP',    vol: data.kpis.ulp_volume,    color: 'bg-emerald-100 text-emerald-800' },
              ].map(p => {
                const total = data.kpis.total_volume || 1;
                const pct = Math.round((p.vol / total) * 100);
                return (
                  <div key={p.label} className={`rounded-xl p-4 ${p.color}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1">{p.label}</p>
                    <p className="text-lg font-bold">{fmtVol(p.vol)} L</p>
                    <div className="mt-2 bg-white/50 rounded-full h-1.5">
                      <div className="bg-current h-1.5 rounded-full opacity-60" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs mt-1 opacity-70">{pct}% of total</p>
                  </div>
                );
              })}
            </div>

            {/* Daily trend chart */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily Volume</h3>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={data.daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.floor(data.daily.length / 12)} />
                  <YAxis tick={{ fontSize: 10 }} width={50}
                    tickFormatter={(n: number) => n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(n)} />
                  <Tooltip
                    formatter={(v: number, name: string) => [v?.toLocaleString('en') + ' L', name]}
                    labelStyle={{ fontSize: 11 }}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Bar dataKey="diesel" name="Diesel" stackId="a" fill="#1e40af" />
                  <Bar dataKey="blend"  name="Blend"  stackId="a" fill="#0891b2" />
                  <Bar dataKey="ulp"    name="ULP"    stackId="a" fill="#059669" radius={[2,2,0,0]} />
                  <Line type="monotone" dataKey="total" name="Total" stroke="#6366f1" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Financial & Reconciliation row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Margin */}
              {data.margin && (
                <div className="bg-gray-50 rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                    📊 Margin (Dynamics)
                  </h4>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Invoiced Volume</span>
                      <span className="font-medium">{fmtVol(data.margin.inv_volume)} L</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Avg Selling Price</span>
                      <span className="font-medium">${data.margin.avg_price?.toFixed(4)}/L</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Unit Gross Margin</span>
                      <span className="font-medium">${data.margin.unit_margin?.toFixed(4)}/L</span>
                    </div>
                    <div className="flex justify-between border-t border-gray-200 pt-1.5">
                      <span className="text-gray-700 font-semibold">Gross Margin</span>
                      <span className="font-bold text-gray-900">{fmtRev(data.margin.gross_margin)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Reconciliation */}
              <div className={`rounded-xl p-4 ${
                data.reconciliation?.is_flagged
                  ? 'bg-red-50 border border-red-200'
                  : 'bg-emerald-50 border border-emerald-200'}`}>
                <h4 className="text-xs font-semibold uppercase tracking-wide mb-3"
                  style={{ color: data.reconciliation?.is_flagged ? '#991b1b' : '#065f46' }}>
                  {data.reconciliation?.is_flagged ? '⚠ Reconciliation Gap' : '✓ Reconciliation OK'}
                </h4>
                {data.reconciliation ? (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Variance (L)</span>
                      <span className={`font-semibold ${data.reconciliation.is_flagged ? 'text-red-700' : 'text-emerald-700'}`}>
                        {data.reconciliation.variance > 0 ? '+' : ''}
                        {data.reconciliation.variance?.toLocaleString('en')} L
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Variance %</span>
                      <span className={`font-semibold ${data.reconciliation.is_flagged ? 'text-red-700' : 'text-emerald-700'}`}>
                        {fmtPct(data.reconciliation.variance_pct)}
                      </span>
                    </div>
                    {data.reconciliation.notes && (
                      <p className="text-gray-500 mt-2 italic">{data.reconciliation.notes}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No reconciliation data for this period</p>
                )}
              </div>
            </div>

            {/* Petrotrade */}
            {data.petrotrade?.volume > 0 && (
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-2">
                  🤝 Petrotrade Volumes (included in total)
                </h4>
                <div className="flex gap-8 text-sm">
                  <div>
                    <span className="text-gray-500 text-xs">Volume</span>
                    <p className="font-bold text-purple-800">{fmtVol(data.petrotrade.volume)} L</p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Margin (@$0.05/L)</span>
                    <p className="font-bold text-purple-800">{fmtRev(data.petrotrade.margin)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Dip variance / gain-loss */}
            {(Math.abs(data.kpis.diesel_gain_loss) > 10 ||
              Math.abs(data.kpis.blend_gain_loss) > 10 ||
              Math.abs(data.kpis.ulp_gain_loss) > 10) && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">
                  ⚠ Dip Variance (Gain/Loss)
                </h4>
                <div className="flex gap-8 text-xs">
                  {[
                    { label: 'Diesel', val: data.kpis.diesel_gain_loss },
                    { label: 'Blend',  val: data.kpis.blend_gain_loss },
                    { label: 'ULP',    val: data.kpis.ulp_gain_loss },
                  ].map(g => (
                    <div key={g.label}>
                      <span className="text-gray-500">{g.label}</span>
                      <p className={`font-semibold ${Math.abs(g.val) > 50 ? 'text-red-600' : 'text-amber-700'}`}>
                        {g.val > 0 ? '+' : ''}{g.val?.toLocaleString('en', { maximumFractionDigits: 1 })} L
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
