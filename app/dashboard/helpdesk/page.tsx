// app/dashboard/helpdesk/page.tsx
// Helpdesk tab — Efficiency lens (KPI strip + Aging + Recurring) plus
// the Tickets-by-Category heatmap. Shares the Generate PDF endpoint
// with /dashboard/rm (same combined 5-page report).
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RMFilterBar, { defaultRMFilters, RMFilters } from '@/components/rm/RMFilterBar';
import EfficiencyKpiStrip from '@/components/rm/EfficiencyKpiStrip';
import TicketAgingChart from '@/components/rm/TicketAgingChart';
import RecurringIssuesPanel from '@/components/rm/RecurringIssuesPanel';
import TicketHeatmap from '@/components/rm/TicketHeatmap';

const ChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-5" />
  </svg>
);

function LensDivider({ label }: { label: string }) {
  return (
    <div className="mt-[18px] mb-[14px] flex items-center">
      <div className="w-[3px] h-[18px] mr-2" style={{ background: '#ea580c' }} />
      <span className="text-[10px] uppercase font-semibold tracking-[0.6px] text-gray-700">{label}</span>
    </div>
  );
}

export default function HelpdeskPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<RMFilters>(defaultRMFilters());
  const [generating, setGenerating] = useState(false);

  async function handleGeneratePDF() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/reports/rm/generate', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          dateFrom:  filters.dateFrom,
          dateTo:    filters.dateTo,
          territory: filters.territory || undefined,
          siteCode:  filters.siteCode  || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`PDF generation failed: ${err.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `Redan-RM-Report-${filters.dateFrom}_to_${filters.dateTo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`PDF generation failed: ${e.message || 'unknown error'}`);
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
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>Helpdesk · operational efficiency · tickets × category</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={handleGeneratePDF} disabled={generating}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-md transition">
              {generating ? 'Generating PDF…' : 'Generate R&M Report'}
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
          <Link href="/dashboard/rm"                  className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">R&amp;M Cost</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Helpdesk</span>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <RMFilterBar value={filters} onChange={setFilters} />

        <LensDivider label="EFFICIENCY LENS · OPERATIONAL" />
        <EfficiencyKpiStrip filters={filters} />
        <div className="grid grid-cols-2 gap-[10px] mb-[10px]">
          <TicketAgingChart filters={filters} />
          <RecurringIssuesPanel filters={filters} />
        </div>

        <LensDivider label="TICKETS · CATEGORY BREAKDOWN" />
        <TicketHeatmap filters={filters} />

        {/* contentEditable placeholder for the heatmap's per-site note cells */}
        <style>{`
          .rm-note-cell:empty::before {
            content: attr(data-placeholder);
            color: #d1d5db;
            pointer-events: none;
          }
        `}</style>
      </main>
    </div>
  );
}
