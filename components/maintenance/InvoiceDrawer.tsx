// components/maintenance/InvoiceDrawer.tsx
'use client';

import { useEffect, useState } from 'react';

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
  const [error, setError] = useState<string | null>(null);

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
    if (open) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(filters)]);

  const reclassify = async (descriptionNorm: string, slug: string) => {
    const res = await fetch('/api/maintenance/reclassify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description_norm: descriptionNorm, category_slug: slug }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'Reclassify failed');
      return;
    }
    await refetch();
    onReclassified?.();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-2">
          <h2 className="text-sm font-semibold">{title || 'Invoices'}</h2>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-900">✕</button>
        </div>

        {loading && <div className="p-4 text-sm text-gray-600">Loading…</div>}
        {error && <div className="p-4 text-sm text-red-700">{error}</div>}

        {!loading && !error && (
          <table className="w-full text-xs">
            <thead className="sticky top-9 bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Net (LCY)</th>
                <th className="px-3 py-2">Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.entryNo} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap">{r.serviceDate}</td>
                  <td className="px-3 py-2">{r.siteCode}</td>
                  <td className="px-3 py-2">
                    {r.description}
                    {r.documentNo && <span className="ml-1 text-gray-400">#{r.documentNo}</span>}
                    {r.needsReview && (
                      <span className="ml-2 inline-block rounded bg-amber-100 px-1 text-amber-800">needs review</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.netCost.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <select
                      value={r.categorySlug || 'other'}
                      onChange={e => reclassify(r.description.replace(/\s+/g,' ').trim().toLowerCase(), e.target.value)}
                      className="rounded border px-1 py-0.5 text-xs"
                    >
                      {cats.map(c => (
                        <option key={c.slug} value={c.slug}>{c.displayName}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No invoices match.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
