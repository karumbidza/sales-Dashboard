'use client';

import { useState, useEffect, useCallback } from 'react';

interface UploadRecord {
  id: number;
  fileName: string;
  fileSizeKb: number | null;
  periodMonth: string | null;
  status: 'success' | 'failed' | 'pending';
  rowCounts: Record<string, number>;
  totalRows: number;
  errorMessage: string | null;
  durationMs: number | null;
  uploadedAt: string;
}

interface Summary {
  totalUploads: number;
  successCount: number;
  failedCount: number;
  lastUploadedAt: string | null;
  lastFileName: string | null;
  lastPeriod: string | null;
}

const SHEET_LABELS: Record<string, string> = {
  name_index:    'Name Index',
  status_report: 'Status Report',
  petrotrade:    'Petrotrade',
  margin:        'Margin',
  volume_budget: 'Vol. Budget',
};

function fmt(n: number) {
  return n.toLocaleString('en');
}

function fmtDuration(ms: number | null) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtPeriod(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export default function UploadAuditTrail() {
  const [data, setData]       = useState<UploadRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/upload-log?limit=20');
      const json = await res.json();
      setData(json.data || []);
      setSummary(json.summary || null);
    } catch {
      // silently fail — trail is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Upload Audit Trail</h3>
          <p className="text-xs text-gray-400 mt-0.5">Last 20 ingestion runs</p>
        </div>
        <button
          onClick={load}
          className="text-xs text-blue-600 hover:text-blue-800 transition"
        >
          ↺ Refresh
        </button>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <SummaryCard label="Total Uploads" value={String(summary.totalUploads)} />
          <SummaryCard label="Successful"    value={String(summary.successCount)} color="green" />
          <SummaryCard label="Failed"        value={String(summary.failedCount)}  color={summary.failedCount > 0 ? 'red' : 'gray'} />
          <SummaryCard
            label="Last Upload"
            value={summary.lastUploadedAt ? fmtDate(summary.lastUploadedAt) : '—'}
            sub={summary.lastFileName || ''}
          />
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-gray-400 text-xs">Loading audit trail…</div>
      )}

      {!loading && data.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">
          No uploads yet. Upload your first Excel file to get started.
        </div>
      )}

      {!loading && data.length > 0 && (
        <div className="space-y-2">
          {data.map(row => (
            <div key={row.id} className="border border-gray-100 rounded-lg overflow-hidden">
              {/* Row header */}
              <button
                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition"
                onClick={() => setExpanded(expanded === row.id ? null : row.id)}
              >
                <div className="flex items-center gap-3">
                  {/* Status dot */}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    row.status === 'success' ? 'bg-emerald-500' :
                    row.status === 'failed'  ? 'bg-red-500' : 'bg-amber-400'
                  }`} />

                  {/* File name */}
                  <span className="text-xs font-medium text-gray-700 truncate flex-1 min-w-0">
                    {row.fileName}
                  </span>

                  {/* Period */}
                  <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:block">
                    {fmtPeriod(row.periodMonth)}
                  </span>

                  {/* Row count */}
                  <span className="text-xs font-mono text-gray-500 flex-shrink-0 hidden sm:block">
                    {row.totalRows > 0 ? `${fmt(row.totalRows)} rows` : '—'}
                  </span>

                  {/* Duration */}
                  <span className="text-xs text-gray-400 flex-shrink-0 hidden md:block">
                    {fmtDuration(row.durationMs)}
                  </span>

                  {/* Date */}
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {fmtDate(row.uploadedAt)}
                  </span>

                  {/* Status badge */}
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    row.status === 'success' ? 'bg-emerald-50 text-emerald-700' :
                    row.status === 'failed'  ? 'bg-red-50 text-red-700' :
                    'bg-amber-50 text-amber-700'
                  }`}>
                    {row.status}
                  </span>

                  <span className="text-xs text-gray-300 flex-shrink-0">
                    {expanded === row.id ? '▲' : '▼'}
                  </span>
                </div>
              </button>

              {/* Expanded detail */}
              {expanded === row.id && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">

                    {/* File info */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">File</p>
                      <p className="text-xs text-gray-700">{row.fileName}</p>
                      {row.fileSizeKb && (
                        <p className="text-xs text-gray-400">{row.fileSizeKb.toLocaleString()} KB</p>
                      )}
                    </div>

                    {/* Period & timing */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Period / Time</p>
                      <p className="text-xs text-gray-700">{fmtPeriod(row.periodMonth)}</p>
                      <p className="text-xs text-gray-400">Duration: {fmtDuration(row.durationMs)}</p>
                    </div>

                    {/* Sheet row counts */}
                    <div className="col-span-2 sm:col-span-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Rows per Sheet</p>
                      <div className="space-y-1">
                        {Object.entries(row.rowCounts).length > 0
                          ? Object.entries(row.rowCounts).map(([sheet, count]) => (
                              <div key={sheet} className="flex justify-between items-center">
                                <span className="text-xs text-gray-600">
                                  {SHEET_LABELS[sheet] || sheet}
                                </span>
                                <span className="text-xs font-mono font-semibold text-gray-800">
                                  {fmt(count)}
                                </span>
                              </div>
                            ))
                          : <p className="text-xs text-gray-400">—</p>
                        }
                        {row.totalRows > 0 && (
                          <div className="flex justify-between items-center border-t border-gray-200 pt-1 mt-1">
                            <span className="text-xs font-semibold text-gray-700">Total</span>
                            <span className="text-xs font-mono font-bold text-gray-900">{fmt(row.totalRows)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Error message if failed */}
                  {row.status === 'failed' && row.errorMessage && (
                    <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 font-mono">
                      {row.errorMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label, value, sub, color = 'gray',
}: {
  label: string; value: string; sub?: string;
  color?: 'green' | 'red' | 'gray';
}) {
  const colors = {
    green: 'text-emerald-600',
    red:   'text-red-600',
    gray:  'text-gray-800',
  };
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${colors[color]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
    </div>
  );
}
