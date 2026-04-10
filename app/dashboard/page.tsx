'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import KPICards from '@/components/KPICards';
import SalesTrendChart from '@/components/charts/SalesTrendChart';
import TopSitesTable from '@/components/tables/TopSitesTable';
import SiteBreakdownTable from '@/components/tables/SiteBreakdownTable';
import DashboardFilters from '@/components/ui/DashboardFilters';
import ReconciliationPanel from '@/components/ui/ReconciliationPanel';
import UploadPanel from '@/components/ui/UploadPanel';
import DataManagementTab from '@/components/ui/DataManagementTab';
import DatabaseViewerTab from '@/components/ui/DatabaseViewerTab';
import UploadAuditTrail from '@/components/ui/UploadAuditTrail';
import ReportGenerator from '@/components/ui/ReportGenerator';
import UnmatchedRowsPanel from '@/components/ui/UnmatchedRowsPanel';
import YearlyVolumeBudgetChart from '@/components/charts/YearlyVolumeBudgetChart';
import TerritoryScorecard from '@/components/charts/TerritoryScorecard';

export interface Filters {
  dateFrom: string;
  dateTo:   string;
  territory: string;
  product:   string;
  siteCode:  string;
  moso:      string;
}

function getDefaultFilters(): Filters {
  // Fallback used while /api/data-bounds is loading. Real default is the
  // current month start → most recent date that has sales data, applied on
  // mount once we know the latest sale_date in the DB.
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    dateFrom:  monthStart.toISOString().split('T')[0],
    dateTo:    today.toISOString().split('T')[0],
    territory: '',
    product:   '',
    siteCode:  '',
    moso:      '',
  };
}

// ── SVG Icons for tabs & nav ───────────────────────────────────────────────

const FuelIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
       className="w-6 h-6 flex-shrink-0">
    <path d="M3 22V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>
    <path d="M3 22h12"/>
    <path d="M15 8h2a2 2 0 0 1 2 2v6a1 1 0 0 0 2 0V9l-3-3"/>
    <rect x="6" y="9" width="6" height="5" rx="1"/>
  </svg>
);

const TAB_ICONS: Record<string, JSX.Element> = {
  overview: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0zm8-3a1 1 0 100 2 1 1 0 000-2zm-1 4a1 1 0 102 0v3a1 1 0 10-2 0v-3z"/>
    </svg>
  ),
  sites: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h3a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h3a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"/>
    </svg>
  ),
  reconcile: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/>
    </svg>
  ),
  data: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z"/>
      <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z"/>
      <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z"/>
    </svg>
  ),
};

const TAB_LABELS: Record<string, string> = {
  overview:  'Overview',
  sites:     'Sites',
  reconcile: 'Reconciliation',
  reports:   'Reports',
  data:      'Data Management',
  dbviewer:  'Database Viewer',
};

type Tab = 'overview' | 'sites' | 'reconcile' | 'reports' | 'data' | 'dbviewer';
const ALL_TABS: Tab[] = ['overview', 'sites', 'reconcile', 'reports', 'data', 'dbviewer'];

// ── Section wrapper ────────────────────────────────────────────────────────

function Section({ title, sub, children }: { title?: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card mt-5">
      {title && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [filters, setFilters]       = useState<Filters>(getDefaultFilters());
  const [kpis, setKpis]             = useState<any>(null);
  const [trend, setTrend]           = useState<any[]>([]);
  const [monthlyTrend, setMonthly]  = useState<any[]>([]);
  const [topSites, setTopSites]     = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [activeTab, setActiveTab]   = useState<Tab>('overview');

  const buildQS = (f: Filters) => {
    const p = new URLSearchParams();
    if (f.dateFrom)  p.set('dateFrom',  f.dateFrom);
    if (f.dateTo)    p.set('dateTo',    f.dateTo);
    if (f.territory) p.set('territory', f.territory);
    if (f.product)   p.set('product',   f.product);
    if (f.siteCode)  p.set('siteCode',  f.siteCode);
    if (f.moso)      p.set('moso',      f.moso);
    return p.toString();
  };

  const fetchAll = useCallback(async (f: Filters) => {
    setLoading(true);
    try {
      const qs = buildQS(f);
      const [kpisData, trendData, monthlyData, sitesData, terrData] = await Promise.all([
        fetch(`/api/kpis?${qs}`).then(r => r.json()),
        fetch(`/api/sales-trend?${qs}&granularity=daily`).then(r => r.json()),
        fetch(`/api/sales-trend?${qs}&granularity=monthly`).then(r => r.json()),
        fetch(`/api/top-sites?${qs}&limit=500&sortBy=budget`).then(r => r.json()),
        fetch(`/api/territory-performance?${qs}`).then(r => r.json()),
      ]);
      setKpis(kpisData);
      setTrend(trendData?.data || []);
      setMonthly(monthlyData?.data || []);
      setTopSites(sitesData?.data || []);
      setTerritories(terrData?.data || []);
    } catch (e) {
      console.error('Fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(filters); }, [filters, fetchAll]);

  // On first mount, anchor the date range on the latest sale_date in the DB
  // so the default view is "this month so far, up to the most recent report"
  // — independent of the wall clock.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/data-bounds')
      .then(r => r.json())
      .then(b => {
        if (cancelled || !b?.maxDate) return;
        const maxDate = b.maxDate as string; // YYYY-MM-DD
        const monthStart = `${maxDate.slice(0, 7)}-01`;
        setFilters(f => (f.dateTo === maxDate && f.dateFrom === monthStart)
          ? f
          : { ...f, dateFrom: monthStart, dateTo: maxDate });
      })
      .catch(() => { /* fall back to wall-clock default */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <FuelIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">
                Redan Sales Dashboard
              </h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>
                National Operations Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button
              onClick={() => fetchAll(filters)}
              className="flex items-center gap-1.5 text-xs font-medium text-white
                         bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path d="M2 8a6 6 0 1110.89-3H11a1 1 0 100 2h4a1 1 0 001-1V2a1 1 0 10-2 0v1.17A8 8 0 102 8a1 1 0 002 0z"/>
              </svg>
              Refresh
            </button>
            <button
              onClick={async () => {
                await fetch('/api/auth', { method: 'DELETE' });
                router.push('/login');
              }}
              className="flex items-center gap-1.5 text-xs font-medium
                         text-white/60 hover:text-white px-2 py-1.5 rounded-md transition"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path d="M10 2h3a1 1 0 011 1v10a1 1 0 01-1 1h-3a1 1 0 110-2h2V4h-2a1 1 0 110-2zM4.707 4.293a1 1 0 010 1.414L3.414 7H9a1 1 0 110 2H3.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z"/>
              </svg>
              Sign out
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          {ALL_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium
                          rounded-t-md transition-all
                          ${activeTab === tab
                            ? 'bg-[#f4f6f9] text-[#1e3a5f]'
                            : 'text-blue-200 hover:text-white hover:bg-white/10'}`}
            >
              {TAB_ICONS[tab]}
              {TAB_LABELS[tab]}
              {tab === 'reconcile' && (
                <span className="ml-1 bg-amber-400 text-amber-900 text-[9px] font-bold
                                 px-1.5 py-0.5 rounded-full leading-none">
                  !
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="max-w-screen-2xl mx-auto px-6 py-5">

        <DashboardFilters filters={filters} onChange={setFilters} />

        {loading && (
          <div className="card mt-5 text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent
                            rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading dashboard data…</p>
          </div>
        )}

        {/* OVERVIEW */}
        {!loading && activeTab === 'overview' && (
          <>
            <KPICards kpis={kpis} />

            <Section title="Territory Scorecard" sub="Sorted by volume">
              <TerritoryScorecard data={territories} />
            </Section>

            <Section title="Daily Volume Trend">
              <SalesTrendChart data={trend} type="daily" filters={filters} />
            </Section>

            <Section>
              <YearlyVolumeBudgetChart filters={{
                territory: filters.territory,
                moso:      filters.moso,
                siteCode:  filters.siteCode,
              }} />
            </Section>

            <Section title="Top 20 Sites by Budget">
              <TopSitesTable data={topSites.slice(0, 20)} />
            </Section>
          </>
        )}

        {/* SITES */}
        {!loading && activeTab === 'sites' && (
          <>
            <UnmatchedRowsPanel />
            <Section title="Full Site Breakdown" sub="Sorted by volume">
              <SiteBreakdownTable
                data={[...topSites].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))}
                type="sites"
                paginate
              />
            </Section>
          </>
        )}

        {/* RECONCILIATION */}
        {!loading && activeTab === 'reconcile' && (
          <ReconciliationPanel filters={filters} />
        )}

        {/* REPORTS */}
        {activeTab === 'reports' && (
          <div className="mt-5">
            <ReportGenerator filters={filters} />
          </div>
        )}

        {/* DATA MANAGEMENT */}
        {activeTab === 'data' && (
          <DataManagementTab onSuccess={() => fetchAll(filters)} />
        )}

        {/* DATABASE VIEWER */}
        {activeTab === 'dbviewer' && (
          <DatabaseViewerTab />
        )}

      </main>
    </div>
  );
}
