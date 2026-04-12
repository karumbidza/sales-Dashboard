// components/charts/TerritoryScorecard.tsx
'use client';

interface Territory {
  territoryCode?:   string;
  territoryName?:   string;
  volume?:          number;
  siteCount?:       number;
  avgDaily?:        number;
  cashRatioPct?:    number;
  dieselVol?:       number;
  blendVol?:        number;
  ulpVol?:          number;
  budgetVolume?:    number;
  stretchVolume?:   number;
  contributionPct?: number;
  vsBudgetPct?:     number | null;
  vsStretchPct?:    number | null;
  netMarginCpl?:    number | null;
  priorVolume?:     number | null;
  growthPct?:       number | null;
  avgPrice?:        number | null;
}

interface Props { data: Territory[]; }

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtVol(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toLocaleString('en');
}
function fmtFull(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en');
}
function fmtPct(n: number | null | undefined, withSign = false): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function varColor(pct: number | null | undefined): string {
  if (pct == null) return 'text-gray-400';
  if (pct >= 100) return 'text-emerald-600';
  if (pct >= 85)  return 'text-amber-600';
  return 'text-red-600';
}
function growthColor(n: number | null | undefined): string {
  if (n == null) return 'text-gray-400';
  return n >= 0 ? 'text-emerald-600' : 'text-red-600';
}

function shortName(t: Territory): string {
  const raw = String(t.territoryName || t.territoryCode || '?');
  return raw.replace(/'s Territory$/i, '').replace(/\sTerritory$/i, '');
}

// ── Mini progress bar with budget/stretch tick marks ───────────────────────

function ProgressBar({ actual, budget, stretch }: { actual: number; budget: number; stretch: number }) {
  const max = Math.max(actual, stretch * 1.05, 1);
  const actualPct  = (actual  / max) * 100;
  const budgetPct  = (budget  / max) * 100;
  const stretchPct = (stretch / max) * 100;
  const fill =
    budget > 0 && actual >= stretch ? '#10b981' :
    budget > 0 && actual >= budget  ? '#84cc16' :
    budget > 0 && actual >= 0.85 * budget ? '#f59e0b' :
    '#ef4444';
  return (
    <div className="relative w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className="absolute top-0 left-0 h-full rounded-full" style={{ width: `${actualPct}%`, background: fill }} />
      {budget  > 0 && <div className="absolute top-[-2px] h-3 w-0.5 bg-amber-500" style={{ left: `${budgetPct}%`  }} title={`Budget: ${fmtFull(budget)} L`} />}
      {stretch > 0 && <div className="absolute top-[-2px] h-3 w-0.5 bg-rose-500"  style={{ left: `${stretchPct}%` }} title={`Stretch: ${fmtFull(stretch)} L`} />}
    </div>
  );
}

// ── Scorecard ──────────────────────────────────────────────────────────────

function ScoreCard({ t }: { t: Territory }) {
  const volume   = t.volume        ?? 0;
  const budget   = t.budgetVolume  ?? 0;
  const stretch  = t.stretchVolume ?? 0;
  const prior    = t.priorVolume   ?? 0;
  // Petrol = blend + ULP (combined since ULP currently not sold)
  const dieselV  = t.dieselVol ?? 0;
  const petrolV  = (t.blendVol ?? 0) + (t.ulpVol ?? 0);
  const products = dieselV + petrolV;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-col">
      {/* Header: name + growth arrow */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-sm font-bold text-gray-900 leading-tight">{shortName(t)}</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {t.siteCount ?? 0} site{(t.siteCount ?? 0) === 1 ? '' : 's'}
            {t.contributionPct != null && ` · ${t.contributionPct.toFixed(1)}% of total`}
          </p>
        </div>
        {t.growthPct != null && (
          <span className={`text-[11px] font-semibold ${growthColor(t.growthPct)}`}>
            {t.growthPct >= 0 ? '▲' : '▼'} {Math.abs(t.growthPct).toFixed(1)}%
          </span>
        )}
      </div>

      {/* Big volume */}
      <p className="text-2xl font-bold text-gray-900 tabnum leading-none">
        {fmtVol(volume)} <span className="text-sm font-medium text-gray-400">L</span>
      </p>

      {/* Budget · Stretch · Prior — three reference numbers under the volume */}
      <div className="grid grid-cols-3 gap-1 mt-2 text-[10px] tabnum">
        <div>
          <p className="text-gray-400 uppercase tracking-wide font-semibold text-[9px]">Budget</p>
          <p className="text-gray-700 font-mono">{fmtVol(budget)} L</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase tracking-wide font-semibold text-[9px]">Stretch</p>
          <p className="text-gray-700 font-mono">{fmtVol(stretch)} L</p>
        </div>
        <div>
          <p className="text-gray-400 uppercase tracking-wide font-semibold text-[9px]">Prior</p>
          <p className="text-gray-700 font-mono">{fmtVol(prior)} L</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-2 mb-2">
        <ProgressBar actual={volume} budget={budget} stretch={stretch} />
      </div>

      {/* Vs Budget / Vs Stretch dual stat */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Vs Budget</p>
          <p className={`text-sm font-bold tabnum ${varColor(t.vsBudgetPct)}`}>
            {fmtPct(t.vsBudgetPct != null ? t.vsBudgetPct - 100 : null, true)}
          </p>
        </div>
        <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Vs Stretch</p>
          <p className={`text-sm font-bold tabnum ${varColor(t.vsStretchPct)}`}>
            {fmtPct(t.vsStretchPct != null ? t.vsStretchPct - 100 : null, true)}
          </p>
        </div>
      </div>

      {/* Detail rows */}
      <div className="space-y-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-gray-500">Avg daily</span>
          <span className="font-mono text-gray-800">{fmtFull(t.avgDaily)} L</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Avg price</span>
          <span className="font-mono text-gray-800">{t.avgPrice != null ? `$${t.avgPrice.toFixed(2)}/L` : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Cash ratio</span>
          <span className="font-mono text-gray-800">{fmtPct(t.cashRatioPct)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Net margin</span>
          <span className="font-mono text-gray-800">
            {t.netMarginCpl != null ? `$${(t.netMarginCpl / 100).toFixed(2)}/L` : '—'}
          </span>
        </div>
      </div>

      {/* Product mix — Diesel vs Petrol */}
      {products > 0 && (
        <div className="pt-2 mt-2 border-t border-gray-100">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Product mix</p>
          <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-100">
            <div className="bg-blue-700"  style={{ width: `${(dieselV / products) * 100}%` }} />
            <div className="bg-cyan-600"  style={{ width: `${(petrolV / products) * 100}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-gray-500 mt-1 tabnum">
            <span>Diesel {((dieselV / products) * 100).toFixed(0)}%</span>
            <span>Petrol {((petrolV / products) * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

export default function TerritoryScorecard({ data }: Props) {
  if (!data?.length) {
    return <div className="text-center text-gray-300 text-sm py-12">No territory data</div>;
  }
  const sorted = [...data].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {sorted.map(t => (
        <ScoreCard key={t.territoryCode || t.territoryName} t={t} />
      ))}
    </div>
  );
}
