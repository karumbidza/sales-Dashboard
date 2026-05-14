'use client';

import { useEffect, useState } from 'react';

interface ContractorRow {
  provider: string;
  ticketCount: number;
  avgResolutionMinutes: number | null;
  slaHitPct: number | null;
}

interface Filters { dateFrom?: string; dateTo?: string; siteCode?: string; }

interface Props {
  filters: Filters;
  onPickContractor: (provider: string) => void;
}

function fmtHours(mins: number | null) {
  if (mins == null) return '—';
  return `${(mins / 60).toFixed(1)} h`;
}

export default function ContractorsPanel({ filters, onPickContractor }: Props) {
  const [rows, setRows] = useState<ContractorRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   p.set('dateTo',   filters.dateTo);
    if (filters.siteCode) p.set('siteCode', filters.siteCode);

    setLoading(true);
    fetch(`/api/helpdesk/contractors?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Service Providers</h3>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Provider</th>
              <th className="px-3 py-1 text-right">Tickets</th>
              <th className="px-3 py-1 text-right">Avg Res</th>
              <th className="px-3 py-1 text-right">SLA Hit %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.provider}
                  onClick={() => onPickContractor(r.provider)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1">{r.provider}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.ticketCount}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtHours(r.avgResolutionMinutes)}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.slaHitPct != null ? `${r.slaHitPct}%` : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-500">No data.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
