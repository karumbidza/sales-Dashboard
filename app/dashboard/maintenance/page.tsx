'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MaintenanceKPICards from '@/components/MaintenanceKPICards';
import CategoryBreakdownChart from '@/components/charts/CategoryBreakdownChart';
import MaintenanceSiteTable, { MaintSiteRow } from '@/components/tables/MaintenanceSiteTable';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import InvoiceDrawer, { InvoiceFilters } from '@/components/maintenance/InvoiceDrawer';
import TopDescriptionsPanel from '@/components/maintenance/TopDescriptionsPanel';
import AnomalyChips from '@/components/maintenance/AnomalyChips';

interface MaintFilters {
  dateFrom: string;
  dateTo: string;
  territory: string;
  category: string;
}

function defaultFilters(): MaintFilters {
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  return {
    dateFrom: yearStart,
    dateTo: today.toISOString().split('T')[0],
    territory: '',
    category: '',
  };
}

function FuelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6 flex-shrink-0">
      <path d="M3 22V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>
      <path d="M3 22h12"/>
      <path d="M15 8h2a2 2 0 0 1 2 2v6a1 1 0 0 0 2 0V9l-3-3"/>
      <rect x="6" y="9" width="6" height="5" rx="1"/>
    </svg>
  );
}

export default function MaintenancePage() {
  const router = useRouter();
  const [filters, setFilters] = useState<MaintFilters>(defaultFilters());
  const [kpis, setKpis]       = useState<any>(null);
  const [trend, setTrend]     = useState<any[]>([]);
  const [cats, setCats]       = useState<any[]>([]);
  const [sites, setSites]     = useState<MaintSiteRow[]>([]);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ filters: InvoiceFilters; title?: string } | null>(null);

  const buildQS = (f: MaintFilters) => {
    const p = new URLSearchParams();
    if (f.dateFrom)  p.set('dateFrom',  f.dateFrom);
    if (f.dateTo)    p.set('dateTo',    f.dateTo);
    if (f.territory) p.set('territory', f.territory);
    if (f.category)  p.set('category',  f.category);
    return p.toString();
  };

  const fetchAll = useCallback(async (f: MaintFilters) => {
    setLoading(true);
    try {
      const qs = buildQS(f);
      const [kpisRes, trendRes, catsRes, sitesRes] = await Promise.all([
        fetch(`/api/maintenance/kpis?${qs}`).then(r => r.json()),
        fetch(`/api/maintenance/trend?${qs}&granularity=monthly`).then(r => r.json()),
        fetch(`/api/maintenance/categories?${qs}`).then(r => r.json()),
        fetch(`/api/maintenance/sites?${qs}&sortBy=cost_per_litre&sortDir=desc&limit=1000`).then(r => r.json()),
      ]);
      setKpis(kpisRes?.data || null);
      setTrend(trendRes?.data || []);
      setCats(catsRes?.data || []);
      setSites(sitesRes?.data || []);
    } catch (e) {
      console.error('R&M fetch error', e);
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

  const hasData = (kpis?.sitesWithActivity ?? 0) > 0;

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      {/* Header */}
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <FuelIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>R&amp;M / Maintenance Report</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button
              onClick={() => fetchAll(filters)}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition"
            >
              Refresh
            </button>
            <button
              onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); router.push('/login'); }}
              className="text-xs text-white/60 hover:text-white px-2 py-1.5 rounded-md transition"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Tab strip — Link tabs cross-route back to dashboard */}
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"      className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Overview</Link>
          <Link href="/dashboard"      className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sites</Link>
          <Link href="/dashboard"      className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <span                        className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Maintenance</span>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        {/* Filter bar */}
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
            <label className="block text-xs font-semibold text-gray-500 mb-1">Territory</label>
            <input type="text" placeholder="e.g. TAFARA" value={filters.territory}
                   onChange={e => setFilters(f => ({ ...f, territory: e.target.value }))}
                   className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
            <select value={filters.category}
                    onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
                    className="text-sm border rounded px-2 py-1">
              <option value="">All categories</option>
              {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            onClick={async () => {
              const root = document.getElementById('rm-export-root');
              if (!root) return;
              const mod = await import('html2pdf.js');
              const html2pdf = (mod as any).default ?? mod;
              await html2pdf().set({
                margin: 6,
                filename: `RM-Report-${filters.dateFrom}_to_${filters.dateTo}.pdf`,
                image: { type: 'jpeg', quality: 0.95 },
                html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
                pagebreak: { mode: ['css', 'legacy'] },
              }).from(root).save();
            }}
            className="ml-auto text-xs font-medium bg-[#1e3a5f] text-white px-3 py-1.5 rounded-md hover:bg-[#162a45]"
          >
            Export PDF
          </button>
        </div>

        {loading && (
          <div className="card mt-5 text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading R&amp;M data…</p>
          </div>
        )}

        {!loading && !hasData && (
          <div className="card mt-5 text-center py-12">
            <p className="text-sm text-gray-500 mb-3">No R&amp;M data for the selected filters.</p>
            <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
              Go to Data Management to upload →
            </Link>
          </div>
        )}

        {!loading && hasData && (
          <div id="rm-export-root">
            <div className="mt-5">
              <AnomalyChips
                filters={{ dateFrom: filters.dateFrom, dateTo: filters.dateTo }}
                needsReviewCount={kpis?.needsReviewCount || 0}
                onClickAnomalies={() => setDrawer({
                  filters: { dateFrom: filters.dateFrom, dateTo: filters.dateTo, territory: filters.territory },
                  title: 'Anomalous invoices',
                })}
                onClickNeedsReview={() => setDrawer({
                  filters: {
                    dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                    territory: filters.territory, needsReview: true,
                  },
                  title: 'Invoices needing review',
                })}
              />
            </div>

            <div className="mt-5">
              <MaintenanceKPICards kpis={kpis} />
            </div>

            <div className="card mt-5" style={{ pageBreakBefore: 'always' }}>
              <h2 className="text-sm font-semibold text-gray-800 mb-3">R&amp;M Cost Trend</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trend} margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#f3f4f6" />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Cost']} />
                  <Line type="monotone" dataKey="cost" stroke="#1e3a5f" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card mt-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Cost by Category</h2>
              <CategoryBreakdownChart data={cats} />
            </div>

            <TopDescriptionsPanel
              filters={{
                dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                territory: filters.territory, category: filters.category,
              }}
              onPickDescription={(desc, label) => setDrawer({
                filters: {
                  description: desc,
                  dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                  territory: filters.territory,
                },
                title: `Invoices: ${label}`,
              })}
            />

            <div className="card mt-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Site Ranking — Cost per Litre</h2>
              <MaintenanceSiteTable
                data={sites}
                onRowClick={(row) => setDrawer({
                  filters: {
                    siteCode: row.siteCode,
                    dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                    territory: filters.territory, category: filters.category,
                  },
                  title: `Invoices: ${row.siteName}`,
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
          </div>
        )}
      </main>
    </div>
  );
}
