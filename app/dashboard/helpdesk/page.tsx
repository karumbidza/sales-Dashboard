'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import HelpdeskKPICards from '@/components/helpdesk/HelpdeskKPICards';
import TopRecurringPanel from '@/components/helpdesk/TopRecurringPanel';
import SitesPanel from '@/components/helpdesk/SitesPanel';
import ContractorsPanel from '@/components/helpdesk/ContractorsPanel';
import OpenTicketsPanel from '@/components/helpdesk/OpenTicketsPanel';
import TicketDrawer, { TicketFilters } from '@/components/helpdesk/TicketDrawer';

interface HelpdeskFilters {
  dateFrom: string;
  dateTo:   string;
  priority: string;
  status:   string;
  category: string;
}

function defaultFilters(): HelpdeskFilters {
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  return {
    dateFrom: yearStart,
    dateTo:   today.toISOString().split('T')[0],
    priority: '',
    status:   '',
    category: '',
  };
}

function HeadsetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6 flex-shrink-0">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1v-7h3v5zM3 19a2 2 0 0 0 2 2h1v-7H3v5z" />
    </svg>
  );
}

export default function HelpdeskPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<HelpdeskFilters>(defaultFilters());
  const [kpis, setKpis]   = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<{ slug: string; displayName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ filters: TicketFilters; title?: string } | null>(null);

  const buildQS = (f: HelpdeskFilters) => {
    const p = new URLSearchParams();
    if (f.dateFrom) p.set('dateFrom', f.dateFrom);
    if (f.dateTo)   p.set('dateTo',   f.dateTo);
    if (f.priority) p.set('priority', f.priority);
    if (f.status)   p.set('status',   f.status);
    if (f.category) p.set('category', f.category);
    return p.toString();
  };

  const fetchAll = useCallback(async (f: HelpdeskFilters) => {
    setLoading(true);
    try {
      const qs = buildQS(f);
      const [kpisRes, trendRes] = await Promise.all([
        fetch(`/api/helpdesk/kpis?${qs}`).then(r => r.json()),
        fetch(`/api/helpdesk/trend?${qs}&granularity=monthly`).then(r => r.json()),
      ]);
      setKpis(kpisRes?.data || null);
      setTrend(trendRes?.data || []);
    } catch (e) {
      console.error('Helpdesk fetch error', e);
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

  const hasData = (kpis?.openCount ?? 0) > 0 || trend.length > 0;

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <HeadsetIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>R&amp;M Helpdesk</p>
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
          <Link href="/dashboard/maintenance"         className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Helpdesk</span>
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
            <label className="block text-xs font-semibold text-gray-500 mb-1">Priority</label>
            <select value={filters.priority}
                    onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}
                    className="text-sm border rounded px-2 py-1">
              <option value="">All</option>
              <option value="Urgent">Urgent</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Status</label>
            <select value={filters.status}
                    onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                    className="text-sm border rounded px-2 py-1">
              <option value="">All</option>
              <option value="Open">Open</option>
              <option value="Pending">Pending</option>
              <option value="Resolved">Resolved</option>
              <option value="Closed">Closed</option>
            </select>
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
        </div>

        {loading && (
          <div className="card mt-5 text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading helpdesk data…</p>
          </div>
        )}

        {!loading && !hasData && (
          <div className="card mt-5 text-center py-12">
            <p className="text-sm text-gray-500 mb-3">No helpdesk data for the selected filters.</p>
            <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
              Go to Data Management to upload →
            </Link>
          </div>
        )}

        {!loading && hasData && (
          <>
            <div className="mt-5">
              <HelpdeskKPICards kpis={kpis} />
            </div>

            <div className="card mt-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Ticket Volume Trend (Monthly)</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trend} margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#f3f4f6" />
                  <XAxis dataKey="period" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} />
                  <Tooltip formatter={(v: number) => [`${v} tickets`, 'Count']} />
                  <Line type="monotone" dataKey="count" stroke="#1e3a5f" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
              <TopRecurringPanel
                filters={{
                  dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                  priority: filters.priority || undefined, category: filters.category || undefined,
                }}
                onPickDescription={(desc, label) => setDrawer({
                  filters: { description: desc, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                             priority: filters.priority || undefined, status: filters.status || undefined },
                  title: `Tickets: ${label}`,
                })}
              />
              <SitesPanel
                filters={{
                  dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                  priority: filters.priority || undefined, category: filters.category || undefined,
                }}
                onPickSite={(siteCode, siteName) => setDrawer({
                  filters: { siteCode, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                             priority: filters.priority || undefined, status: filters.status || undefined,
                             category: filters.category || undefined },
                  title: `Tickets: ${siteName}`,
                })}
              />
            </div>

            <div className="mt-5">
              <ContractorsPanel
                filters={{ dateFrom: filters.dateFrom, dateTo: filters.dateTo }}
                onPickContractor={(provider) => setDrawer({
                  filters: { provider, dateFrom: filters.dateFrom, dateTo: filters.dateTo },
                  title: `Tickets: ${provider}`,
                })}
              />
            </div>

            <div className="mt-5">
              <OpenTicketsPanel
                filters={{ priority: filters.priority || undefined, category: filters.category || undefined }}
                onPickTicket={(ticketId) => setDrawer({
                  filters: { ticketId },
                  title: `Ticket #${ticketId}`,
                })}
              />
            </div>

            <TicketDrawer
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
