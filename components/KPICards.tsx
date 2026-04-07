// components/KPICards.tsx
'use client';

interface KPIsProps { kpis: any; }

function pctColor(pct: number | null, positiveIsGood = true): string {
  if (pct == null) return 'text-gray-400';
  const good = positiveIsGood ? pct >= 100 : pct <= 0;
  if (good || pct >= 100) return 'text-emerald-600';
  if (pct >= 85) return 'text-amber-600';
  return 'text-red-600';
}

function pctBg(pct: number | null): string {
  if (pct == null) return 'bg-gray-100';
  if (pct >= 100) return 'bg-emerald-50 border-emerald-200';
  if (pct >= 85)  return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

function fmtVol(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en', { maximumFractionDigits: 0 });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  badge?: { text: string; color?: string };
  trend?: number | null;
  icon: string;
  highlight?: boolean;
}

function KPICard({ label, value, sub, badge, trend, icon, highlight }: CardProps) {
  const trendPositive = trend != null && trend >= 0;
  return (
    <div className={`relative rounded-xl border p-4 bg-white shadow-sm
      ${highlight ? 'border-blue-200 ring-1 ring-blue-100' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        {badge && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
            ${badge.color || 'bg-blue-100 text-blue-700'}`}>
            {badge.text}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      {trend != null && (
        <p className={`text-xs font-semibold mt-2 ${trendPositive ? 'text-emerald-600' : 'text-red-500'}`}>
          {trendPositive ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}% vs prior period
        </p>
      )}
    </div>
  );
}

export default function KPICards({ kpis }: KPIsProps) {
  if (!kpis) return null;
  const { mtd, ytd, budget, growth, petrotrade } = kpis;

  const vsBudgetPct = budget?.vsBudgetPct;
  const vsStretchPct = budget?.vsStretchPct;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
      <KPICard
        icon="🛢️"
        label="MTD Volume"
        value={`${fmtVol(mtd?.volume)} L`}
        sub={`Budget: ${fmtVol(budget?.mtdBudget)} L`}
        badge={{
          text: fmtPct(vsBudgetPct),
          color: vsBudgetPct == null ? 'bg-gray-100 text-gray-500'
               : vsBudgetPct >= 100  ? 'bg-emerald-100 text-emerald-700'
               : vsBudgetPct >= 85   ? 'bg-amber-100 text-amber-700'
               : 'bg-red-100 text-red-700'
        }}
        highlight
      />
      <KPICard
        icon="📊"
        label="YTD Volume"
        value={`${fmtVol(ytd?.volume)} L`}
        sub={`YTD Budget Achievement: ${fmtPct(ytd?.vsBudgetPct)}`}
        trend={growth?.ytdGrowthPct}
      />
      <KPICard
        icon="🎯"
        label="Vs Stretch"
        value={fmtPct(vsStretchPct)}
        sub={`Stretch: ${fmtVol(budget?.mtdStretch)} L`}
        badge={{
          text: (vsStretchPct ?? 0) >= 100 ? 'ACHIEVED' : 'IN PROGRESS',
          color: (vsStretchPct ?? 0) >= 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
        }}
      />
      <KPICard
        icon="📈"
        label="Growth"
        value={growth?.mtdGrowthPct != null
          ? `${growth.mtdGrowthPct >= 0 ? '+' : ''}${fmtPct(growth.mtdGrowthPct)}`
          : '—'}
        sub={`Prior: ${fmtVol(growth?.priorMtdVolume)} L`}
        trend={growth?.mtdGrowthPct}
      />
      <KPICard
        icon="⚡"
        label="Avg Daily Sales"
        value={`${fmtVol(mtd?.avgDaily)} L`}
        sub={`${mtd?.tradingDays ?? 0} trading days | ${mtd?.activeSites ?? 0} sites`}
      />
      <KPICard
        icon="💵"
        label="MTD Revenue"
        value={mtd?.revenue != null ? `$${(mtd.revenue / 1000).toFixed(0)}K` : '—'}
        sub="Total invoiced"
      />
      <KPICard
        icon="🤝"
        label="Petrotrade Vol"
        value={`${fmtVol(petrotrade?.mtdVolume)} L`}
        sub={`Margin: $${(petrotrade?.mtdMargin || 0).toLocaleString('en', { maximumFractionDigits: 0 })}`}
      />
      <KPICard
        icon="💰"
        label="Cash Ratio"
        value={mtd?.cashRatio != null ? `${(mtd.cashRatio * 100).toFixed(1)}%` : '—'}
        sub="Cash / Total Revenue"
      />
      <KPICard
        icon="🏪"
        label="Active Sites"
        value={String(mtd?.activeSites ?? '—')}
        sub={`${mtd?.tradingDays ?? 0} days reporting`}
      />
      <KPICard
        icon="📅"
        label="As Of"
        value={kpis.asOf || '—'}
        sub="Last data date"
      />
    </div>
  );
}
