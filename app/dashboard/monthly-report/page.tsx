'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ReportCover, { CoverData } from '@/components/exec/ReportCover';
import CostSection, { CostData } from '@/components/exec/CostSection';
import HelpdeskSection, { HelpdeskData } from '@/components/exec/HelpdeskSection';
import SitesSection, { SitesData } from '@/components/exec/SitesSection';
import ActionItemsSection, { ActionItemsData } from '@/components/exec/ActionItemsSection';

const ChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-5" />
  </svg>
);

interface ReportPayload {
  window:      { monthLabel: string; start: string; end: string };
  cover:       CoverData;
  cost:        CostData;
  helpdesk:    HelpdeskData;
  sites:       SitesData;
  actionItems: ActionItemsData;
}

function defaultMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth();
  const prevY = m0 === 0 ? y - 1 : y;
  const prevM = m0 === 0 ? 12 : m0;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

export default function MonthlyReportPage() {
  const router = useRouter();
  const [month, setMonth] = useState<string>(defaultMonth());
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const fetchReport = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/executive/monthly?month=${m}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load report');
      setData(json.data);
    } catch (e: any) {
      setError(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReport(month); }, [fetchReport, month]);

  const handleGeneratePDF = async () => {
    if (!data || generating) return;
    setGenerating(true);
    try {
      const root = document.getElementById('exec-report-root');
      if (!root) return;
      const mod = await import('html2pdf.js');
      const html2pdf = (mod as any).default ?? mod;
      await html2pdf().set({
        margin: 0,
        filename: `Redan-Monthly-Report-${month}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(root).save();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ChartIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>Monthly Report</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => fetchReport(month)}
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
          <Link href="/dashboard/rm"                  className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">R&amp;M Command Center</Link>
          <Link href="/dashboard/maintenance"         className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/helpdesk"            className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Monthly Report</span>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <div className="card flex flex-wrap gap-3 items-end mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Month</label>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="text-sm border rounded px-2 py-1"
            />
          </div>
          <button
            onClick={handleGeneratePDF}
            disabled={!data || loading || generating}
            className="ml-auto text-xs font-medium bg-[#1e3a5f] text-white px-3 py-1.5 rounded-md hover:bg-[#162a45] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? 'Generating PDF…' : 'Generate PDF'}
          </button>
        </div>

        {loading && (
          <div className="card text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading monthly report…</p>
          </div>
        )}

        {error && !loading && (
          <div className="card text-center py-10">
            <p className="text-sm text-red-700 mb-3">{error}</p>
            <button onClick={() => fetchReport(month)}
                    className="text-xs font-medium bg-[#1e3a5f] text-white px-3 py-1.5 rounded-md hover:bg-[#162a45]">
              Retry
            </button>
          </div>
        )}

        {data && !loading && (
          <div id="exec-report-root" className="bg-white shadow-sm rounded">
            <ReportCover cover={data.cover} />
            <CostSection cost={data.cost} currentPeriod={month} />
            <HelpdeskSection helpdesk={data.helpdesk} />
            <SitesSection sites={data.sites} />
            <ActionItemsSection actionItems={data.actionItems} />
          </div>
        )}
      </main>
    </div>
  );
}
