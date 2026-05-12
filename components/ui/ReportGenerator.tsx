// components/ui/ReportGenerator.tsx
'use client';

import { useState } from 'react';
import { Filters } from '@/app/dashboard/page';
import type { AllSitesSortKey } from '@/components/tables/AllSitesPanel';

// Map the dashboard's client-side sort key to the /api/top-sites sort key.
const SORT_TO_API: Record<AllSitesSortKey, string> = {
  volume:        'volume',
  vsBudgetPct:   'vs_budget',
  vsStretchPct:  'vs_stretch',
  revenue:       'revenue',
  avgDaily:      'avg_daily',
  netMarginCpl:  'net_margin',
};

interface Props {
  filters: Filters;
  sitesSortBy?: AllSitesSortKey;
  onClose: () => void;
}

export default function ReportGenerator({ filters, sitesSortBy = 'volume', onClose }: Props) {
  const [reportName, setReportName]   = useState('');
  const [generatedBy, setGeneratedBy] = useState('');
  const [generating, setGenerating]   = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000); // 60s timeout

      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          dateFrom:    filters.dateFrom,
          dateTo:      filters.dateTo,
          territory:   filters.territory || null,
          product:     filters.product || null,
          generatedBy: generatedBy || 'Analyst',
          reportName:  reportName || `Sales Report ${filters.dateFrom} → ${filters.dateTo}`,
          sortBy:      SORT_TO_API[sitesSortBy],
        }),
      });
      clearTimeout(timer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Report generation failed' }));
        alert(err.error || `Report failed (${res.status})`);
        return;
      }

      const data = await res.json();
      if (data.html) {
        // Open report in a new tab with a print toolbar.
        // Browser's native print → "Save as PDF" handles SVGs, charts, and
        // complex CSS perfectly — far better than html2canvas-based solutions.
        const w = window.open('', '_blank');
        if (w) {
          // Inject a print toolbar before the report content
          const toolbar = `
            <div id="pdf-toolbar" style="
              position:fixed; top:0; left:0; right:0; z-index:9999;
              background:#1e3a5f; color:#fff; padding:10px 24px;
              display:flex; align-items:center; justify-content:space-between;
              font-family:-apple-system,sans-serif; font-size:13px;
              box-shadow:0 2px 8px rgba(0,0,0,0.15);
              -webkit-print-color-adjust:exact; print-color-adjust:exact;
            ">
              <span style="font-weight:600;">Redan Sales Dashboard — Report Preview</span>
              <div style="display:flex;gap:10px;">
                <button onclick="document.getElementById('pdf-toolbar').style.display='none';window.print();document.getElementById('pdf-toolbar').style.display='flex';"
                  style="background:#22c55e;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">
                  Save as PDF
                </button>
                <button onclick="window.close()"
                  style="background:rgba(255,255,255,0.15);color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;">
                  Close
                </button>
              </div>
            </div>
            <style>
              @media print { #pdf-toolbar { display:none !important; } }
              body { padding-top: 52px; }
            </style>`;

          // Insert toolbar into the HTML
          const htmlWithToolbar = data.html.replace('<body>', '<body>' + toolbar);
          w.document.write(htmlWithToolbar);
          w.document.close();
        }
      }
    } catch (err: any) {
      const msg = err.name === 'AbortError'
        ? 'Report generation timed out (60s). Try a smaller date range or specific territory.'
        : (err.message || 'Report generation failed');
      alert(msg);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Generate PDF Report</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              KPIs, charts, top 20 (current sort), and full site list.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1">Report Name</label>
            <input
              value={reportName}
              onChange={e => setReportName(e.target.value)}
              placeholder={`Sales Report ${filters.dateFrom} → ${filters.dateTo}`}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1">Prepared By</label>
            <input
              value={generatedBy}
              onChange={e => setGeneratedBy(e.target.value)}
              placeholder="e.g. Sales Manager"
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
            <div className="flex justify-between">
              <span>Period:</span><span className="font-medium text-gray-700">{filters.dateFrom} → {filters.dateTo}</span>
            </div>
            <div className="flex justify-between">
              <span>Territory:</span><span className="font-medium text-gray-700">{filters.territory || 'All Territories'}</span>
            </div>
            <div className="flex justify-between">
              <span>Product:</span><span className="font-medium text-gray-700">{filters.product || 'All Products'}</span>
            </div>
          </div>

          <button
            onClick={generate}
            disabled={generating}
            className="w-full py-2.5 bg-[#1e3a5f] hover:bg-blue-800 disabled:bg-gray-200
              text-white text-sm font-semibold rounded-lg transition"
          >
            {generating ? '⏳ Generating Report…' : '📥 Generate & Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
