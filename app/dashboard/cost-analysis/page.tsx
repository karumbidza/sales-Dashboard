'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CostKPICards from '@/components/cost-analysis/CostKPICards';
import CostMatrixTable, { CostCell } from '@/components/cost-analysis/CostMatrixTable';
import InvoiceDrawer, { InvoiceFilters } from '@/components/maintenance/InvoiceDrawer';

interface CostFilters {
  dateFrom: string;
  dateTo:   string;
  category: string;
  siteCode: string;
}

function defaultFilters(): CostFilters {
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  return {
    dateFrom: yearStart,
    dateTo:   today.toISOString().split('T')[0],
    category: '',
    siteCode: '',
  };
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6 flex-shrink-0">
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 4 4 5-7" />
    </svg>
  );
}

export default function CostAnalysisPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<CostFilters>(defaultFilters());
  const [kpis, setKpis]   = useState<any>(null);
  const [cells, setCells] = useState<CostCell[]>([]);
  const [allCategories, setAllCategories] = useState<{ slug: string; displayName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ filters: InvoiceFilters; title?: string } | null>(null);

  const buildQS = (f: CostFilters) => {
    const p = new URLSearchParams();
    if (f.dateFrom) p.set('dateFrom', f.dateFrom);
    if (f.dateTo)   p.set('dateTo',   f.dateTo);
    if (f.category) p.set('category', f.category);
    if (f.siteCode) p.set('siteCode', f.siteCode);
    return p.toString();
  };

  const fetchAll = useCallback(async (f: CostFilters) => {
    setLoading(true);
    try {
      const qs = buildQS(f);
      const [sRes, mRes] = await Promise.all([
        fetch(`/api/cost-analysis/summary?${qs}`).then(r => r.json()),
        fetch(`/api/cost-analysis/matrix?${qs}`).then(r => r.json()),
      ]);
      setKpis(sRes?.data || null);
      setCells(mRes?.data || []);
    } catch (e) {
      console.error('Cost analysis fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(filters); }, [filters, fetchAll]);

  useEffect(() => {
    fetch('/api/maintenance/categories-list')
      .then(r => r.json())
      .then(d => setAllCategories(d.data || []))
      .catch(() => {});
  }, []);

  const hasData = (kpis?.totalInvoiceCost ?? 0) > 0 || (kpis?.totalTickets ?? 0) > 0;

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ChartIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>Cost Analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => fetchAll(filters)}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition">
              Refresh
            </button>
            <button onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); router.push('/login'); }}
                    className="text-xs text-white/60 hover:text-white px-2 py-1.5 rounded-md transition">
              Sign out
            </button>
          </div>
        </div>

        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <Link href="/dashboard/rm"                  className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">R&amp;M Command Center</Link>
          <Link href="/dashboard/maintenance"         className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/helpdesk"            className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Cost Analysis</span>
          <Link href="/dashboard/monthly-report"      className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Monthly Report</Link>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <div className="card flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
            <input type="date" value={filters.dateFrom}
                   onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                   className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
            <input type="date" value={filters.dateTo}
                   onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                   className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
            <select value={filters.category}
                    onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
                    className="text-sm border rounded px-2 py-1">
              <option value="">All categories</option>
              {allCategories.map(c => <option key={c.slug} value={c.slug}>{c.displayName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Site code</label>
            <input type="text" placeholder="e.g. ZIN-074" value={filters.siteCode}
                   onChange={e => setFilters(f => ({ ...f, siteCode: e.target.value.toUpperCase() }))}
                   className="text-sm border rounded px-2 py-1" />
          </div>
        </div>

        {loading && (
          <div className="card mt-5 text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading cost analysis…</p>
          </div>
        )}

        {!loading && !hasData && (
          <div className="card mt-5 text-center py-12">
            <p className="text-sm text-gray-500 mb-3">No invoices or tickets match the selected filters.</p>
            <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
              Go to Data Management to upload →
            </Link>
          </div>
        )}

        {!loading && hasData && (
          <>
            <div className="mt-5">
              <CostKPICards kpis={kpis} />
            </div>

            <div className="card mt-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Site × Category Cost / Ticket</h2>
              <CostMatrixTable
                rows={cells}
                onCellClick={(ctx) => setDrawer({
                  filters: {
                    siteCode: ctx.siteCode,
                    category: ctx.categorySlug || undefined,
                    dateFrom: filters.dateFrom,
                    dateTo:   filters.dateTo,
                  },
                  title: `Invoices: ${ctx.siteName}${ctx.categorySlug ? ` · ${ctx.categorySlug}` : ''}`,
                })}
              />
            </div>

            <InvoiceDrawer
              open={drawer != null}
              filters={drawer?.filters || {}}
              title={drawer?.title}
              onClose={() => setDrawer(null)}
              onReclassified={() => fetchAll(filters)}
            />
          </>
        )}
      </main>
    </div>
  );
}
