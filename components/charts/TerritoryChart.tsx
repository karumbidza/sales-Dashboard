// components/charts/TerritoryChart.tsx
'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#1e3a5f', '#0891b2', '#059669', '#f59e0b', '#7c3aed', '#dc2626'];

interface Props { data: any[]; }

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700">{d.territoryName || d.territoryCode}</p>
      <p className="text-gray-500">{d.volume?.toLocaleString('en')} L</p>
      <p className="text-gray-500">{d.contributionPct?.toFixed(1)}% of total</p>
      <p className="text-gray-500">{d.siteCount} sites</p>
    </div>
  );
};

export default function TerritoryChart({ data }: Props) {
  if (!data?.length) return (
    <div className="h-64 flex items-center justify-center text-gray-300 text-sm">No data</div>
  );

  const pieData = data.map(d => ({
    ...d,
    name:  d.territoryName || d.territoryCode || 'Unknown',
    value: d.volume,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="45%"
          outerRadius={90}
          innerRadius={55}
          dataKey="value"
          nameKey="name"
          paddingAngle={2}
        >
          {pieData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, marginTop: 8 }}
          formatter={(value, entry: any) => (
            <span style={{ color: '#374151' }}>
              {value} <span style={{ color: '#9ca3af' }}>({entry.payload.contributionPct?.toFixed(1)}%)</span>
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
