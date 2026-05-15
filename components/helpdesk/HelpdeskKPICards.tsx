'use client';

interface HelpdeskKpis {
  openCount: number;
  openByPriority: Record<string, number>;
  slaViolatedCount: number;
  slaViolatedPct: number;
  avgResolutionMinutes: number | null;
  topEquipment: string | null;
  topEquipmentCount: number;
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

function fmtHours(mins: number | null) {
  if (mins == null) return '—';
  const hrs = mins / 60;
  if (hrs < 24) return `${hrs.toFixed(1)} hrs`;
  return `${(hrs / 24).toFixed(1)} days`;
}

export default function HelpdeskKPICards({ kpis }: { kpis: HelpdeskKpis | null }) {
  if (!kpis) return null;
  const urgent = kpis.openByPriority['Urgent'] || 0;
  return (
    <div className="flex flex-wrap gap-3">
      <Card
        label="Open Tickets"
        value={kpis.openCount.toLocaleString()}
        sub={urgent > 0 ? `${urgent} Urgent` : undefined}
      />
      <Card
        label="SLA Violated"
        value={`${kpis.slaViolatedCount.toLocaleString()} (${kpis.slaViolatedPct}%)`}
        sub="In filter window"
      />
      <Card
        label="Avg Resolution"
        value={fmtHours(kpis.avgResolutionMinutes)}
      />
      <Card
        label="Top Equipment"
        value={kpis.topEquipment || '—'}
        sub={kpis.topEquipmentCount > 0 ? `${kpis.topEquipmentCount} tickets` : undefined}
      />
    </div>
  );
}
