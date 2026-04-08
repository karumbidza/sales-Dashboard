'use client';

import { fmtVsBudget } from '@/lib/formatters';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtVol(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en', { maximumFractionDigits: 0 });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtRev(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function badgeClass(pct: number | null): string {
  if (pct == null)  return 'badge-gray';
  if (pct >= 100)   return 'badge-green';
  if (pct >= 85)    return 'badge-amber';
  return 'badge-red';
}

function growthColor(n: number | null): string {
  if (n == null) return 'text-gray-400';
  return n >= 0 ? 'text-emerald-600' : 'text-red-600';
}

// ── SVG Icons ──────────────────────────────────────────────────────────────

const icons = {
  barrel: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <ellipse cx="12" cy="5" rx="7" ry="3"/>
      <path d="M5 5v14M19 5v14"/>
      <ellipse cx="12" cy="19" rx="7" ry="3"/>
      <path d="M5 12h14"/>
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  target: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  trending: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  lightning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  dollar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  handshake: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 7.65l1.06 1.06L12 21.23l7.77-7.77 1.06-1.06a5.4 5.4 0 0 0-.41-7.82z"/>
    </svg>
  ),
  cash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  store: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <path d="M3 9l1-5h16l1 5"/>
      <path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/>
      <path d="M5 21V9M19 21V9M5 21h14"/>
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
         className="w-4 h-4 text-gray-400">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
};

// ── Card Component ─────────────────────────────────────────────────────────

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  badgePct?: number | null;
  badgeText?: string;
  growth?: number | null;
  icon: React.ReactNode;
  highlight?: boolean;
}

function KPICard({ label, value, sub, badgePct, badgeText, growth, icon, highlight }: CardProps) {
  const badge = badgeText ?? (badgePct != null ? fmtVsBudget(badgePct) : null);
  return (
    <div
      className={`relative bg-white border rounded-xl overflow-hidden
        ${highlight ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-[#e5e7eb]'}`}
      style={{ padding: '16px 20px' }}
    >
      {/* Top row: icon + badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="p-1.5 bg-gray-50 rounded-md border border-gray-100">
          {icon}
        </div>
        {badge && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeClass(badgePct ?? null)}`}>
            {badge}
          </span>
        )}
      </div>

      {/* Label */}
      <p className="kpi-label mb-1">{label}</p>

      {/* Value */}
      <p className="kpi-value tabnum">{value}</p>

      {/* Sub */}
      {sub && (
        <p className="text-[11px] text-gray-400 mt-1 tabnum">{sub}</p>
      )}

      {/* Growth indicator */}
      {growth != null && (
        <p className={`text-[11px] font-semibold mt-2 ${growthColor(growth)}`}>
          {growth >= 0
            ? <span>&#9650; {fmtPct(growth)} vs prior</span>
            : <span>&#9660; {fmtPct(Math.abs(growth))} vs prior</span>
          }
        </p>
      )}

      {/* Highlight accent bar */}
      {highlight && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-400" />
      )}
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────

export default function KPICards({ kpis }: { kpis: any }) {
  if (!kpis) return null;
  const { mtd, ytd, budget, growth, petrotrade, margin } = kpis;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">

      <KPICard
        icon={icons.barrel}
        label="MTD Volume"
        value={`${fmtVol(mtd?.volume)} L`}
        sub={budget?.daysInMonth
          ? `Budget: ${fmtVol(budget?.mtdBudget)} L (${budget?.daysElapsed}/${budget?.daysInMonth} days)`
          : `Budget: ${fmtVol(budget?.mtdBudget)} L`}
        badgePct={budget?.vsBudgetPct}
        highlight
      />

      <KPICard
        icon={icons.chart}
        label="YTD Volume"
        value={`${fmtVol(ytd?.volume)} L`}
        sub={`YTD vs pro-rata budget: ${fmtVsBudget(ytd?.vsBudgetPct)}`}
        badgePct={ytd?.vsBudgetPct}
        growth={growth?.ytdGrowthPct}
      />

      <KPICard
        icon={icons.target}
        label="Vs Stretch"
        value={fmtVsBudget(budget?.vsStretchPct)}
        sub="vs pro-rated stretch target"
        badgePct={budget?.vsStretchPct}
        badgeText={(budget?.vsStretchPct ?? 0) >= 100 ? 'ACHIEVED' : undefined}
      />

      <KPICard
        icon={icons.trending}
        label="MTD Growth"
        value={growth?.mtdGrowthPct != null
          ? `${growth.mtdGrowthPct >= 0 ? '+' : ''}${fmtPct(growth.mtdGrowthPct)}`
          : '—'}
        sub={`Prior: ${fmtVol(growth?.priorMtdVolume)} L`}
        growth={growth?.mtdGrowthPct}
      />

      <KPICard
        icon={icons.lightning}
        label="Avg Daily"
        value={`${fmtVol(mtd?.avgDaily)} L`}
        sub={`${mtd?.tradingDays ?? 0} days · ${mtd?.activeSites ?? 0} sites`}
      />

      <KPICard
        icon={icons.dollar}
        label="MTD Revenue"
        value={fmtRev(mtd?.revenue)}
        sub="Total invoiced revenue"
      />

      <KPICard
        icon={icons.handshake}
        label="Petrotrade Vol"
        value={`${fmtVol(petrotrade?.mtdVolume)} L`}
        sub={`Margin: $${(petrotrade?.mtdMargin || 0).toLocaleString('en', { maximumFractionDigits: 0 })}`}
      />

      <KPICard
        icon={icons.cash}
        label="Cash Ratio"
        value={mtd?.cashRatio != null ? `${(mtd.cashRatio * 100).toFixed(1)}%` : '—'}
        sub="Cash / total revenue"
      />

      <KPICard
        icon={icons.store}
        label="Active Sites"
        value={String(mtd?.activeSites ?? '—')}
        sub={`${mtd?.tradingDays ?? 0} days reporting`}
      />

      <KPICard
        icon={icons.calendar}
        label="Avg Margin / Site"
        value={margin?.avgCplPerSite != null
          ? `${margin.avgCplPerSite.toFixed(1)} ¢/L`
          : '—'}
        sub={margin?.sitesWithMargin
          ? `${margin.sitesWithMargin} sites · net gross margin`
          : 'Net gross margin'}
      />

    </div>
  );
}
