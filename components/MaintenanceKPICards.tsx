'use client';

interface MaintKpis {
  totalCost: number;
  costPerLitre: number | null;
  topCategory: string | null;
  topCategoryCost: number;
  sitesWithActivity: number;
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCpl(n: number | null) {
  if (n == null) return '—';
  // Costs per litre are typically very small (e.g. $0.0013/L). Show 4 dp; for
  // values below 0.0001, fall back to scientific notation so a $0.00 isn't
  // misleading.
  if (n > 0 && n < 0.0001) return `$${n.toExponential(2)}`;
  return `$${n.toFixed(4)}`;
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card flex-1 min-w-[180px]">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-800 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function MaintenanceKPICards({ kpis }: { kpis: MaintKpis | null }) {
  if (!kpis) return null;
  return (
    <div className="flex flex-wrap gap-3">
      <Card label="Total R&M Cost"      value={`$${fmtMoney(kpis.totalCost)}`} />
      <Card label="Cost per Litre"      value={fmtCpl(kpis.costPerLitre)} sub="cost ÷ sales volume in window" />
      <Card label="Top Category"        value={kpis.topCategory || '—'}
                                        sub={kpis.topCategoryCost ? `$${fmtMoney(kpis.topCategoryCost)}` : undefined} />
      <Card label="Sites with Activity" value={kpis.sitesWithActivity.toLocaleString()} />
    </div>
  );
}
