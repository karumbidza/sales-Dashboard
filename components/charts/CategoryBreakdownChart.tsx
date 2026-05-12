'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface CategoryRow {
  category: string;
  totalCost: number;
  pctOfTotal: number;
}

const COLORS = ['#1e3a5f', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe'];

export default function CategoryBreakdownChart({ data }: { data: CategoryRow[] }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400">No category data for the selected filters.</p>;
  }
  const height = Math.max(220, Math.min(440, data.length * 36));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 80, right: 40, top: 8, bottom: 8 }}>
        <XAxis type="number" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} stroke="#9ca3af" fontSize={11} />
        <YAxis type="category" dataKey="category" stroke="#4b5563" fontSize={12} width={140} />
        <Tooltip
          formatter={(v: number) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Cost']}
          labelFormatter={(l) => `Category: ${l}`}
        />
        <Bar dataKey="totalCost" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
