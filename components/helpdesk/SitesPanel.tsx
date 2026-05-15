'use client';

import { useEffect, useState } from 'react';

interface SiteRow {
  siteCode: string;
  siteName: string;
  total: number;
  open: number;
  avgResolutionMinutes: number | null;
}

interface Filters { dateFrom?: string; dateTo?: string; priority?: string; category?: string; }

interface Props {
  filters: Filters;
  onPickSite: (siteCode: string, siteName: string) => void;
}

function fmtHours(mins: number | null) {
  if (mins == null) return '—';
  return `${(mins / 60).toFixed(1)} h`;
}

export default function SitesPanel({ filters, onPickSite }: Props) {
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   p.set('dateTo',   filters.dateTo);
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.category) p.set('category', filters.category);

    setLoading(true);
    fetch(`/api/helpdesk/sites?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Sites by Ticket Count</h3>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Site</th>
              <th className="px-3 py-1 text-right">Total</th>
              <th className="px-3 py-1 text-right">Open</th>
              <th className="px-3 py-1 text-right">Avg Res</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.siteCode}
                  onClick={() => onPickSite(r.siteCode, r.siteName)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1">{r.siteName}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.total}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.open}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtHours(r.avgResolutionMinutes)}</td>
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
