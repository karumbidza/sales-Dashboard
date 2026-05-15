'use client';

import { useEffect, useState } from 'react';
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

  // Report notes — manually entered commentary that gets included in the PDF.
  // Persisted to localStorage keyed by the active date window so switching
  // filters and coming back later doesn't lose the writeup.
  const notesKey = `rm-notes-${filters.dateFrom}-${filters.dateTo}`;
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setNotes(localStorage.getItem(notesKey) || '');
  }, [notesKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (notes) localStorage.setItem(notesKey, notes);
    else localStorage.removeItem(notesKey);
  }, [notes, notesKey]);

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
        {/* PDF page-break rules — scoped to #rm-report-root so they only fire
            when html2pdf captures the report. */}
        <style>{`
          #rm-report-root tr { break-inside: avoid; page-break-inside: avoid; }
          #rm-report-root .pdf-keep { break-inside: avoid; page-break-inside: avoid; }
          #rm-report-root .pdf-page-break-before { break-before: page; page-break-before: always; }
        `}</style>

        <RMFilterBar value={filters} onChange={setFilters} />

        {/* Notes editor — visible only in the app, not captured in the PDF. */}
        <div className="card mb-4">
          <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">
            Report Notes — what drove the numbers this period?
            <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">(saved locally per date window)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Feb spike driven by emergency generator overhaul at ZIN-074 (invoice INV-12345, $28K). Pumps category running 22% above LY because we replaced 3 dispensers at GRE-023…"
            className="w-full text-sm border border-gray-200 rounded p-2 min-h-[72px] resize-y focus:outline-none focus:border-[#1e3a5f]"
          />
        </div>

        <div id="rm-report-root">
          <div className="bg-white border border-gray-200 rounded-md px-3 py-2 mb-[10px] text-[10px] text-gray-600 pdf-keep">
            <span className="font-semibold uppercase tracking-wide text-gray-500 mr-2">Report window</span>
            {filters.dateFrom} → {filters.dateTo}
            {filters.territory && <span> · Territory: <span className="font-medium">{filters.territory}</span></span>}
            {filters.siteCode  && <span> · Site: <span className="font-medium">{filters.siteCode}</span></span>}
            {filters.category  && <span> · Category: <span className="font-medium">{filters.category}</span></span>}
            <span className="float-right text-gray-400">Generated {new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          {notes.trim() && (
            <div className="bg-white border border-gray-200 rounded-md p-3 mb-[10px] pdf-keep">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-2">Notes</div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{notes}</div>
            </div>
          )}

          <div className="pdf-keep">
            <LensDivider label="COST LENS · FINANCIAL" accent="cost" />
            <CostKpiStrip filters={filters} />
          </div>
          <div className="grid grid-cols-2 gap-[10px] mb-[10px]">
            <div className="pdf-keep"><CostParetoChart filters={filters} /></div>
            <div className="pdf-keep"><CostTrendChart filters={filters} /></div>
          </div>
          <CostHeatmap filters={filters} />

          <div className="pdf-page-break-before pdf-keep">
            <LensDivider label="EFFICIENCY LENS · OPERATIONAL" accent="efficiency" />
            <EfficiencyKpiStrip filters={filters} />
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <div className="pdf-keep"><TicketAgingChart filters={filters} /></div>
            <div className="pdf-keep"><RecurringIssuesPanel filters={filters} /></div>
          </div>
        </div>
      </main>
    </div>
  );
}
