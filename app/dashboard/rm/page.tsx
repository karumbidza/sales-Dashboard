'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RMFilterBar, { defaultRMFilters, RMFilters } from '@/components/rm/RMFilterBar';
import CostKpiStrip from '@/components/rm/CostKpiStrip';
import CostParetoChart from '@/components/rm/CostParetoChart';
import CostTrendChart from '@/components/rm/CostTrendChart';
import CostHeatmap from '@/components/rm/CostHeatmap';
import EfficiencyKpiStrip from '@/components/rm/EfficiencyKpiStrip';
import TicketAgingChart from '@/components/rm/TicketAgingChart';
import RecurringIssuesPanel from '@/components/rm/RecurringIssuesPanel';

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


export default function RMCommandCenterPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<RMFilters>(defaultRMFilters());
  const [generating, setGenerating] = useState(false);

  async function handleGeneratePDF() {
    if (generating) return;
    setGenerating(true);
    try {
      const root = document.getElementById('rm-report-root');
      if (!root) return;
      const mod = await import('html2pdf.js');
      const html2pdf = (mod as any).default ?? mod;
      await html2pdf().set({
        margin: 6,
        filename: `Redan-RM-Report-${filters.dateFrom}_to_${filters.dateTo}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(root).save();
    } finally {
      setGenerating(false);
    }
  }

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
            <button onClick={handleGeneratePDF}
                    disabled={generating}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-md transition">
              {generating ? 'Generating PDF…' : 'Generate PDF'}
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
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">R&amp;M Command Center</span>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <RMFilterBar value={filters} onChange={setFilters} />

        <div id="rm-report-root">
          <div className="bg-white border border-gray-200 rounded-md px-3 py-2 mb-[10px] text-[10px] text-gray-600">
            <span className="font-semibold uppercase tracking-wide text-gray-500 mr-2">Report window</span>
            {filters.dateFrom} → {filters.dateTo}
            {filters.territory && <span> · Territory: <span className="font-medium">{filters.territory}</span></span>}
            {filters.siteCode  && <span> · Site: <span className="font-medium">{filters.siteCode}</span></span>}
            {filters.category  && <span> · Category: <span className="font-medium">{filters.category}</span></span>}
            <span className="float-right text-gray-400">Generated {new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <LensDivider label="COST LENS · FINANCIAL" accent="cost" />
          <CostKpiStrip filters={filters} />
          <div className="grid grid-cols-2 gap-[10px] mb-[10px]">
            <CostParetoChart filters={filters} />
            <CostTrendChart filters={filters} />
          </div>
          <CostHeatmap filters={filters} />

          <LensDivider label="EFFICIENCY LENS · OPERATIONAL" accent="efficiency" />
          <EfficiencyKpiStrip filters={filters} />
          <div className="grid grid-cols-2 gap-[10px]">
            <TicketAgingChart filters={filters} />
            <RecurringIssuesPanel filters={filters} />
          </div>
        </div>
      </main>
    </div>
  );
}
