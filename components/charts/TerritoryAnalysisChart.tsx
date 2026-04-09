// components/charts/TerritoryAnalysisChart.tsx
'use client';

import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';

interface Territory {
  territoryCode?: string;
  territoryName?: string;
  volume?: number;
  budgetVolume?: number;
  stretchVolume?: number;
  vsBudgetPct?: number | null;
  vsStretchPct?: number | null;
  siteCount?: number;
}

interface Props { data: Territory[]; }

const COLORS = {
  actual:  '#1e40af',
  budget:  '#f59e0b',
  stretch: '#94a3b8',
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

export default function TerritoryAnalysisChart({ data }: Props) {
  if (!data?.length) {
    return <div className="h-64 flex items-center justify-center text-gray-300 text-sm">No data</div>;
  }

  // Sort by actual volume desc, take all (usually ≤ 6 territories)
  const rows = [...data]
    .filter(t => (t.volume ?? 0) > 0 || (t.budgetVolume ?? 0) > 0)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .map(t => ({
      name:    (t.territoryName || t.territoryCode || '?').replace(/'s Territory$/i, ''),
      actual:  t.volume        ?? 0,
      budget:  t.budgetVolume  ?? 0,
      stretch: (t.budgetVolume ?? 0) * 1.1,
      vsBud:   t.vsBudgetPct   ?? null,
      sites:   t.siteCount     ?? 0,
      vsBudLabel: t.vsBudgetPct != null
        ? `${t.vsBudgetPct >= 100 ? '+' : ''}${(t.vsBudgetPct - 100).toFixed(1)}%`
        : '',
    }));

  return (
    <ResponsiveContainer width="100%" height={290}>
      <ComposedChart data={rows} margin={{ top: 24, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} />
        <YAxis
          tick={{ fontSize: 11, fill: '#6b7280' }}
          axisLine={{ stroke: '#e5e7eb' }}
          tickFormatter={(v) => fmtVol(v)}
        />
        <Tooltip
          cursor={{ fill: 'rgba(99,102,241,0.06)' }}
          content={({ payload, label }) => {
            if (!payload || !payload.length) return null;
            const r = payload[0].payload as typeof rows[number];
            const vsBudColor = r.vsBud == null ? '#9ca3af' : r.vsBud >= 100 ? '#16a34a' : '#dc2626';
            return (
              <div style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                padding: '10px 12px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}>
                <div style={{ fontWeight: 600, marginBottom: 6, color: '#111827' }}>
                  {label} <span style={{ fontSize: 10, color: '#9ca3af' }}>· {r.sites} sites</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', alignItems: 'center' }}>
                  <span style={{ display: 'inline-block', width: 9, height: 9, background: COLORS.actual, borderRadius: 2 }} />
                  <span style={{ color: '#374151' }}>Actual: <strong>{fmtFull(r.actual)} L</strong></span>
                  <span style={{ display: 'inline-block', width: 9, height: 9, background: COLORS.budget, borderRadius: 2 }} />
                  <span style={{ color: '#374151' }}>Budget: <strong>{fmtFull(r.budget)} L</strong></span>
                  <span style={{ display: 'inline-block', width: 9, height: 9, background: COLORS.stretch, borderRadius: 2 }} />
                  <span style={{ color: '#374151' }}>Stretch: <strong>{fmtFull(r.stretch)} L</strong></span>
                </div>
                {r.vsBud != null && (
                  <div style={{ marginTop: 6, fontSize: 11, color: vsBudColor, fontWeight: 600 }}>
                    Vs Budget: {r.vsBud >= 100 ? '+' : ''}{(r.vsBud - 100).toFixed(1)}%
                  </div>
                )}
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="square" />
        <Bar dataKey="actual"  name="Actual"  fill={COLORS.actual}  radius={[3, 3, 0, 0]}>
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
        <Bar dataKey="budget"  name="Budget"  fill={COLORS.budget}  radius={[3, 3, 0, 0]} />
        <Bar dataKey="stretch" name="Stretch" fill={COLORS.stretch} radius={[3, 3, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
