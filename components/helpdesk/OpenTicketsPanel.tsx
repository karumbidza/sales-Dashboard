'use client';

import { useEffect, useState } from 'react';

interface OpenTicket {
  ticketId:    number;
  siteCode:    string;
  siteName:    string;
  priority:    string | null;
  createdTime: string;
  daysOpen:    number;
  subject:     string;
}

interface Filters { priority?: string; siteCode?: string; category?: string; }

const PRIORITY_COLORS: Record<string, string> = {
  'Urgent': 'bg-red-100 text-red-800',
  'High':   'bg-orange-100 text-orange-800',
  'Medium': 'bg-amber-100 text-amber-800',
  'Low':    'bg-blue-100 text-blue-800',
};

interface Props {
  filters: Filters;
  onPickTicket: (ticketId: number) => void;
}

export default function OpenTicketsPanel({ filters, onPickTicket }: Props) {
  const [rows, setRows] = useState<OpenTicket[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.siteCode) p.set('siteCode', filters.siteCode);
    if (filters.category) p.set('category', filters.category);
    p.set('limit', '50');

    setLoading(true);
    fetch(`/api/helpdesk/open?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Open / Pending Tickets (oldest first)</h3>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Ticket</th>
              <th className="px-3 py-1">Site</th>
              <th className="px-3 py-1">Priority</th>
              <th className="px-3 py-1 text-right">Days Open</th>
              <th className="px-3 py-1">Subject</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ticketId}
                  onClick={() => onPickTicket(r.ticketId)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1 font-mono">{r.ticketId}</td>
                <td className="px-3 py-1">{r.siteName}</td>
                <td className="px-3 py-1">
                  {r.priority && (
                    <span className={`inline-block rounded px-1.5 ${PRIORITY_COLORS[r.priority] || 'bg-gray-100 text-gray-700'}`}>
                      {r.priority}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{r.daysOpen}</td>
                <td className="px-3 py-1">{r.subject}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">No open tickets.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
