// components/charts/SalesTrendChart.tsx
'use client';

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

interface Props {
  data: any[];
  type: 'daily' | 'monthly';
}

const COLORS = {
  diesel:  '#1e40af',
  blend:   '#0891b2',
  ulp:     '#059669',
  budget:  '#f59e0b',
  stretch: '#dc2626',
  total:   '#6366f1',
};

function fmtVol(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

const CustomTooltip = ({ active, payload, label }: any) => {
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

export default function SalesTrendChart({ data, type }: Props) {
  if (!data?.length) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-300 text-sm">
        No data available for selected filters
      </div>
    );
  }

  const xKey = 'label';

  if (type === 'monthly') {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={fmtVol} tick={{ fontSize: 11 }} width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />

          <Bar dataKey="diesel_volume" name="Diesel" stackId="a" fill={COLORS.diesel} radius={[0,0,0,0]} />
          <Bar dataKey="blend_volume"  name="Blend"  stackId="a" fill={COLORS.blend}  radius={[0,0,0,0]} />
          <Bar dataKey="ulp_volume"    name="ULP"    stackId="a" fill={COLORS.ulp}    radius={[2,2,0,0]} />
          <Line
            type="monotone"
            dataKey="budget_volume"
            name="Budget"
            stroke={COLORS.budget}
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="stretch_volume"
            name="Stretch"
            stroke={COLORS.stretch}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // Daily
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 10 }}
          interval={Math.floor(data.length / 15)}
        />
        <YAxis tickFormatter={fmtVol} tick={{ fontSize: 11 }} width={55} />
        <Tooltip content={<CustomTooltip />} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />

        <Bar dataKey="diesel_volume" name="Diesel" stackId="a" fill={COLORS.diesel} />
        <Bar dataKey="blend_volume"  name="Blend"  stackId="a" fill={COLORS.blend} />
        <Bar dataKey="ulp_volume"    name="ULP"    stackId="a" fill={COLORS.ulp} radius={[2,2,0,0]} />
        <Line
          type="monotone"
          dataKey="actual_volume"
          name="Total"
          stroke={COLORS.total}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
