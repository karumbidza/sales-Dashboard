'use client';

import { fmtVsBudget } from '@/lib/formatters';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtVol(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en', { maximumFractionDigits: 0 });
}

/** Render a volume value with a small muted "L" suffix (matches scorecard styling). */
function VolValue({ n, big = false }: { n: number | null | undefined; big?: boolean }) {
  const text = fmtVol(n);
  const lClass = big ? 'text-sm font-medium text-gray-400' : 'text-[10px] font-medium text-gray-400';
  return (
    <>
      {text}
      {text !== '—' && <span className={`ml-1 ${lClass}`}>L</span>}
    </>
  );
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

function fmtVolM(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M L`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K L`;
  return `${n.toFixed(0)} L`;
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

/** Colored "+3 sites" / "−2 sites" / "±0 sites" pill given current and prior counts. */
function siteDelta(current: number | null | undefined, prior: number | null | undefined): React.ReactNode | null {
  if (current == null || prior == null) return null;
  const d = current - prior;
  if (d === 0) {
    return <span className="font-semibold text-gray-500">±0 sites</span>;
  }
  const sign = d > 0 ? '+' : '−';
  const color = d > 0 ? 'text-emerald-600' : 'text-red-600';
  return (
    <span className={`font-semibold ${color}`}>
      {sign}{Math.abs(d)} site{Math.abs(d) === 1 ? '' : 's'}
    </span>
  );
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
  value: React.ReactNode;
  sub?: React.ReactNode;
  badgePct?: number | null;
  badgeText?: string;
  growth?: number | null;
  /** Trailing text after the growth %. Defaults to "vs prior". */
  growthLabel?: string;
  icon: React.ReactNode;
  highlight?: boolean;
  extra?: React.ReactNode;
  /** Tooltip text shown on a small (i) icon next to the label */
  hint?: string;
}

function KPICard({ label, value, sub, badgePct, badgeText, growth, growthLabel, icon, highlight, extra, hint }: CardProps) {
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
      <p className="kpi-label mb-1 flex items-center gap-1">
        {label}
        {hint && (
          <span
            title={hint}
            className="inline-flex items-center justify-center w-3 h-3 rounded-full border border-gray-300 text-[8px] text-gray-400 cursor-help font-semibold leading-none"
          >
            i
          </span>
        )}
      </p>

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
            ? <span>&#9650; {fmtPct(growth)} {growthLabel ?? 'vs prior'}</span>
            : <span>&#9660; {fmtPct(Math.abs(growth))} {growthLabel ?? 'vs prior'}</span>
          }
        </p>
      )}

      {/* Extra slot (e.g. projection) */}
      {extra}

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
  const { mtd, ytd, budget, growth, petrotrade, margin, projection } = kpis;

  // Projection color vs full-month budget
  let projColor = '#374151';
  const fmb = budget?.fullMonthBudget;
  if (projection && fmb > 0) {
    const diffPct = Math.abs(projection.value - fmb) / fmb;
    if (diffPct <= 0.05)              projColor = '#d97706'; // amber (within 5%)
    else if (projection.value > fmb)  projColor = '#16a34a'; // green
    else                              projColor = '#dc2626'; // red
  }

  const projectionExtra = projection ? (
    <div
      title="Based on day-of-week weighted run-rate using last 90 days. Confidence band ±5%."
      className="mt-2 pt-2 border-t border-gray-100"
    >
      <p style={{ fontSize: 11, color: projColor, fontWeight: 500 }} className="tabnum">
        {projection.isNextMonth
          ? `${projection.label}: ~${fmtVolM(projection.value)}`
          : `Projected: ~${fmtVolM(projection.value)}`}
        {projection.isNextMonth && (
          <span className="ml-1.5 text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded uppercase tracking-wide">
            Next month
          </span>
        )}
      </p>
    </div>
  ) : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">

      {/* 1. Active Sites */}
      <KPICard
        icon={icons.store}
        label="Active Sites"
        hint="Sites that submitted at least one status report in the selected period. Source of truth for how many stations are operational."
        value={String(mtd?.activeSites ?? '—')}
        sub={`${mtd?.tradingDays ?? 0} days reporting`}
      />

      {/* 2. MTD Volume */}
      <KPICard
        icon={icons.barrel}
        label="MTD Volume"
        value={<VolValue n={mtd?.volume} big />}
        sub={budget?.daysInMonth
          ? `Budget: ${fmtVol(budget?.mtdBudget)} L (${budget?.daysElapsed}/${budget?.daysInMonth} days)`
          : `Budget: ${fmtVol(budget?.mtdBudget)} L`}
        badgePct={budget?.vsBudgetPct}
        highlight
        extra={projectionExtra}
      />

      {/* 3. Average Daily Sales */}
      <KPICard
        icon={icons.lightning}
        label="Avg Daily Sales"
        value={<VolValue n={mtd?.avgDaily} big />}
        sub={`${mtd?.tradingDays ?? 0} days · ${mtd?.activeSites ?? 0} sites`}
      />

      {/* 4. Vs Stretch + Vs Budget (dual stat) */}
      {(() => {
        const vsStretch = budget?.vsStretchPct;
        const vsBudget  = budget?.vsBudgetPct;
        const colorOf = (pct: number | null | undefined) =>
          pct == null ? '#9ca3af' : pct >= 100 ? '#16a34a' : pct >= 85 ? '#d97706' : '#dc2626';
        return (
          <KPICard
            icon={icons.target}
            label="MTD Targets"
            hint="Stretch target = Budget × 1.10. Both percentages are pro-rated to the elapsed period."
            badgeText={(vsStretch ?? 0) >= 100 ? 'STRETCH ACHIEVED' : (vsBudget ?? 0) >= 100 ? 'BUDGET MET' : undefined}
            badgePct={vsStretch}
            value={
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="rounded-md border border-gray-100 bg-gray-50 px-2.5 py-3 flex flex-col">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-auto pb-1.5 leading-tight">Vs Stretch</p>
                  <p className="text-2xl font-bold tabnum leading-tight" style={{ color: colorOf(vsStretch) }}>
                    {fmtVsBudget(vsStretch)}
                  </p>
                </div>
                <div className="rounded-md border border-gray-100 bg-gray-50 px-2.5 py-3 flex flex-col">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-auto pb-1.5 leading-tight">Vs Budget</p>
                  <p className="text-2xl font-bold tabnum leading-tight" style={{ color: colorOf(vsBudget) }}>
                    {fmtVsBudget(vsBudget)}
                  </p>
                </div>
              </div>
            }
          />
        );
      })()}

      {/* 5. MoM Growth */}
      <KPICard
        icon={icons.trending}
        label="MoM Growth"
        hint="Month-on-month volume change vs the same elapsed window last month, anchored on the report's selected end date."
        value={growth?.mtdGrowthPct != null
          ? `${growth.mtdGrowthPct >= 0 ? '+' : ''}${fmtPct(growth.mtdGrowthPct)}`
          : '—'}
        sub={(() => {
          const delta = siteDelta(mtd?.activeSites, growth?.priorMtdActiveSites);
          const priorTxt = `${fmtVol(growth?.priorMtdVolume)} L last month`;
          return delta ? <>{delta} · {priorTxt}</> : priorTxt;
        })()}
        growth={growth?.mtdGrowthPct}
        growthLabel="vs prior month"
      />

      {/* 6. Avg Margin */}
      <KPICard
        icon={icons.calendar}
        label="Avg Margin"
        hint="Volume-weighted $/L from the MARGIN sheet. The site count here is only sites that have a margin row this month — not the same as Active Sites (which counts everything that traded)."
        value={margin?.avgCplPerSite != null
          ? `$${(margin.avgCplPerSite / 100).toFixed(2)}/L`
          : '—'}
        sub={margin?.sitesWithMargin
          ? `${margin.sitesWithMargin} of ${mtd?.activeSites ?? '?'} active sites have margin data`
          : 'Net gross margin'}
      />

      {/* 7. Cash Ratio */}
      <KPICard
        icon={icons.cash}
        label="Cash Ratio"
        hint="Cash collected ÷ total revenue. Sub line shows non-cash split: coupons and cards."
        value={mtd?.cashRatio != null ? `${(mtd.cashRatio * 100).toFixed(1)}%` : '—'}
        sub={`Coupon: ${fmtVol(mtd?.couponVolume)} L · Card: ${fmtVol(mtd?.cardVolume)} L`}
      />

      {/* 8. Petrotrade */}
      {(() => {
        const cur = petrotrade?.mtdVolume ?? 0;
        const prior = petrotrade?.priorMtdVolume ?? 0;
        const pctChange = prior > 0 ? ((cur - prior) / prior) * 100 : null;
        return (
          <KPICard
            icon={icons.handshake}
            label="Petrotrade Vol"
            badgeText={pctChange != null ? `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}%` : undefined}
            badgePct={pctChange != null ? (pctChange >= 0 ? 100 : 50) : undefined}
            value={<VolValue n={petrotrade?.mtdVolume} big />}
            sub={<>
              Margin: ${(petrotrade?.mtdMargin || 0).toLocaleString('en', { maximumFractionDigits: 0 })}
              {prior > 0 && (
                <span className="text-gray-400">
                  {' '}· {fmtVol(prior)} L prior
                </span>
              )}
            </>}
          />
        );
      })()}

      {/* 9. Redan Flexi */}
      {(() => {
        const cy = mtd?.flexVolume;
        const py = growth?.priorMtdFlexVolume;
        const flexGrowth = (cy != null && py != null && py > 0)
          ? ((cy - py) / py) * 100
          : null;
        return (
          <KPICard
            icon={icons.dollar}
            label="Redan Flexi Volume"
            hint="Flexi blend + flexi diesel volume for the selected period."
            value={<VolValue n={cy} big />}
            sub={py != null ? `${fmtVol(py)} L last month` : 'Flexi blend + flexi diesel'}
            growth={flexGrowth}
            growthLabel="vs prior month"
          />
        );
      })()}

      {/* 10. YTD Volume */}
      <KPICard
        icon={icons.chart}
        label="YTD Volume"
        value={<VolValue n={ytd?.volume} big />}
        sub={(() => {
          const delta = siteDelta(ytd?.activeSites, growth?.priorYtdActiveSites);
          const priorTxt = `${fmtVol(growth?.priorYtdVolume)} L last year`;
          return delta ? <>{delta} · {priorTxt}</> : priorTxt;
        })()}
        badgePct={ytd?.vsBudgetPct}
        growth={growth?.ytdGrowthPct}
        growthLabel="vs prior year"
      />

    </div>
  );
}
