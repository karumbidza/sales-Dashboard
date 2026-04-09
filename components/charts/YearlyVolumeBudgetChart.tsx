// components/charts/YearlyVolumeBudgetChart.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell, LabelList,
} from 'recharts';

type Product = 'total' | 'diesel' | 'blend' | 'ulp';

interface MonthRow {
  month: string;
  monthLabel: string;
  isFuture: boolean;
  isCurrent: boolean;
  actualCY: { diesel: number; blend: number; ulp: number; total: number } | null;
  actualPY: { diesel: number; blend: number; ulp: number; total: number } | null;
  budgetCY: number | null;
}

interface ApiResponse {
  year: number;
  priorYear: number;
  latestSaleDate: string;
  data: MonthRow[];
}

interface Props {
  filters?: {
    territory?: string;
    moso?:      string;
    siteCode?:  string;
  };
}

const COLORS = {
  actualCY: '#1e40af',  // strong blue
  budgetCY: '#f59e0b',  // amber
  actualPY: '#94a3b8',  // slate
};

function fmtVol(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toLocaleString('en');
}
function fmtFull(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en');
}
function pct(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null || den === 0) return null;
  return ((num - den) / den) * 100;
}
function fmtPct(p: number | null) {
  if (p == null) return '—';
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

export default function YearlyVolumeBudgetChart({ filters }: Props) {
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<Product>('total');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (filters?.territory) params.set('territory', filters.territory);
    if (filters?.moso)      params.set('moso',      filters.moso);
    if (filters?.siteCode)  params.set('siteCode',  filters.siteCode);
    fetch(`/api/yearly-volume-vs-budget?${params}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { /* swallow */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters?.territory, filters?.moso, filters?.siteCode]);

  // Transform API rows into chart-ready rows for the selected product
  const chartRows = useMemo(() => {
    if (!data) return [];
    return data.data.map(r => {
      const actualCY = r.actualCY ? r.actualCY[product] : null;
      const actualPY = r.actualPY ? r.actualPY[product] : null;
      const budgetCY = product === 'total' ? r.budgetCY : null; // budget is total-only
      const yoy = pct(actualCY, actualPY);
      const vsBud = pct(actualCY, budgetCY);
      return {
        monthLabel: r.monthLabel,
        month: r.month,
        isFuture: r.isFuture,
        isCurrent: r.isCurrent,
        actualCY,
        budgetCY,
        actualPY,
        yoy,
        vsBud,
        // Vs-budget % label sits above each completed month's CY actual bar
        vsBudLabel: r.isFuture || actualCY == null || vsBud == null ? '' : fmtPct(vsBud),
      };
    });
  }, [data, product]);

  // Custom in-bar value renderer: rotated -90° vertical text in white,
  // centered on the bar. Hidden if the bar is too short to fit the text.
  const inBarValueLabel = (props: any) => {
    const { x, y, width, height, value } = props;
    if (value == null || value === 0) return null;
    if (height < 28) return null; // bar too short — skip
    const cx = x + width / 2;
    const cy = y + height / 2;
    return (
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        fill="#ffffff"
        fontSize={9}
        fontWeight={600}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ pointerEvents: 'none' }}
      >
        {fmtVol(value)} L
      </text>
    );
  };

  // Index of last completed (non-future) month — used for the "today" divider
  const lastCompletedIdx = useMemo(() => {
    if (!chartRows.length) return -1;
    let i = -1;
    chartRows.forEach((r, idx) => { if (!r.isFuture) i = idx; });
    return i;
  }, [chartRows]);

  const TOGGLES: { key: Product; label: string }[] = [
    { key: 'total',  label: 'Total'  },
    { key: 'diesel', label: 'Diesel' },
    { key: 'blend',  label: 'Blend'  },
    { key: 'ulp',    label: 'ULP'    },
  ];

  return (
    <div>
      {/* Header: title + product toggle */}
      <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">
            {data?.year ?? ''} Volume — Actual vs Budget vs Last Year
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Independent of date filters · respects territory, MOSO and site filters · future months show budget &amp; prior‑year as reference
          </p>
        </div>
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-md p-0.5">
          {TOGGLES.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setProduct(t.key)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded transition ${
                product === t.key
                  ? 'bg-white shadow text-gray-900 border border-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="text-center text-xs text-gray-300 py-12">Loading…</div>
      )}

      {!loading && (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartRows} margin={{ top: 24, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis
              tick={{ fontSize: 11, fill: '#6b7280' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickFormatter={(v) => fmtVol(v)}
            />
            <Tooltip
              cursor={{ fill: 'rgba(99,102,241,0.06)' }}
              content={({ payload, label }) => {
                if (!payload || !payload.length) return null;
                const r = payload[0].payload as typeof chartRows[number];
                return (
                  <div style={{
                    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                    padding: '10px 12px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                      {label} {data?.year} {r.isFuture && (
                        <span style={{ fontSize: 9, padding: '1px 6px', background: '#f3f4f6', color: '#6b7280', borderRadius: 4, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Reference
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', alignItems: 'center' }}>
                      <span style={{ display: 'inline-block', width: 9, height: 9, background: COLORS.actualCY, borderRadius: 2 }} />
                      <span style={{ color: '#374151' }}>
                        Actual {data?.year}: <strong>{fmtFull(r.actualCY)}</strong>
                        {r.isFuture && <span style={{ color: '#9ca3af' }}> — pending</span>}
                      </span>
                      <span style={{ display: 'inline-block', width: 9, height: 9, background: COLORS.budgetCY, borderRadius: 2 }} />
                      <span style={{ color: '#374151' }}>
                        Budget {data?.year}: <strong>{fmtFull(r.budgetCY)}</strong>
                        {r.vsBud != null && (
                          <span style={{ color: r.vsBud >= 0 ? '#16a34a' : '#dc2626', marginLeft: 6 }}>
                            ({fmtPct(r.vsBud)})
                          </span>
                        )}
                      </span>
                      <span style={{ display: 'inline-block', width: 9, height: 9, background: COLORS.actualPY, borderRadius: 2 }} />
                      <span style={{ color: '#374151' }}>
                        Actual {data?.priorYear}: <strong>{fmtFull(r.actualPY)}</strong>
                        {r.yoy != null && r.actualCY != null && (
                          <span style={{ color: r.yoy >= 0 ? '#16a34a' : '#dc2626', marginLeft: 6 }}>
                            (YoY {fmtPct(r.yoy)})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
              iconType="square"
              formatter={(v) => <span style={{ color: '#374151' }}>{v}</span>}
            />

            {/* Today divider — between last completed month and the first future month */}
            {lastCompletedIdx >= 0 && lastCompletedIdx < 11 && (
              <ReferenceLine
                x={chartRows[lastCompletedIdx].monthLabel}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                label={{ value: 'today', fontSize: 9, fill: '#64748b', position: 'top' }}
              />
            )}

            {/* Bars: future months get softer fill via Cell opacity */}
            <Bar dataKey="actualCY" name={`Actual ${data?.year ?? ''}`} fill={COLORS.actualCY} radius={[3, 3, 0, 0]}>
              {chartRows.map((r, i) => (
                <Cell key={`cy-${i}`} fill={COLORS.actualCY} fillOpacity={r.isFuture ? 0 : 1} />
              ))}
              {/* Vs-budget % above each completed month */}
              <LabelList
                dataKey="vsBudLabel"
                position="top"
                content={(props: any) => {
                  if (!props.value) return null;
                  const isNeg = String(props.value).startsWith('-');
                  return (
                    <text
                      x={props.x + (props.width || 0) / 2}
                      y={(props.y || 0) - 4}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      fill={isNeg ? '#dc2626' : '#16a34a'}
                    >
                      {props.value}
                    </text>
                  );
                }}
              />
            </Bar>
            <Bar dataKey="budgetCY" name={`Budget ${data?.year ?? ''}`} fill={COLORS.budgetCY} radius={[3, 3, 0, 0]}>
              {chartRows.map((r, i) => (
                <Cell key={`bud-${i}`} fill={COLORS.budgetCY} fillOpacity={r.isFuture ? 0.45 : 1} />
              ))}
            </Bar>
            <Bar dataKey="actualPY" name={`Actual ${data?.priorYear ?? ''}`} fill={COLORS.actualPY} radius={[3, 3, 0, 0]}>
              {chartRows.map((r, i) => (
                <Cell key={`py-${i}`} fill={COLORS.actualPY} fillOpacity={r.isFuture ? 0.45 : 1} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* Toggle/legend hint when product is not Total */}
      {product !== 'total' && (
        <p className="text-[10px] text-gray-400 mt-2 text-center">
          Budget rows in the source sheet are stored as a single total per site/month — only shown when viewing <strong>Total</strong>.
        </p>
      )}
    </div>
  );
}
