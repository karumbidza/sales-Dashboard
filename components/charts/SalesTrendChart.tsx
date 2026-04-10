// components/charts/SalesTrendChart.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface ChartFilters {
  territory?: string;
  product?:   string;
  siteCode?:  string;
  moso?:      string;
}

interface Props {
  data: any[];
  type: 'daily' | 'monthly';
  filters?: ChartFilters;   // ignored for monthly; daily uses it for self-fetch
}

const COLORS = {
  diesel:    '#1e40af',
  blend:     '#0891b2',
  ulp:       '#059669',
  budget:    '#f59e0b',
  stretch:   '#dc2626',
  total:     '#6366f1',
  cumGray:   '#9ca3af',
};

function fmtVol(n: number) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}
function fmtFull(n: number) {
  return Math.round(n || 0).toLocaleString('en');
}

// ──────────────────────────────────────────────────────────────
// MonthPicker — small inline dropdown shown in daily-drilldown view
// ──────────────────────────────────────────────────────────────

function MonthPicker({
  value, onChange, months,
}: {
  value: string;
  onChange: (v: string) => void;
  months: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        fontSize: 11, padding: '2px 6px', height: 24,
        border: '1px solid #e5e7eb', borderRadius: 5,
        background: '#fff', color: '#374151', cursor: 'pointer',
      }}
    >
      {months.map(m => (
        <option key={m.value} value={m.value}>{m.label}</option>
      ))}
    </select>
  );
}

// ──────────────────────────────────────────────────────────────
// Tooltips
// ──────────────────────────────────────────────────────────────

const StandardTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[180px]">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-4 mb-1">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-medium tabular-nums">{fmtVol(p.value ?? 0)} L</span>
        </div>
      ))}
    </div>
  );
};

const DailyDrillTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const diesel = row.diesel_volume || 0;
  const blend  = row.blend_volume  || 0;
  const ulp    = row.ulp_volume    || 0;
  const total  = row.actual_volume || diesel + blend + ulp;
  const rate    = row.daily_budget_rate  || 0;
  const stretch = row.daily_stretch_rate || 0;
  const vsBud   = rate > 0 ? ((total - rate) / rate) * 100 : null;
  const vsStr   = stretch > 0 ? ((total - stretch) / stretch) * 100 : null;
  const vsCol  = vsBud == null ? '#6b7280'
               : vsBud >= 10 ? '#16a34a'
               : vsBud >= -10 ? '#d97706'
               : '#dc2626';

  // 'YYYY-MM-DD' → 'DD Mon'
  let dateLbl = row.date || row.period || '';
  const m = String(dateLbl).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    dateLbl = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[200px]">
      <p className="font-semibold text-gray-700 mb-2">{dateLbl}</p>
      <Row color={COLORS.diesel} label="Diesel" value={diesel} />
      <Row color={COLORS.blend}  label="Blend"  value={blend} />
      <Row color={COLORS.ulp}    label="ULP"    value={ulp} />
      <div className="border-t border-gray-100 my-1.5" />
      <Row color={COLORS.total} label="Total" value={total} bold />
      <div className="border-t border-gray-100 my-1.5" />
      <div className="flex justify-between gap-4 mb-1">
        <span className="text-gray-500">Daily budget</span>
        <span className="font-medium tabular-nums text-gray-700">{fmtFull(rate)} L</span>
      </div>
      <div className="flex justify-between gap-4 mb-1">
        <span className="text-gray-500">Daily stretch</span>
        <span className="font-medium tabular-nums text-gray-700">{fmtFull(stretch)} L</span>
      </div>
      <div className="flex justify-between gap-4 mb-1">
        <span className="text-gray-500">Vs budget</span>
        <span className="font-bold tabular-nums" style={{ color: vsCol }}>
          {vsBud == null ? '—' : `${vsBud >= 0 ? '+' : ''}${vsBud.toFixed(1)}%`}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-500">Vs stretch</span>
        <span className="font-bold tabular-nums"
              style={{ color: vsStr == null ? '#6b7280' : vsStr >= 0 ? '#16a34a' : '#dc2626' }}>
          {vsStr == null ? '—' : `${vsStr >= 0 ? '+' : ''}${vsStr.toFixed(1)}%`}
        </span>
      </div>
    </div>
  );
};

const Row = ({ color, label, value, bold }: { color: string; label: string; value: number; bold?: boolean }) => (
  <div className="flex justify-between gap-4 mb-1">
    <span style={{ color }}>{label}</span>
    <span className={`tabular-nums ${bold ? 'font-bold text-gray-800' : 'font-medium text-gray-700'}`}>
      {fmtFull(value)} L
    </span>
  </div>
);

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthLabel(yyyymm: string): string {
  const m = yyyymm.match(/^(\d{4})-(\d{2})/);
  if (!m) return yyyymm;
  return `${MONTH_LABELS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function buildLast12Months(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 12; i++) {
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value: v, label: monthLabel(v) });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function daysInMonth(yyyymm: string): number {
  const m = yyyymm.match(/^(\d{4})-(\d{2})/);
  if (!m) return 30;
  return new Date(parseInt(m[1]), parseInt(m[2]), 0).getDate();
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

export default function SalesTrendChart({ data, type, filters }: Props) {
  if (type === 'monthly') return <MonthlyChart filters={filters} />;
  return <DailyDrilldownChart filters={filters} />;
}

// ──────────────────────────────────────────────────────────────
// Monthly chart (unchanged)
// ──────────────────────────────────────────────────────────────

function MonthlyChart({ filters }: { filters?: ChartFilters }) {
  // Self-fetch the last 12 months ending with the current month, independent
  // of the global date filter so the chart always shows a full annual view.
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const dateTo = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
    const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    const dateFrom = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;

    const qs = new URLSearchParams({ dateFrom, dateTo, granularity: 'monthly' });
    if (filters?.territory) qs.set('territory', filters.territory);
    if (filters?.product)   qs.set('product',   filters.product);
    if (filters?.siteCode)  qs.set('siteCode',  filters.siteCode);
    if (filters?.moso)      qs.set('moso',      filters.moso);

    setLoading(true);
    fetch(`/api/sales-trend?${qs.toString()}`)
      .then(r => r.json())
      .then(j => setRows(j.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [filters?.territory, filters?.product, filters?.siteCode, filters?.moso]);

  // Build a 12-month skeleton so every month appears even if there is no data
  const data = useMemo(() => {
    const out: any[] = [];
    const today = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const label  = `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
      const row = rows.find(r => String(r.period).slice(0, 10) === period);
      out.push({
        period,
        label,
        diesel_volume:  row?.diesel_volume  ?? 0,
        blend_volume:   row?.blend_volume   ?? 0,
        ulp_volume:     row?.ulp_volume     ?? 0,
        actual_volume:  row?.actual_volume  ?? 0,
        budget_volume:  row?.budget_volume  ?? null,
        stretch_volume: row?.stretch_volume ?? null,
      });
    }
    return out;
  }, [rows]);

  if (loading && rows.length === 0) {
    return <div className="h-64 flex items-center justify-center text-gray-300 text-sm">Loading…</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap="18%">
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
        <YAxis tickFormatter={fmtVol} tick={{ fontSize: 11 }} width={55} />
        <Tooltip content={<StandardTooltip />} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />

        <Bar dataKey="diesel_volume" name="Diesel" stackId="a" fill={COLORS.diesel} maxBarSize={55} />
        <Bar dataKey="blend_volume"  name="Blend"  stackId="a" fill={COLORS.blend}  maxBarSize={55} />
        <Bar dataKey="ulp_volume"    name="ULP"    stackId="a" fill={COLORS.ulp}    maxBarSize={55} radius={[2,2,0,0]} />
        <Line type="monotone" dataKey="budget_volume"  name="Budget"
              stroke={COLORS.budget}  strokeWidth={2}   strokeDasharray="5 5" dot={{ r: 3 }} />
        <Line type="monotone" dataKey="stretch_volume" name="Stretch"
              stroke={COLORS.stretch} strokeWidth={1.5} strokeDasharray="3 3" dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ──────────────────────────────────────────────────────────────
// Daily drilldown chart — month picker + stacked bars + total +
// flat daily-budget-rate line + cumulative total
// ──────────────────────────────────────────────────────────────

function DailyDrilldownChart({ filters }: { filters?: ChartFilters }) {
  const months = useMemo(() => buildLast12Months(), []);

  const defaultMonth = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const [selected, setSelected] = useState<string>(defaultMonth);
  const [rawData, setRawData]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);

  // Self-fetch whenever the selected month or non-date filters change.
  // Independent of the global date filter — drilldown owns its date range.
  useEffect(() => {
    const m = selected.match(/^(\d{4})-(\d{2})$/);
    if (!m) return;
    const year  = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`;
    const dateTo   = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

    const qs = new URLSearchParams({ dateFrom, dateTo, granularity: 'daily' });
    if (filters?.territory) qs.set('territory', filters.territory);
    if (filters?.product)   qs.set('product',   filters.product);
    if (filters?.siteCode)  qs.set('siteCode',  filters.siteCode);
    if (filters?.moso)      qs.set('moso',      filters.moso);

    setLoading(true);
    fetch(`/api/sales-trend?${qs.toString()}`)
      .then(r => r.json())
      .then(j => setRawData(j.data || []))
      .catch(() => setRawData([]))
      .finally(() => setLoading(false));
  }, [selected, filters?.territory, filters?.product, filters?.siteCode, filters?.moso]);

  // Compute daily budget rate + cumulative for the loaded month
  const monthData = useMemo(() => {
    const filtered = rawData ?? [];
    const monthlyBudget  = filtered[0]?.budget_volume  ?? 0;
    const monthlyStretch = filtered[0]?.stretch_volume ?? 0;
    const dim = daysInMonth(selected);
    const dailyRate    = dim > 0 ? monthlyBudget  / dim : 0;
    const dailyStretch = dim > 0 ? monthlyStretch / dim : 0;

    const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let runningActual = 0;
    let runningBudget = 0;
    return filtered.map(d => {
      const total = Number(d.actual_volume || 0);
      runningActual += total;
      runningBudget += dailyRate;
      const iso = String(d.date || d.period || '');
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
      let dayLabel = iso.slice(8, 10);
      if (m) {
        const dt = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
        dayLabel = `${WEEKDAYS[dt.getDay()]} ${m[3]}`;
      }
      return {
        ...d,
        dayLabel,
        daily_budget_rate:  dailyRate,
        daily_stretch_rate: dailyStretch,
        met_budget:  dailyRate    > 0 && total >= dailyRate,
        met_stretch: dailyStretch > 0 && total >= dailyStretch,
        cum_actual: runningActual,
        cum_budget: runningBudget,
      };
    });
  }, [rawData, selected]);

  const monthlyBudget  = monthData[0]?.budget_volume   ?? 0;
  const monthlyStretch = monthData[0]?.stretch_volume  ?? 0;
  const dailyRate      = monthData[0]?.daily_budget_rate  ?? 0;
  const dailyStretch   = monthData[0]?.daily_stretch_rate ?? 0;
  const totalActual    = monthData.reduce((a, d) => a + (d.actual_volume || 0), 0);
  const metDays        = monthData.filter(d => d.met_budget).length;

  return (
    <div>
      {/* Header: title + month picker */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-600">
          Daily Volume — {monthLabel(selected)}
          {monthlyBudget > 0 && (
            <span className="ml-2 text-[10px] text-gray-400 font-normal">
              · daily budget {fmtFull(dailyRate)} L
              · daily stretch {fmtFull(dailyStretch)} L
              · met budget {metDays}/{monthData.length} days
            </span>
          )}
        </p>
        <MonthPicker value={selected} onChange={setSelected} months={months} />
      </div>

      {monthData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-300 text-sm">
          {loading ? 'Loading…' : `No data for ${monthLabel(selected)}`}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={monthData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} interval={0} />
            <YAxis tickFormatter={fmtVol} tick={{ fontSize: 11 }} width={55} />
            <Tooltip content={<DailyDrillTooltip />} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />

            <Line
              type="monotone"
              dataKey="actual_volume"
              name="Total"
              stroke={COLORS.total}
              strokeWidth={2}
              dot={(props: any) => {
                const { cx, cy, payload, index } = props;
                if (cx == null || cy == null) return <g key={`dot-${index}`} />;
                if (payload?.met_stretch) {
                  return <circle key={`dot-${index}`} cx={cx} cy={cy} r={4.5}
                                 fill="#16a34a" stroke="#fff" strokeWidth={1.5} />;
                }
                if (payload?.met_budget) {
                  return <circle key={`dot-${index}`} cx={cx} cy={cy} r={4}
                                 fill="#84cc16" stroke="#fff" strokeWidth={1.5} />;
                }
                return <circle key={`dot-${index}`} cx={cx} cy={cy} r={3}
                               fill="#fff" stroke={COLORS.total} strokeWidth={1.5} />;
              }}
              activeDot={{ r: 5 }}
            />

            {dailyRate > 0 && (
              <Line
                type="monotone"
                dataKey="daily_budget_rate"
                name="Daily budget"
                stroke={COLORS.budget}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            )}

            {dailyStretch > 0 && (
              <Line
                type="monotone"
                dataKey="daily_stretch_rate"
                name="Daily stretch"
                stroke={COLORS.stretch}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={false}
              />
            )}

            <Line
              type="monotone"
              dataKey="cum_actual"
              name="Cumulative"
              stroke={COLORS.cumGray}
              strokeWidth={1.2}
              strokeDasharray="2 4"
              dot={false}
              hide
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
