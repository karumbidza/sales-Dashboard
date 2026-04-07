// app/dashboard/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import KPICards from '@/components/KPICards';
import SalesTrendChart from '@/components/charts/SalesTrendChart';
import TerritoryChart from '@/components/charts/TerritoryChart';
import TopSitesTable from '@/components/tables/TopSitesTable';
import SiteBreakdownTable from '@/components/tables/SiteBreakdownTable';
import DashboardFilters from '@/components/ui/DashboardFilters';
import ReconciliationPanel from '@/components/ui/ReconciliationPanel';
import UploadPanel from '@/components/ui/UploadPanel';
import UploadAuditTrail from '@/components/ui/UploadAuditTrail';
import ReportGenerator from '@/components/ui/ReportGenerator';

export interface Filters {
  dateFrom: string;
  dateTo: string;
  territory: string;
  product: string;
  siteCode: string;
  moso: string;
}

function getDefaultFilters(): Filters {
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

export default function DashboardPage() {
  const [filters, setFilters] = useState<Filters>(getDefaultFilters());
  const [kpis, setKpis] = useState<any>(null);
  const [trend, setTrend] = useState<any>(null);
  const [monthlyTrend, setMonthlyTrend] = useState<any>(null);
  const [topSites, setTopSites] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview'|'sites'|'reconcile'|'reports'|'data'>('overview');

  const buildQS = (f: Filters) => {
    const p = new URLSearchParams();
    if (f.dateFrom)  p.set('dateFrom', f.dateFrom);
    if (f.dateTo)    p.set('dateTo', f.dateTo);
    if (f.territory) p.set('territory', f.territory);
    if (f.product)   p.set('product', f.product);
    if (f.siteCode)  p.set('siteCode', f.siteCode);
    if (f.moso)      p.set('moso', f.moso);
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
        fetch(`/api/top-sites?${qs}&limit=10`).then(r => r.json()),
        fetch(`/api/territory-performance?${qs}`).then(r => r.json()),
      ]);
      setKpis(kpisData);
      setTrend(trendData?.data || []);
      setMonthlyTrend(monthlyData?.data || []);
      setTopSites(sitesData?.data || []);
      setTerritories(terrData?.data || []);
    } catch (e) {
      console.error('Fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(filters); }, [filters, fetchAll]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-[#1e3a5f] text-white shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⛽</span>
            <div>
              <h1 className="text-lg font-bold tracking-wide">Fuel Sales Intelligence</h1>
              <p className="text-xs text-blue-200">National Operations Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-blue-200">
              As of {new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}
            </span>
            <button
              onClick={() => fetchAll(filters)}
              className="bg-blue-500 hover:bg-blue-400 text-white text-xs px-3 py-1.5 rounded-md transition"
            >
              ↺ Refresh
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-1 pb-0">
          {(['overview','sites','reconcile','reports','data'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize rounded-t-md transition
                ${activeTab === tab
                  ? 'bg-gray-50 text-[#1e3a5f]'
                  : 'text-blue-200 hover:text-white hover:bg-blue-800'}`}
            >
              {tab === 'reconcile' ? '⚠ Reconciliation' :
               tab === 'data'      ? '⬆ Data Management' :
               tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        {/* FILTERS */}
        <DashboardFilters filters={filters} onChange={setFilters} />

        {loading && (
          <div className="text-center py-10 text-gray-400 text-sm">Loading dashboard data…</div>
        )}

        {!loading && activeTab === 'overview' && (
          <>
            {/* KPI Cards */}
            <KPICards kpis={kpis} />

            {/* Charts Row */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mt-5">
              <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Volume Trend</h3>
                <SalesTrendChart data={trend} type="daily" />
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Territory Distribution</h3>
                <TerritoryChart data={territories} />
              </div>
            </div>

            {/* Monthly trend */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mt-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Volume vs Budget</h3>
              <SalesTrendChart data={monthlyTrend} type="monthly" />
            </div>

            {/* Top 10 sites */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mt-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Top 10 Sites by Volume</h3>
              <TopSitesTable data={topSites} />
            </div>

            {/* Territory table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mt-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Territory Performance</h3>
              <p className="text-xs text-gray-400 mb-4">Aggregated by Territory Manager</p>
              <SiteBreakdownTable data={territories} type="territory" />
            </div>
          </>
        )}

        {!loading && activeTab === 'sites' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mt-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Full Site Breakdown</h3>
            <SiteBreakdownTable data={topSites} type="sites" />
          </div>
        )}

        {!loading && activeTab === 'reconcile' && (
          <ReconciliationPanel filters={filters} />
        )}

        {activeTab === 'reports' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
            <ReportGenerator filters={filters} />
          </div>
        )}

        {activeTab === 'data' && (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Upload panel — takes 1/3 width */}
              <div>
                <UploadPanel onSuccess={() => fetchAll(filters)} />
              </div>
              {/* Audit trail — takes 2/3 width */}
              <div className="lg:col-span-2">
                <UploadAuditTrail />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
