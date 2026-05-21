'use client';

// components/rm/TicketsManagementTable.tsx
// Tickets table with per-row exclusion checkbox + "show excluded" toggle.
// Tick a box → POST to /api/helpdesk/exclusions with a reason picker.
// Untick → DELETE the exclusion. Excluded tickets disappear from all
// reports/dashboards because every read endpoint filters via the
// rm_helpdesk_tickets_active view.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RMFilters } from './RMFilterBar';

interface TicketRow {
  ticketId:       number;
  siteCode:       string;
  siteName:       string;
  subject:        string;
  status:         string;
  priority:       string | null;
  serviceProvider:string | null;
  createdTime:    string | null;
  resolvedTime:   string | null;
  isExcluded:     boolean;
  excludeReason:  string | null;
}

const REASON_OPTIONS = ['Sales', 'IT', 'Test', 'Other'] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

interface Props { filters: RMFilters }

export default function TicketsManagementTable({ filters }: Props) {
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showExcluded, setShowExcluded] = useState(false);
  const [reasonPickerFor, setReasonPickerFor] = useState<number | null>(null);
  const [reasonValue, setReasonValue] = useState<string>('Sales');
  const [reasonOther, setReasonOther] = useState<string>('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchRows = useCallback(async () => {
    const qs = new URLSearchParams({
      dateFrom: filters.dateFrom,
      dateTo:   filters.dateTo,
      siteCode: filters.siteCode,
      limit:    '500',
      includeExcluded: showExcluded ? 'true' : 'false',
    }).toString();
    setLoading(true);
    try {
      const r = await fetch(`/api/helpdesk/tickets?${qs}`);
      const j = await r.json();
      setRows(j.data ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters, showExcluded]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const excludedCount = useMemo(
    () => rows.filter(r => r.isExcluded).length,
    [rows],
  );

  async function applyExclude(ticketIds: number[], reason: string) {
    if (ticketIds.length === 0) return;
    setBusy(true);
    try {
      await fetch('/api/helpdesk/exclusions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketIds, reason }),
      });
      await fetchRows();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  async function applyUnexclude(ticketIds: number[]) {
    if (ticketIds.length === 0) return;
    setBusy(true);
    try {
      await fetch('/api/helpdesk/exclusions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketIds }),
      });
      await fetchRows();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  function openReasonPickerFor(ticketId: number) {
    setReasonPickerFor(ticketId);
    setReasonValue('Sales');
    setReasonOther('');
  }

  function confirmReasonPicker() {
    const reason = reasonValue === 'Other' ? (reasonOther.trim() || 'Other') : reasonValue;
    if (reasonPickerFor != null) {
      applyExclude([reasonPickerFor], reason);
      setReasonPickerFor(null);
    } else if (bulkPickerOpen) {
      applyExclude(Array.from(selected), reason);
      setBulkPickerOpen(false);
    }
  }

  function toggleSelection(ticketId: number) {
    const next = new Set(selected);
    if (next.has(ticketId)) next.delete(ticketId);
    else next.add(ticketId);
    setSelected(next);
  }

  function toggleSelectAll() {
    const visibleIncludable = rows.filter(r => !r.isExcluded).map(r => r.ticketId);
    if (selected.size === visibleIncludable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleIncludable));
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-md">
      {/* Header strip with toggle + selection controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="text-[10px] uppercase font-semibold tracking-[0.6px] text-gray-500">
            Tickets · Manage
          </div>
          <span className="text-[11px] text-gray-500">
            {rows.length} {showExcluded ? 'total' : 'visible'} · {excludedCount} excluded
          </span>
        </div>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <button
              onClick={() => setBulkPickerOpen(true)}
              disabled={busy}
              className="text-xs font-medium text-white bg-[#1e3a5f] hover:bg-[#16304f] px-3 py-1.5 rounded-md transition disabled:opacity-50"
            >
              Exclude {selected.size} selected
            </button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showExcluded}
              onChange={e => setShowExcluded(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Show excluded
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider">
              <th className="px-2 py-2 text-left w-8">
                <input
                  type="checkbox"
                  checked={
                    rows.filter(r => !r.isExcluded).length > 0 &&
                    selected.size === rows.filter(r => !r.isExcluded).length
                  }
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5"
                  aria-label="Select all visible (non-excluded) tickets"
                />
              </th>
              <th className="px-2 py-2 text-left">Ticket</th>
              <th className="px-2 py-2 text-left">Site</th>
              <th className="px-2 py-2 text-left">Subject</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-left">Priority</th>
              <th className="px-2 py-2 text-left">Created</th>
              <th className="px-2 py-2 text-left">Exclude</th>
              <th className="px-2 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="px-3 py-4 text-center text-gray-400 text-xs">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-4 text-center text-gray-400 text-xs">No tickets in window</td></tr>
            )}
            {!loading && rows.map(t => {
              const isSel = selected.has(t.ticketId);
              return (
                <tr
                  key={t.ticketId}
                  className={`border-t border-gray-100 ${t.isExcluded ? 'bg-gray-50 text-gray-400 italic' : 'hover:bg-blue-50/40'}`}
                >
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelection(t.ticketId)}
                      disabled={t.isExcluded}
                      className="h-3.5 w-3.5"
                      aria-label={`Select ticket ${t.ticketId}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">#{t.ticketId}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{t.siteName}</div>
                    <div className="text-gray-400 text-[10px]">{t.siteCode}</div>
                  </td>
                  <td className="px-2 py-1.5 max-w-md truncate" title={t.subject}>{t.subject}</td>
                  <td className="px-2 py-1.5">{t.status}</td>
                  <td className="px-2 py-1.5">{t.priority ?? '—'}</td>
                  <td className="px-2 py-1.5">{fmtDate(t.createdTime)}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={t.isExcluded}
                      disabled={busy}
                      onChange={() => {
                        if (t.isExcluded) applyUnexclude([t.ticketId]);
                        else openReasonPickerFor(t.ticketId);
                      }}
                      className="h-3.5 w-3.5"
                      aria-label={t.isExcluded ? `Re-include ticket ${t.ticketId}` : `Exclude ticket ${t.ticketId}`}
                      title={t.isExcluded ? 'Un-exclude (bring back)' : 'Mark as junk / non-R&M'}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-[11px]">{t.excludeReason ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Reason picker modal — single or bulk */}
      {(reasonPickerFor != null || bulkPickerOpen) && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { setReasonPickerFor(null); setBulkPickerOpen(false); }}
        >
          <div
            className="bg-white rounded-lg shadow-2xl w-full max-w-sm mx-4 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="text-sm font-semibold text-gray-900">
                {bulkPickerOpen ? `Exclude ${selected.size} tickets` : `Exclude ticket #${reasonPickerFor}`}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                These tickets will be hidden from all reports until you re-include them.
              </div>
            </div>
            <div className="p-4 flex flex-col gap-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Reason</div>
              <div className="flex flex-wrap gap-2">
                {REASON_OPTIONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setReasonValue(r)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition ${
                      reasonValue === r
                        ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {reasonValue === 'Other' && (
                <input
                  type="text"
                  autoFocus
                  value={reasonOther}
                  onChange={e => setReasonOther(e.target.value)}
                  placeholder="Custom reason (e.g. 'duplicate', 'cancelled')"
                  className="mt-1 w-full text-sm border border-gray-300 rounded p-2 focus:outline-none focus:border-[#1e3a5f]"
                />
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-gray-200">
              <button
                onClick={() => { setReasonPickerFor(null); setBulkPickerOpen(false); }}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-md transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmReasonPicker}
                disabled={busy}
                className="text-xs font-medium text-white bg-[#b91c1c] hover:bg-[#991b1b] px-3 py-1.5 rounded-md transition disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Exclude'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
