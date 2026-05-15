'use client';

interface CostKpis {
  totalInvoiceCost:     number;
  totalInvoices:        number;
  totalTickets:         number;
  overallCostPerTicket: number | null;
  sitesWithTickets:     number;
  sitesWithInvoices:    number;
  sitesWithBoth:        number;
  topSpendCategory:     string | null;
  topSpendCategoryCost: number;
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

export default function CostKPICards({ kpis }: { kpis: CostKpis | null }) {
  if (!kpis) return null;

  return (
    <div className="flex flex-wrap gap-3">
      <Card
        label="Invoice Spend"
        value={`$${fmtMoney(kpis.totalInvoiceCost)}`}
        sub={`${kpis.totalInvoices.toLocaleString()} lines across ${kpis.sitesWithInvoices} sites`}
      />
      <Card
        label="Tickets"
        value={kpis.totalTickets.toLocaleString()}
        sub={`${kpis.sitesWithTickets} sites · ${kpis.sitesWithBoth} have both`}
      />
      <Card
        label="Cost / Ticket"
        value={kpis.overallCostPerTicket != null ? `$${fmtMoney(kpis.overallCostPerTicket)}` : '—'}
        sub={kpis.overallCostPerTicket != null ? 'Invoice $ ÷ Ticket count' : 'No tickets in window'}
      />
      <Card
        label="Top Category"
        value={kpis.topSpendCategory || '—'}
        sub={kpis.topSpendCategoryCost > 0 ? `$${fmtMoney(kpis.topSpendCategoryCost)} spend` : undefined}
      />
    </div>
  );
}
