// app/dashboard/helpdesk/page.tsx
// Helpdesk tab — Efficiency lens (KPI strip + Aging + Recurring) plus
// the Tickets-by-Category heatmap. Shares the Generate PDF endpoint
// with /dashboard/rm (same combined 5-page report).
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RMFilterBar, { defaultRMFilters, RMFilters } from '@/components/rm/RMFilterBar';
import EfficiencyKpiStrip from '@/components/rm/EfficiencyKpiStrip';
import TicketAgingChart from '@/components/rm/TicketAgingChart';
import TicketsParetoChart from '@/components/rm/TicketsParetoChart';
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
  const [notesOpen, setNotesOpen] = useState(false);

  // Shared notes store with /dashboard/rm — same date-windowed key, since
  // both pages feed the same combined Generate R&M Report PDF.
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
            <button onClick={() => setNotesOpen(true)}
                    className="relative flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition"
                    title="Edit report notes">
              Notes
              {notes.trim() && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-label="notes present" />
              )}
            </button>
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
          <TicketsParetoChart filters={filters} />
        </div>

        <LensDivider label="TICKETS · CATEGORY BREAKDOWN" />
        <TicketHeatmap filters={filters} />

        {/* Full list — every site with tickets, no per-site notes. */}
        <div className="mt-4">
          <TicketHeatmap
            filters={filters}
            mode="plain"
            title="All Sites · Tickets"
          />
        </div>

        {/* contentEditable placeholder for the heatmap's per-site note cells */}
        <style>{`
          .rm-note-cell:empty::before {
            content: attr(data-placeholder);
            color: #d1d5db;
            pointer-events: none;
          }
        `}</style>
      </main>

      {notesOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Report notes editor"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setNotesOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl w-full max-w-2xl mx-4 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div>
                <div className="text-sm font-semibold text-gray-900">Report Notes</div>
                <div className="text-[11px] text-gray-500">
                  saved locally per date window · shared with R&amp;M Cost · shows in the PDF
                </div>
              </div>
              <button
                onClick={() => setNotesOpen(false)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <textarea
                autoFocus
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Short overview of the helpdesk charts: e.g. 'Open ticket volume up 12% vs last month, driven by Pumps/Dispensers at WARREN HILLS (51 open). Aging healthy — only 4 tickets over 90 days. Top 5 categories account for 80% of all tickets.'"
                className="w-full text-sm border border-gray-200 rounded p-2 min-h-[200px] resize-y focus:outline-none focus:border-[#1e3a5f]"
              />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200 text-[11px] text-gray-500">
              <span>Window: {filters.dateFrom} → {filters.dateTo}</span>
              <button
                onClick={() => setNotesOpen(false)}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-[#1e3a5f] text-white hover:bg-[#16304f] transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
