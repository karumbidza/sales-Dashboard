// components/helpdesk/TicketDrawer.tsx
'use client';

import { useEffect, useState } from 'react';
import { normalizeDescription } from '@/lib/normalize-description';

export interface TicketFilters {
  ticketId?:    number;
  siteCode?:    string;
  category?:    string;
  description?: string;
  dateFrom?:    string;
  dateTo?:      string;
  priority?:    string;
  status?:      string;
  provider?:    string;
  openOnly?:    boolean;
}

interface Ticket {
  ticketId:           number;
  siteCode:           string;
  siteName:           string;
  subject:            string;
  descriptionNorm:    string;
  status:             string;
  priority:           string | null;
  equipment:          string | null;
  serviceProvider:    string | null;
  createdTime:        string;
  resolvedTime:       string | null;
  closedTime:         string | null;
  resolutionMinutes:  number | null;
  resolutionStatus:   string | null;
  categorySlug:       string | null;
  categoryName:       string | null;
  categorySource:     string | null;
  needsReview:        boolean;
}

interface CategoryOption { slug: string; displayName: string; }

interface Props {
  open: boolean;
  filters: TicketFilters;
  title?: string;
  onClose: () => void;
  onReclassified?: () => void;
}

function buildQS(f: TicketFilters): string {
  const p = new URLSearchParams();
  if (f.siteCode)    p.set('siteCode',    f.siteCode);
  if (f.category)    p.set('category',    f.category);
  if (f.description) p.set('description', f.description);
  if (f.dateFrom)    p.set('dateFrom',    f.dateFrom);
  if (f.dateTo)      p.set('dateTo',      f.dateTo);
  if (f.priority)    p.set('priority',    f.priority);
  if (f.status)      p.set('status',      f.status);
  if (f.provider)    p.set('provider',    f.provider);
  if (f.openOnly)    p.set('openOnly',    'true');
  p.set('limit', '200');
  return p.toString();
}

function fmtHours(mins: number | null) {
  if (mins == null) return '—';
  return `${(mins / 60).toFixed(1)} h`;
}

export default function TicketDrawer({ open, filters, title, onClose, onReclassified }: Props) {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [cats, setCats] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingByNorm, setPendingByNorm] = useState<Record<string, string>>({});

  const refetch = async () => {
    setLoading(true); setError(null);
    try {
      const [tRes, cRes] = await Promise.all([
        fetch(`/api/helpdesk/tickets?${buildQS(filters)}`).then(r => r.json()),
        fetch('/api/maintenance/categories-list').then(r => r.json()),
      ]);
      setRows(tRes?.data || []);
      setCats(cRes?.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setPendingByNorm({});
      refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(filters)]);

  const stageChange = (norm: string, slug: string, originalSlug: string | null) => {
    setPendingByNorm(prev => {
      const next = { ...prev };
      if (slug === (originalSlug || 'other')) {
        delete next[norm];
      } else {
        next[norm] = slug;
      }
      return next;
    });
  };

  const saveAll = async () => {
    const entries = Object.entries(pendingByNorm);
    if (entries.length === 0) return;
    setSaving(true); setError(null);
    try {
      for (const [norm, slug] of entries) {
        const res = await fetch('/api/maintenance/reclassify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description_norm: norm, category_slug: slug }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `Reclassify failed for "${norm}"`);
        }
      }
      setPendingByNorm({});
      await refetch();
      onReclassified?.();
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    const count = Object.keys(pendingByNorm).length;
    if (count > 0) {
      const ok = window.confirm(
        `You have ${count} unsaved category change${count === 1 ? '' : 's'}. Discard them?`,
      );
      if (!ok) return;
    }
    onClose();
  };

  if (!open) return null;

  const pendingCount = Object.keys(pendingByNorm).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-4xl overflow-y-auto bg-white shadow-xl pb-16">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-2">
          <h2 className="text-sm font-semibold">{title || 'Tickets'}</h2>
          <button onClick={handleClose} className="text-gray-600 hover:text-gray-900">✕</button>
        </div>

        {loading && <div className="p-4 text-sm text-gray-600">Loading…</div>}
        {error && <div className="p-4 text-sm text-red-700">{error}</div>}

        {!loading && !error && (
          <table className="w-full text-xs">
            <thead className="sticky top-9 z-10 bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2 text-right">Res Time</th>
                <th className="px-3 py-2">Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const norm = r.descriptionNorm || normalizeDescription(r.subject);
                const staged = pendingByNorm[norm];
                const effectiveSlug = staged ?? r.categorySlug ?? 'other';
                const isModified = staged !== undefined;
                return (
                  <tr key={r.ticketId} className={`border-t hover:bg-gray-50 ${isModified ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{r.ticketId}</td>
                    <td className="px-3 py-2">{r.siteCode}</td>
                    <td className="px-3 py-2">
                      {r.subject}
                      {r.needsReview && (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1 text-amber-800">needs review</span>
                      )}
                      {isModified && (
                        <span className="ml-2 inline-block rounded bg-blue-100 px-1 text-blue-800">modified</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2">{r.priority || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{fmtHours(r.resolutionMinutes)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={effectiveSlug}
                        onChange={e => stageChange(norm, e.target.value, r.categorySlug)}
                        className={`rounded border px-1 py-0.5 text-xs ${isModified ? 'border-blue-400 bg-white' : ''}`}
                      >
                        {cats.map(c => (
                          <option key={c.slug} value={c.slug}>{c.displayName}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No tickets match.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {pendingCount > 0 && (
          <div className="sticky bottom-0 z-10 flex items-center justify-between border-t bg-white px-4 py-2 shadow-[0_-4px_6px_-2px_rgba(0,0,0,0.05)]">
            <span className="text-xs text-gray-700">
              <strong>{pendingCount}</strong> change{pendingCount === 1 ? '' : 's'} ready to save
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingByNorm({})}
                disabled={saving}
                className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={saveAll}
                disabled={saving}
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : `Save ${pendingCount} change${pendingCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
