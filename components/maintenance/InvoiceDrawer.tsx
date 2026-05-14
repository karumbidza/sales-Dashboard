// components/maintenance/InvoiceDrawer.tsx
'use client';

import { useEffect, useState } from 'react';
import { normalizeDescription } from '@/lib/normalize-description';

export interface InvoiceFilters {
  siteCode?: string;
  category?: string;        // slug
  description?: string;     // exact description_norm
  dateFrom?: string;
  dateTo?: string;
  needsReview?: boolean;
  minCost?: number;
  territory?: string;
}

interface Invoice {
  entryNo: number;
  siteCode: string;
  siteName: string;
  serviceDate: string;
  description: string;
  documentNo: string | null;
  externalDocNo: string | null;
  netCost: number;
  categorySlug: string | null;
  categoryName: string | null;
  confidence: string | null;
  needsReview: boolean;
  categorySource: string | null;
}

interface CategoryOption { slug: string; displayName: string; }

interface Props {
  open: boolean;
  filters: InvoiceFilters;
  title?: string;
  onClose: () => void;
  onReclassified?: () => void;
}

function buildQS(f: InvoiceFilters): string {
  const p = new URLSearchParams();
  if (f.siteCode)    p.set('siteCode', f.siteCode);
  if (f.category)    p.set('category', f.category);
  if (f.description) p.set('description', f.description);
  if (f.dateFrom)    p.set('dateFrom', f.dateFrom);
  if (f.dateTo)      p.set('dateTo', f.dateTo);
  if (f.territory)   p.set('territory', f.territory);
  if (f.needsReview) p.set('needsReview', 'true');
  if (f.minCost)     p.set('minCost', String(f.minCost));
  p.set('limit', '200');
  return p.toString();
}

export default function InvoiceDrawer({ open, filters, title, onClose, onReclassified }: Props) {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [cats, setCats] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pending category overrides keyed by description_norm so all rows that
  // share the same description reflect the staged change simultaneously.
  const [pendingByNorm, setPendingByNorm] = useState<Record<string, string>>({});

  const refetch = async () => {
    setLoading(true); setError(null);
    try {
      const [invRes, catRes] = await Promise.all([
        fetch(`/api/maintenance/invoices?${buildQS(filters)}`).then(r => r.json()),
        fetch('/api/maintenance/categories-list').then(r => r.json()),
      ]);
      setRows(invRes?.data || []);
      setCats(catRes?.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load invoices');
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

  const stageChange = (descriptionNorm: string, slug: string, originalSlug: string | null) => {
    setPendingByNorm(prev => {
      const next = { ...prev };
      if (slug === (originalSlug || 'other')) {
        // Reverted to original — drop the pending entry.
        delete next[descriptionNorm];
      } else {
        next[descriptionNorm] = slug;
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

  const discardChanges = () => setPendingByNorm({});

  const handleClose = () => {
    const pendingCount = Object.keys(pendingByNorm).length;
    if (pendingCount > 0) {
      const ok = window.confirm(
        `You have ${pendingCount} unsaved category change${pendingCount === 1 ? '' : 's'}. Discard them?`,
      );
      if (!ok) return;
    }
    onClose();
  };

  if (!open) return null;

  const pendingCount = Object.keys(pendingByNorm).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-white shadow-xl pb-16">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-2">
          <h2 className="text-sm font-semibold">{title || 'Invoices'}</h2>
          <button onClick={handleClose} className="text-gray-600 hover:text-gray-900">✕</button>
        </div>

        {loading && <div className="p-4 text-sm text-gray-600">Loading…</div>}
        {error && <div className="p-4 text-sm text-red-700">{error}</div>}

        {!loading && !error && (
          <table className="w-full text-xs">
            <thead className="sticky top-9 z-10 bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Net (LCY)</th>
                <th className="px-3 py-2">Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const norm = normalizeDescription(r.description);
                const staged = pendingByNorm[norm];
                const effectiveSlug = staged ?? r.categorySlug ?? 'other';
                const isModified = staged !== undefined;
                return (
                  <tr
                    key={r.entryNo}
                    className={`border-t hover:bg-gray-50 ${isModified ? 'bg-amber-50' : ''}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">{r.serviceDate}</td>
                    <td className="px-3 py-2">{r.siteCode}</td>
                    <td className="px-3 py-2">
                      {r.description}
                      {r.documentNo && <span className="ml-1 text-gray-400">#{r.documentNo}</span>}
                      {r.needsReview && (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1 text-amber-800">needs review</span>
                      )}
                      {isModified && (
                        <>
                          <span className="ml-2 inline-block rounded bg-blue-100 px-1 text-blue-800">modified</span>
                          <a
                            href={`/dashboard/maintenance/rules?pattern=${encodeURIComponent(norm)}&category_slug=${encodeURIComponent(staged ?? '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-blue-600 hover:underline"
                            title="Open the Rules page with this pattern prefilled"
                          >
                            Make this a rule?
                          </a>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.netCost.toLocaleString()}</td>
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
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No invoices match.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* Sticky footer with batched-save controls. Only renders when there
            is something to save — otherwise the drawer looks the same as before. */}
        {pendingCount > 0 && (
          <div className="sticky bottom-0 z-10 flex items-center justify-between border-t bg-white px-4 py-2 shadow-[0_-4px_6px_-2px_rgba(0,0,0,0.05)]">
            <span className="text-xs text-gray-700">
              <strong>{pendingCount}</strong> change{pendingCount === 1 ? '' : 's'} ready to save
            </span>
            <div className="flex gap-2">
              <button
                onClick={discardChanges}
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
