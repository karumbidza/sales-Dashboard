'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RMFilterBar, { defaultRMFilters, RMFilters } from '@/components/rm/RMFilterBar';

const ChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-5" />
  </svg>
);

function LensDivider({ label, accent }: { label: string; accent: 'cost' | 'efficiency' }) {
  const color = accent === 'cost' ? '#1e3a5f' : '#ea580c';
  return (
    <div className="mt-[18px] mb-[14px] flex items-center" id={accent === 'cost' ? 'cost-lens' : 'efficiency-lens'}>
      <div className="w-[3px] h-[18px] mr-2" style={{ background: color }} />
      <span className="text-[10px] uppercase font-semibold tracking-[0.6px] text-gray-700">
        {label}
      </span>
    </div>
  );
}

function PlaceholderCard({ title, height = 'h-56' }: { title: string; height?: string }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-md p-3 ${height} flex flex-col`}>
      <div className="text-[11px] font-medium text-gray-700 mb-2">{title}</div>
      <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
        Coming next task
      </div>
    </div>
  );
}

export default function RMCommandCenterPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<RMFilters>(defaultRMFilters());

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ChartIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>R&amp;M Command Center · cost &amp; efficiency · tracked separately</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); router.push('/login'); }}
                    className="text-xs text-white/60 hover:text-white px-2 py-1.5 rounded-md transition">
              Sign out
            </button>
          </div>
        </div>

        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">R&amp;M Command Center</span>
          <Link href="/dashboard/maintenance"         className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/helpdesk"            className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
          <Link href="/dashboard/monthly-report"      className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Monthly Report</Link>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <RMFilterBar value={filters} onChange={setFilters} />

        <LensDivider label="COST LENS · FINANCIAL" accent="cost" />
        <div className="grid grid-cols-4 gap-2 mb-[10px]">
          <PlaceholderCard title="YTD Cost" height="h-24" />
          <PlaceholderCard title="MTD Cost" height="h-24" />
          <PlaceholderCard title="$ / Litre" height="h-24" />
          <PlaceholderCard title="Top Category" height="h-24" />
        </div>
        <div className="grid grid-cols-2 gap-[10px] mb-[10px]">
          <PlaceholderCard title="Cost Pareto" />
          <PlaceholderCard title="Cost Trend — YTD vs LY" />
        </div>
        <PlaceholderCard title="Site × Category heatmap" height="h-72" />

        <LensDivider label="EFFICIENCY LENS · OPERATIONAL" accent="efficiency" />
        <div className="grid grid-cols-4 gap-2 mb-[10px]">
          <PlaceholderCard title="Open Tickets" height="h-24" />
          <PlaceholderCard title="MTTR" height="h-24" />
          <PlaceholderCard title="SLA Hit Rate" height="h-24" />
          <PlaceholderCard title="Repeat Issues" height="h-24" />
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          <PlaceholderCard title="Ticket Aging" />
          <PlaceholderCard title="Recurring Issues — Top 4" />
        </div>
      </main>
    </div>
  );
}
