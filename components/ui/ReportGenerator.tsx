// components/ui/ReportGenerator.tsx
'use client';

import { useState, useEffect } from 'react';
import { Filters } from '@/app/dashboard/page';

interface Props { filters: Filters; }

interface Comment {
  id: number;
  comment_text: string;
  author: string;
  comment_type: string;
  ref_site_code: string | null;
  created_at: string;
}

export default function ReportGenerator({ filters }: Props) {
  const [reportName, setReportName]   = useState('');
  const [generatedBy, setGeneratedBy] = useState('');
  const [generating, setGenerating]   = useState(false);
  const [reportId, setReportId]       = useState<string | null>(null);
  const [comments, setComments]       = useState<Comment[]>([]);
  const [newComment, setNewComment]   = useState('');
  const [commentAuthor, setAuthor]    = useState('');
  const [pastReports, setPastReports] = useState<any[]>([]);

  // Helper: parse JSON only if the response is OK and actually has a body
  const safeJson = async (res: Response) => {
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  };

  useEffect(() => {
    fetch('/api/report')
      .then(safeJson)
      .then(d => setPastReports(d?.data || []))
      .catch(() => setPastReports([]));
  }, []);

  useEffect(() => {
    if (!reportId) return;
    fetch(`/api/comments?reportId=${reportId}`)
      .then(safeJson)
      .then(d => setComments(d?.data || []))
      .catch(() => setComments([]));
  }, [reportId]);

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
        // Render HTML into a hidden container, then convert to PDF
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.width = '210mm'; // A4 width
        container.innerHTML = data.html;
        document.body.appendChild(container);

        try {
          const html2pdfModule = await import('html2pdf.js');
          const html2pdf = html2pdfModule.default ?? html2pdfModule;

          const pdfName = (reportName || `Sales Report ${filters.dateFrom} to ${filters.dateTo}`)
            .replace(/[^a-zA-Z0-9 _-]/g, '') + '.pdf';

          await html2pdf().set({
            margin:       [10, 10, 10, 10],
            filename:     pdfName,
            image:        { type: 'jpeg', quality: 0.95 },
            html2canvas:  { scale: 2, useCORS: true, logging: false },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak:    { mode: ['css', 'legacy'], avoid: ['tr', '.no-break'] },
          }).from(container).save();
        } finally {
          document.body.removeChild(container);
        }
      }
      if (data.reportId) setReportId(data.reportId);

      // Refresh report list
      fetch('/api/report').then(r => r.json()).then(d => setPastReports(d.data || []));
    } finally {
      setGenerating(false);
    }
  };

  const addComment = async () => {
    if (!reportId || !newComment.trim()) return;
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportId,
        commentText: newComment,
        author: commentAuthor || 'Analyst',
        commentType: 'general',
      }),
    });
    const d = await res.json();
    setComments(prev => [...prev, d.data]);
    setNewComment('');
  };

  const deleteComment = async (id: number) => {
    await fetch(`/api/comments?id=${id}`, { method: 'DELETE' });
    setComments(prev => prev.filter(c => c.id !== id));
  };

  return (
    <div className="space-y-5">
      {/* Report Generator */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">📄 Generate PDF Report</h3>
        <p className="text-xs text-gray-400 mb-4">
          Creates a structured PDF with KPIs, charts, top sites, territory breakdown and comments.
        </p>

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

      {/* Comments Section */}
      {reportId && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">💬 Report Comments</h3>
          <p className="text-xs text-gray-400 mb-3">Add notes that will be included in the PDF report.</p>

          <div className="space-y-2 mb-4">
            {comments.length === 0 && (
              <p className="text-xs text-gray-300 text-center py-3">No comments yet</p>
            )}
            {comments.map(c => (
              <div key={c.id} className="flex gap-2 p-3 bg-amber-50 border border-amber-100 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-gray-700">{c.author}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(c.created_at).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{c.comment_text}</p>
                </div>
                <button onClick={() => deleteComment(c.id)}
                  className="text-gray-300 hover:text-red-400 text-sm self-start">×</button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <input
              value={commentAuthor}
              onChange={e => setAuthor(e.target.value)}
              placeholder="Your name"
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <textarea
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Add a comment or observation…"
              rows={3}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
            />
            <button
              onClick={addComment}
              disabled={!newComment.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200
                text-white text-xs font-semibold rounded-md transition"
            >
              + Add Comment
            </button>
          </div>
        </div>
      )}

      {/* Past Reports */}
      {pastReports.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">🗂 Past Reports</h3>
          <div className="space-y-2">
            {pastReports.slice(0, 8).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg hover:bg-blue-50 transition">
                <div>
                  <p className="text-xs font-medium text-gray-700">{r.report_name}</p>
                  <p className="text-xs text-gray-400">
                    {r.date_from} → {r.date_to}
                    {r.territory_filter && ` · ${r.territory_filter}`}
                    {' · '}{r.generated_by}
                  </p>
                </div>
                <button
                  onClick={() => setReportId(r.id)}
                  className="text-xs text-blue-500 hover:text-blue-700 font-medium ml-3"
                >
                  View Comments
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
