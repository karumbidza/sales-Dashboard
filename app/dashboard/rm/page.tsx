'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RMFilterBar, { defaultRMFilters, RMFilters } from '@/components/rm/RMFilterBar';
import CostKpiStrip from '@/components/rm/CostKpiStrip';
import CostParetoChart from '@/components/rm/CostParetoChart';
import CostTrendChart from '@/components/rm/CostTrendChart';
import CostHeatmap from '@/components/rm/CostHeatmap';

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
  const [notesOpen, setNotesOpen] = useState(false);

  // The All-Sites heatmap is always YTD regardless of the user's selected window.
  const ytdFilters = (() => {
    const now = new Date();
    const yearStart = `${now.getUTCFullYear()}-01-01`;
    const today     = now.toISOString().slice(0, 10);
    return { ...filters, dateFrom: yearStart, dateTo: today };
  })();

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
      const res = await fetch('/api/reports/rm/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          territory: filters.territory || undefined,
          siteCode: filters.siteCode || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`PDF generation failed: ${err.error || res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
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
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>R&amp;M Cost · spend × site × category</p>
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
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">R&amp;M Cost</span>
          <Link href="/dashboard/helpdesk"            className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        {/* contentEditable placeholder for the heatmap's per-site note cells */}
        <style>{`
          .rm-note-cell:empty::before {
            content: attr(data-placeholder);
            color: #d1d5db;
            pointer-events: none;
          }
        `}</style>

        <RMFilterBar value={filters} onChange={setFilters} />

        <div>
          <div className="bg-white border border-gray-200 rounded-md px-3 py-2 mb-[10px] text-[10px] text-gray-600">
            <span className="font-semibold uppercase tracking-wide text-gray-500 mr-2">Report window</span>
            {filters.dateFrom} → {filters.dateTo}
            {filters.territory && <span> · Territory: <span className="font-medium">{filters.territory}</span></span>}
            {filters.siteCode  && <span> · Site: <span className="font-medium">{filters.siteCode}</span></span>}
            {filters.category  && <span> · Category: <span className="font-medium">{filters.category}</span></span>}
            <span className="float-right text-gray-400">Generated {new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <div>
            <LensDivider label="COST LENS · FINANCIAL" accent="cost" />
            <CostKpiStrip filters={filters} />
          </div>
          <div className="grid grid-cols-2 gap-[10px] mb-[10px]">
            <div><CostParetoChart filters={filters} /></div>
            <div><CostTrendChart filters={filters} /></div>
          </div>

          {notes.trim() && (
            <div className="bg-white border border-gray-200 rounded-md p-3 mb-[10px]">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-2">Overview</div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{notes}</div>
            </div>
          )}

          {/* Top 20 sites for the selected window, with per-site notes. */}
          <div>
            <CostHeatmap
              filters={filters}
              mode="commented"
              rowCap={20}
              title={`Top 20 Sites — ${filters.dateFrom} → ${filters.dateTo} (with explanations)`}
            />
          </div>

          {/* Full YTD list, no notes, always all sites. */}
          <div>
            <CostHeatmap
              filters={{ ...filters, dateFrom: ytdFilters.dateFrom, dateTo: ytdFilters.dateTo }}
              mode="plain"
              title={`All Sites — ${ytdFilters.dateFrom} → ${ytdFilters.dateTo} (YTD)`}
            />
          </div>

        </div>
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
                  saved locally per date window · shows below Pareto + Trend in the PDF
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
                placeholder="Short overview of the two charts: e.g. 'Spend tracking 4.3% above LY, mainly Capex on canopy replacements at GRE-023. 8 categories drive 80% of YTD; Pumps + Other lead at $81K and $69K. Feb was the YTD peak at $141K, well above the Feb-2025 baseline of $53K.'"
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
