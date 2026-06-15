'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import UploadPanel from './UploadPanel';
import UnmatchedRowsPanel from './UnmatchedRowsPanel';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('en');
const fmtDuration = (ms: number | null) => !ms ? '—' : ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`;
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtPeriod = (iso: string | null) => {
  if (!iso) return '—';
  // Parse YYYY-MM-DD manually so JS Date timezone shifts never bite us.
  const m = String(iso).match(/^(\d{4})-(\d{2})/);
  if (!m) return iso;
  return `${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
};
// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

type SubTab = 'upload' | 'schema';

export default function DataManagementTab({ onSuccess }: { onSuccess: () => void }) {
  const [tab, setTab] = useState<SubTab>('upload');

  return (
    <div className="mt-5">
      {/* Sub-tab bar */}
      <div className="flex gap-1.5 mb-4">
        {([
          ['upload', 'Upload & History'],
          ['schema', 'Schema Reference'],
        ] as [SubTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md border transition
              ${tab === id
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'upload' && <UploadAndHistory onSuccess={onSuccess} />}
      {tab === 'schema' && <SchemaReference />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Sub-tab 1: Upload & History
// ──────────────────────────────────────────────────────────────

function UploadAndHistory({ onSuccess }: { onSuccess: () => void }) {
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/upload-log?limit=20');
      const json = await res.json();
      setUploads(json.data || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const total   = uploads.length;
  const success = uploads.filter(u => u.status === 'success').length;
  const failed  = uploads.filter(u => u.status === 'failed').length;

  const handleSuccess = () => { onSuccess(); load(); };

  return (
    <>
      <UnmatchedRowsPanel />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start mt-5">
      {/* LEFT: Upload panel (existing) */}
      <UploadPanel onSuccess={handleSuccess} />

      {/* RIGHT: History */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-900">Upload History</p>
          <button onClick={load} className="text-[10px] text-blue-600 hover:text-blue-800">↺ Refresh</button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <StatBox label="Total"   value={total}   />
          <StatBox label="Success" value={success} tone="green" />
          <StatBox label="Failed"  value={failed}  tone="red"   />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50">
                {['Date', 'File', 'Period', 'Status', 'Rows', 'Time'].map(h => (
                  <th key={h} className="text-[10px] font-semibold text-gray-500 px-2.5 py-1.5 text-left whitespace-nowrap border-b border-gray-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-6">Loading…</td></tr>}
              {!loading && uploads.length === 0 && (
                <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-6">No uploads yet</td></tr>
              )}
              {!loading && uploads.map(u => (
                <Fragment key={u.id}>
                  <tr
                      onClick={() => setExpanded(expanded === u.id ? null : u.id)}
                      className="cursor-pointer hover:bg-gray-50">
                    <td className="text-[10px] px-2.5 py-1.5 whitespace-nowrap border-b border-gray-100">{fmtDateTime(u.uploadedAt)}</td>
                    <td className="text-[11px] font-medium px-2.5 py-1.5 max-w-[160px] truncate border-b border-gray-100" title={u.fileName}>{u.fileName}</td>
                    <td className="text-[11px] px-2.5 py-1.5 text-gray-500 border-b border-gray-100">{fmtPeriod(u.periodMonth)}</td>
                    <td className="px-2.5 py-1.5 border-b border-gray-100">
                      <StatusPill status={u.status} />
                    </td>
                    <td className="text-[11px] px-2.5 py-1.5 font-mono border-b border-gray-100">{u.totalRows ? fmt(u.totalRows) : '—'}</td>
                    <td className="text-[11px] px-2.5 py-1.5 text-gray-500 border-b border-gray-100">{fmtDuration(u.durationMs)}</td>
                  </tr>
                  {expanded === u.id && (
                    <tr>
                      <td colSpan={6} className="bg-blue-50 px-3 py-2 border-b border-gray-100">
                        <p className="text-[11px] font-medium text-gray-900 mb-1.5">Row counts by table:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(u.rowCounts).map(([k, v]) => (
                            <span key={k} className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                              {k}: {fmt(v)}
                            </span>
                          ))}
                          {Object.keys(u.rowCounts).length === 0 && (
                            <span className="text-[10px] text-gray-400">No row data</span>
                          )}
                        </div>
                        {u.errorMessage && (
                          <p className="mt-2 text-[10px] font-mono text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                            {u.errorMessage}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// Sub-tab 2: Schema Reference
// ──────────────────────────────────────────────────────────────

const SCHEMA: { table: string; sheet: string; sheetTone: string; rows: string; purpose: string }[] = [
  { table: 'sites',              sheet: 'NAME INDEX',    sheetTone: 'blue',  rows: '77',      purpose: 'Master site list — all datasets join here via site_code' },
  { table: 'territories',        sheet: 'Seeded',        sheetTone: 'gray',  rows: '5',       purpose: 'Territory managers: Brendon, Tafara, Saliya, Tendai, Molly' },
  { table: 'sales',              sheet: 'STATUS REPORT', sheetTone: 'green', rows: '50K+',    purpose: 'Daily fuel sales — PRIMARY source of truth for all KPIs' },
  { table: 'volume_budget',      sheet: 'VOLUME BUDGET', sheetTone: 'blue',  rows: '900+',    purpose: 'Monthly budget & stretch targets per site, MOSO classification' },
  { table: 'petrotrade_sales',   sheet: 'PETROTRADE',    sheetTone: 'blue',  rows: '1K+',     purpose: 'Partner coupon volumes at fixed $0.05/L margin' },
  { table: 'site_margins',       sheet: 'MARGIN',        sheetTone: 'amber', rows: '900+',    purpose: 'Monthly $/litre net margin per site (same shape as VOLUME BUDGET)' },
  { table: 'reconciliation_log', sheet: 'Auto-built',    sheetTone: 'amber', rows: 'Dynamic', purpose: 'Control gap: status vs invoiced — flags >2% variance automatically' },
  { table: 'upload_log',         sheet: 'App',           sheetTone: 'gray',  rows: 'Dynamic', purpose: 'Audit trail of all Excel uploads with row counts and errors' },
  { table: 'upload_changes',     sheet: 'App',           sheetTone: 'gray',  rows: 'Dynamic', purpose: 'Per-field overwrite log captured during ingestion preflight' },
];

const TONES: Record<string, string> = {
  blue:  'bg-blue-100 text-blue-800',
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  gray:  'bg-gray-100 text-gray-600',
};

function SchemaReference() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-900 mb-3">Database Schema Reference</p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-[#1e3a5f] text-white">
              {['Table', 'Source Sheet', 'Rows', 'Purpose'].map(h => (
                <th key={h} className="text-[10px] font-semibold px-2.5 py-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCHEMA.map(s => (
              <tr key={s.table} className="hover:bg-gray-50 border-b border-gray-100">
                <td className="text-[10px] font-mono font-semibold text-blue-800 px-2.5 py-1.5">{s.table}</td>
                <td className="px-2.5 py-1.5">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TONES[s.sheetTone]}`}>{s.sheet}</span>
                </td>
                <td className="text-[11px] text-gray-500 px-2.5 py-1.5">{s.rows}</td>
                <td className="text-[10px] text-gray-700 px-2.5 py-1.5">{s.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Tiny presentational helpers
// ──────────────────────────────────────────────────────────────

function StatBox({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' }) {
  const bg = tone === 'green' ? 'bg-emerald-50' : tone === 'red' ? 'bg-red-50' : 'bg-gray-50';
  const lc = tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-700' : 'text-gray-500';
  const vc = tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600'   : 'text-gray-900';
  return (
    <div className={`${bg} rounded-lg px-3 py-2`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${lc}`}>{label}</p>
      <p className={`text-lg font-bold ${vc}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: 'success' | 'failed' | 'pending' }) {
  const map = {
    success: 'bg-emerald-100 text-emerald-800',
    failed:  'bg-red-100 text-red-800',
    pending: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

