'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import UploadPanel from './UploadPanel';

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

interface DbStats {
  counts: {
    salesRows: number; sites: number; budgetRecords: number;
    petrotradeRows: number; marginRecords: number; reconRecords: number;
    territories: number; reconFlags: number;
  };
  overview: {
    minDate: string | null; maxDate: string | null;
    tradingDays: number; sitesWithData: number;
    allTimeVolume: number; allTimeRevenue: number;
    lastReconRun: string | null;
  };
  recentSales: { date: string; sites: number; volume: number; revenue: number }[];
  budgetPeriods: { month: string; sites: number; volume: number }[];
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
const fmtMoney = (n: number) => {
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtVolume = (n: number) => {
  if (n >= 1e9) return `${(n/1e9).toFixed(2)}B L`;
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M L`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K L`;
  return `${n.toFixed(0)} L`;
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
  );
}

// ──────────────────────────────────────────────────────────────
// Sub-tab 2: Database Viewer
// ──────────────────────────────────────────────────────────────

interface BudgetMatrix {
  sites: { code: string; name: string }[];
  matrix: {
    month: string;
    cells: ({ b: number; s: number } | null)[];
  }[];
}

function DatabaseViewer() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [budgetMatrix, setBudgetMatrix] = useState<BudgetMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [inner, setInner] = useState<'overview' | 'recent' | 'budget'>('overview');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, bmRes] = await Promise.all([
        fetch('/api/db-stats'),
        fetch('/api/budget-matrix'),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (bmRes.ok)    setBudgetMatrix(await bmRes.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-900">Database Overview</p>
        <button onClick={load} className="text-[10px] text-blue-600 hover:text-blue-800">↺ Refresh</button>
      </div>

      {loading && <p className="text-xs text-gray-400 py-6 text-center">Loading…</p>}

      {!loading && stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <BigStat label="Sales Rows"      value={fmt(stats.counts.salesRows)}      color="#1e3a5f" />
            <BigStat label="Sites"           value={fmt(stats.counts.sites)}          color="#2563eb" />
            <BigStat label="Budget Records"  value={fmt(stats.counts.budgetRecords)}  color="#7c3aed" />
            <BigStat label="Petrotrade"      value={fmt(stats.counts.petrotradeRows)} color="#0891b2" />
            <BigStat label="Margin Records"  value={fmt(stats.counts.marginRecords)}  color="#059669" />
            <BigStat label="Recon. Records"  value={fmt(stats.counts.reconRecords)}   color="#d97706" />
            <BigStat label="Territories"     value={fmt(stats.counts.territories)}    color="#6b7280" />
            <BigStat label="Recon Flags"
                     value={`${fmt(stats.counts.reconFlags)}`}
                     sub={`/ ${fmt(stats.counts.reconRecords)}`}
                     color="#dc2626" tone="red" />
          </div>

          {/* Inner tab strip */}
          <div className="flex gap-1 mb-2.5 border-b border-gray-200 pb-2">
            {([
              ['overview', 'Overview'],
              ['recent',   'Recent Sales'],
              ['budget',   'Budget Periods'],
            ] as ['overview' | 'recent' | 'budget', string][]).map(([id, label]) => (
              <button key={id} onClick={() => setInner(id)}
                className={`text-[11px] px-2.5 py-1 rounded ${
                  inner === id ? 'bg-[#1e3a5f] text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-700'
                }`}>{label}</button>
            ))}
          </div>

          {inner === 'overview' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
              <Field label="Sales data span" value={`${stats.overview.minDate || '—'} → ${stats.overview.maxDate || '—'}`} small />
              <Field label="Trading days"    value={fmt(stats.overview.tradingDays)} />
              <Field label="Sites with data" value={fmt(stats.overview.sitesWithData)} />
              <Field label="All-time volume" value={fmtVolume(stats.overview.allTimeVolume)} />
              <Field label="All-time revenue" value={fmtMoney(stats.overview.allTimeRevenue)} />
              <Field label="Last recon run"  value={stats.overview.lastReconRun ? fmtDateTime(stats.overview.lastReconRun) : '—'} small />
            </div>
          )}

          {inner === 'recent' && (
            <table className="w-full">
              <thead><tr className="bg-gray-50">
                <Th>Date</Th><Th right>Sites</Th><Th right>Volume (L)</Th><Th right>Revenue</Th>
              </tr></thead>
              <tbody>
                {stats.recentSales.map(r => (
                  <tr key={r.date} className="hover:bg-gray-50">
                    <Td>{r.date}</Td>
                    <Td right>{fmt(r.sites)}</Td>
                    <Td right mono>{fmt(Math.round(r.volume))}</Td>
                    <Td right>{fmtMoney(r.revenue)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {inner === 'budget' && (
            <BudgetPivot data={budgetMatrix} />
          )}
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Sub-tab 3: Schema Reference
// ──────────────────────────────────────────────────────────────

const SCHEMA: { table: string; sheet: string; sheetTone: string; rows: string; purpose: string }[] = [
  { table: 'sites',              sheet: 'NAME INDEX',    sheetTone: 'blue',  rows: '77',      purpose: 'Master site list — all datasets join here via site_code' },
  { table: 'territories',        sheet: 'Seeded',        sheetTone: 'gray',  rows: '4',       purpose: 'Territory managers: Brendon, Tafara, Saliya, Tendai' },
  { table: 'sales',              sheet: 'STATUS REPORT', sheetTone: 'green', rows: '50K+',    purpose: 'Daily fuel sales — PRIMARY source of truth for all KPIs' },
  { table: 'volume_budget',      sheet: 'VOLUME BUDGET', sheetTone: 'blue',  rows: '900+',    purpose: 'Monthly budget & stretch targets per site, MOSO classification' },
  { table: 'petrotrade_sales',   sheet: 'PETROTRADE',    sheetTone: 'blue',  rows: '1K+',     purpose: 'Partner coupon volumes at fixed $0.05/L margin' },
  { table: 'site_margins',       sheet: 'MARGIN',        sheetTone: 'amber', rows: '900+',    purpose: 'Monthly $/litre net margin per site (same shape as VOLUME BUDGET)' },
  { table: 'reconciliation_log', sheet: 'Auto-built',    sheetTone: 'amber', rows: 'Dynamic', purpose: 'Control gap: status vs invoiced — flags >2% variance automatically' },
  { table: 'reports',            sheet: 'App',           sheetTone: 'gray',  rows: 'Dynamic', purpose: 'PDF report metadata and generation history' },
  { table: 'report_comments',    sheet: 'App',           sheetTone: 'gray',  rows: 'Dynamic', purpose: 'Analyst comments attached to reports, exported to PDF' },
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

function BigStat({ label, value, sub, color, tone }: {
  label: string; value: string; sub?: string; color: string; tone?: 'red';
}) {
  const bg = tone === 'red' ? 'bg-red-50' : 'bg-gray-50';
  return (
    <div className={`${bg} rounded-lg px-3 py-2.5`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-xl font-bold leading-tight" style={{ color }}>
        {value}
        {sub && <span className="text-[11px] font-normal text-gray-400 ml-1">{sub}</span>}
      </p>
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

function Field({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">{label}</p>
      <p className={`font-semibold text-gray-900 ${small ? 'text-xs' : 'text-base'}`}>{value}</p>
    </div>
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`text-[10px] font-semibold text-gray-500 px-2.5 py-1.5 border-b border-gray-200 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);
const Td = ({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) => (
  <td className={`text-[11px] px-2.5 py-1.5 border-b border-gray-100 ${right ? 'text-right' : ''} ${mono ? 'font-mono tabular-nums' : ''}`}>{children}</td>
);

// ──────────────────────────────────────────────────────────────
// BudgetPivot — editable. Months as rows, sites as columns, two
// inputs per cell (Budget / Stretch). Tab to navigate, blur to save.
// ──────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function BudgetPivot({ data }: { data: BudgetMatrix | null }) {
  // Local mutable copy of the matrix so edits stay between renders
  const [local, setLocal] = useState<BudgetMatrix | null>(data);
  const [save, setSave]   = useState<Record<string, SaveState>>({});
  const [errMsg, setErr]  = useState<string>('');

  useEffect(() => { setLocal(data); }, [data]);

  if (!local || local.sites.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No budget data</p>;
  }

  const cellKey = (month: string, site: string, kind: 'b' | 's') => `${month}|${site}|${kind}`;

  const updateCell = (rowIdx: number, colIdx: number, kind: 'b' | 's', val: number | null) => {
    setLocal(prev => {
      if (!prev) return prev;
      const next = { ...prev, matrix: prev.matrix.map(r => ({ ...r, cells: [...r.cells] })) };
      const existing = next.matrix[rowIdx].cells[colIdx];
      next.matrix[rowIdx].cells[colIdx] = {
        b: existing?.b ?? 0,
        s: existing?.s ?? 0,
        [kind]: val ?? 0,
      } as any;
      return next;
    });
  };

  const persist = async (
    siteCode: string, month: string,
    budgetVolume: number | null, stretchVolume: number | null,
    keys: string[],
  ) => {
    keys.forEach(k => setSave(s => ({ ...s, [k]: 'saving' })));
    try {
      const res = await fetch('/api/budget-matrix', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteCode, month, budgetVolume, stretchVolume }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      keys.forEach(k => setSave(s => ({ ...s, [k]: 'saved' })));
      setTimeout(() => {
        keys.forEach(k => setSave(s => {
          if (s[k] !== 'saved') return s;
          const c = { ...s }; delete c[k]; return c;
        }));
      }, 1500);
    } catch (e: any) {
      keys.forEach(k => setSave(s => ({ ...s, [k]: 'error' })));
      setErr(e.message || 'Save failed');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <p>Click any cell to edit. Tab to next field. Changes save automatically on blur.</p>
        {errMsg && <p className="text-red-600 font-medium">{errMsg}</p>}
      </div>

      <div className="overflow-auto border border-gray-200 rounded-lg max-h-[70vh]">
        <table className="text-xs border-collapse">
          <thead>
            <tr className="bg-[#1e3a5f] text-white sticky top-0 z-20">
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold sticky left-0 bg-[#1e3a5f] z-30 border-r border-[#162d4a] min-w-[110px]">
                Month
              </th>
              {local.sites.map(s => (
                <th key={s.code} colSpan={2}
                    className="px-3 py-2.5 text-center text-[11px] font-semibold whitespace-nowrap border-l border-[#162d4a] min-w-[180px]"
                    title={s.code}>
                  {s.name}
                </th>
              ))}
            </tr>
            <tr className="bg-[#2d5080] text-white sticky top-[37px] z-20">
              <th className="sticky left-0 bg-[#2d5080] z-30 border-r border-[#162d4a]"></th>
              {local.sites.map(s => (
                <Fragment key={s.code}>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium border-l border-[#162d4a]">Budget</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-medium">Stretch</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {local.matrix.map((row, rIdx) => (
              <tr key={row.month} className="hover:bg-blue-50/40">
                <td className="px-3 py-2 font-semibold text-gray-800 sticky left-0 bg-white z-10 border-r border-gray-200 whitespace-nowrap">
                  {fmtPeriod(row.month)}
                </td>
                {local.sites.map((site, cIdx) => {
                  const cell  = row.cells[cIdx];
                  const bKey  = cellKey(row.month, site.code, 'b');
                  const sKey  = cellKey(row.month, site.code, 's');
                  return (
                    <Fragment key={site.code}>
                      <CellInput
                        value={cell?.b ?? null}
                        state={save[bKey]}
                        onCommit={(v) => {
                          updateCell(rIdx, cIdx, 'b', v);
                          const newCell = local.matrix[rIdx].cells[cIdx];
                          persist(site.code, row.month, v, newCell?.s ?? null, [bKey]);
                        }}
                        leftBorder
                      />
                      <CellInput
                        value={cell?.s ?? null}
                        state={save[sKey]}
                        onCommit={(v) => {
                          updateCell(rIdx, cIdx, 's', v);
                          const newCell = local.matrix[rIdx].cells[cIdx];
                          persist(site.code, row.month, newCell?.b ?? null, v, [sKey]);
                        }}
                      />
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellInput({
  value, state, onCommit, leftBorder,
}: {
  value: number | null;
  state?: SaveState;
  onCommit: (v: number | null) => void;
  leftBorder?: boolean;
}) {
  const [draft, setDraft] = useState<string>(value == null ? '' : String(Math.round(value)));
  useEffect(() => { setDraft(value == null ? '' : String(Math.round(value))); }, [value]);

  const tone =
    state === 'saving' ? 'bg-amber-50' :
    state === 'saved'  ? 'bg-emerald-50' :
    state === 'error'  ? 'bg-red-50'    : '';

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '' && value == null) return;
    if (trimmed === String(Math.round(value ?? 0))) return;
    const num = trimmed === '' ? null : Number(trimmed.replace(/,/g, ''));
    if (num != null && (!Number.isFinite(num) || num < 0)) {
      setDraft(value == null ? '' : String(Math.round(value)));
      return;
    }
    onCommit(num);
  };

  return (
    <td className={`p-0 ${leftBorder ? 'border-l border-gray-100' : ''}`}>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={`w-full px-2 py-1.5 text-right font-mono tabular-nums text-[11px] text-gray-800
                    bg-transparent focus:bg-yellow-50 focus:outline-none focus:ring-1 focus:ring-blue-300
                    ${tone}`}
        placeholder="—"
      />
    </td>
  );
}
