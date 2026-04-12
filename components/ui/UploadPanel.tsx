'use client';

import { useState, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface Check {
  id:     string;
  sheet:  string | null;
  title:  string;
  status: 'pass' | 'warning' | 'error';
  detail: string;
}

interface ValidationResult {
  ok:            boolean;
  canIngest:     boolean;
  checks:        Check[];
  summary:       { errors: number; warnings: number; passed: number };
  dateRange:     { from: string; to: string } | null;
  sheetRowCounts: Record<string, number>;
  fileName:      string;
}

interface RowCounts { [sheet: string]: number; }

interface PreflightSummary {
  dateFrom: string | null;
  dateTo:   string | null;
  rowsInFile: number;
  rowsExisting: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  sitesWithChanges: string[];
  sampleChanges: {
    siteCode: string; date: string; field: string;
    oldValue: string | null; newValue: string | null;
  }[];
}

interface CompactSheet {
  columns: string[];
  data: any[][];
}

// ── Client-side Excel parsing ─────────────────────────────────────────────

async function parseExcelClientSide(file: File): Promise<{
  sheetNames: string[];
  compact: Record<string, CompactSheet>;
}> {
  const xlsxModule = await import('xlsx');
  const XLSX = xlsxModule.default ?? xlsxModule;
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array', cellDates: true });
  const compact: Record<string, CompactSheet> = {};

  for (const name of wb.SheetNames) {
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
    if (rows.length === 0) {
      compact[name] = { columns: [], data: [] };
    } else {
      const columns = Object.keys(rows[0]);
      compact[name] = {
        columns,
        data: rows.map(row => columns.map(col => {
          const v = row[col];
          if (v instanceof Date) return v.toISOString();
          return v;
        })),
      };
    }
  }

  return { sheetNames: wb.SheetNames, compact };
}

// Helper to POST JSON and safely parse response
async function postJSON(url: string, body: any): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok && data.error) throw new Error(data.error);
  return { ok: res.ok, data };
}

// ── Icons ──────────────────────────────────────────────────────────────────

const IconPass = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0">
    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
  </svg>
);
const IconWarn = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-amber-500 flex-shrink-0">
    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 8a1 1 0 110-2 1 1 0 010 2z"/>
  </svg>
);
const IconError = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-red-500 flex-shrink-0">
    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0V5zm.75 7.5a1 1 0 110-2 1 1 0 010 2z"/>
  </svg>
);

// ── Sheet key ↔ name mapping ──────────────────────────────────────────────

const SHEET_KEY_TO_NAME: Record<string, string> = {
  name_index:    'NAME INDEX',
  status_report: 'STATUS REPORT',
  petrotrade:    'PETROTRADE',
  margin:        'MARGIN',
  volume_budget: 'VOLUME BUDGET',
};

// ── Component ──────────────────────────────────────────────────────────────

interface Props { onSuccess: () => void; }

type Phase = 'idle' | 'validating' | 'validated' | 'preflighting' | 'preflighted' | 'ingesting' | 'done' | 'error';

export default function UploadPanel({ onSuccess }: Props) {
  const [file, setFile]           = useState<File | null>(null);
  const [parsed, setParsed]       = useState<{ sheetNames: string[]; compact: Record<string, CompactSheet> } | null>(null);
  const [parsing, setParsing]     = useState(false);
  const [period, setPeriod]       = useState('');
  const [sheets, setSheets]       = useState<Record<string, boolean>>({
    name_index:    true,
    status_report: true,
    petrotrade:    true,
    margin:        false,
    volume_budget: false,
  });
  const [phase, setPhase]         = useState<Phase>('idle');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [preflight, setPreflight]   = useState<PreflightSummary | null>(null);
  const [rowCounts, setRowCounts] = useState<RowCounts | null>(null);
  const [duration, setDuration]   = useState<number | null>(null);
  const [ingestLog, setIngestLog] = useState('');
  const [errorMsg, setErrorMsg]   = useState('');
  const [dragging, setDragging]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null); setParsed(null); setParsing(false); setPeriod(''); setPhase('idle');
    setValidation(null); setPreflight(null); setRowCounts(null); setDuration(null);
    setIngestLog(''); setErrorMsg('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = (f: File) => {
    if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) {
      setFile(f); setParsed(null); setParsing(true); setPhase('idle');
      setValidation(null); setRowCounts(null); setErrorMsg('');

      parseExcelClientSide(f).then(result => {
        setParsed(result);
        setParsing(false);
      }).catch(err => {
        setParsing(false);
        setErrorMsg('Failed to read Excel file: ' + (err.message || err));
        setPhase('error');
      });
    }
  };

  // ── Phase 1: Validate ─────────────────────────────────────

  const handleValidate = async () => {
    if (!file || !parsed) return;
    setPhase('validating');
    setValidation(null);
    setErrorMsg('');

    try {
      const { data } = await postJSON('/api/validate', {
        fileName: file.name,
        sheetNames: parsed.sheetNames,
        sheets: parsed.compact,
      });
      setValidation({ checks: [], summary: { errors: 0, warnings: 0, passed: 0 }, sheetRowCounts: {}, dateRange: null, fileName: '', ok: false, canIngest: false, ...data });
      setPhase('validated');
    } catch (e: any) {
      setErrorMsg(e.message || 'Validation failed');
      setPhase('error');
    }
  };

  // ── Phase 1.5: Preflight (diff check) ─────────────────────

  const handlePreflight = async () => {
    if (!file || !parsed) return;
    setPhase('preflighting');
    setPreflight(null);
    setErrorMsg('');

    try {
      // Only send STATUS REPORT for preflight (that's all it uses)
      const statusSheet = parsed.compact['STATUS REPORT'];
      const { data } = await postJSON('/api/ingest/preflight', {
        sheets: { 'STATUS REPORT': statusSheet },
      });
      setPreflight(data);
      if ((data.rowsExisting ?? 0) === 0) {
        await handleIngest();
      } else {
        setPhase('preflighted');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Preflight failed');
      setPhase('error');
    }
  };

  // ── Phase 2: Ingest ───────────────────────────────────────

  const handleIngest = async () => {
    if (!file || !parsed) return;
    setPhase('ingesting');
    const start = Date.now();

    const selectedSheets = Object.entries(sheets).filter(([, v]) => v).map(([k]) => k);
    const periodStr = period ? period + '-01' : '';

    // Build compact sheets for only the selected sheets
    const selectedCompact: Record<string, CompactSheet> = {};
    for (const key of selectedSheets) {
      const sheetName = SHEET_KEY_TO_NAME[key];
      if (parsed.compact[sheetName]) {
        selectedCompact[sheetName] = parsed.compact[sheetName];
      }
    }

    try {
      const { data } = await postJSON('/api/ingest', {
        fileName: file.name,
        fileSize: file.size,
        period: periodStr,
        selectedSheets: selectedSheets.join(','),
        sheets: selectedCompact,
      });
      setDuration(Date.now() - start);

      if (data.success) {
        setRowCounts(data.rowCounts || null);
        setIngestLog(data.log || '');
        setPhase('done');
        onSuccess();
      } else {
        setErrorMsg(data.error || 'Ingestion failed');
        setIngestLog(data.log || '');
        setPhase('error');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
      setPhase('error');
    }
  };

  // ── Helpers ───────────────────────────────────────────────

  const checkIcon = (s: Check['status']) =>
    s === 'pass' ? <IconPass /> : s === 'warning' ? <IconWarn /> : <IconError />;

  const checkBg = (s: Check['status']) =>
    s === 'pass'    ? '' :
    s === 'warning' ? 'bg-amber-50 border-l-2 border-amber-300' :
                      'bg-red-50 border-l-2 border-red-400';

  // Group checks by sheet for display
  const grouped = (validation?.checks ?? []).reduce((acc, c) => {
    const key = c.sheet || 'File';
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {} as Record<string, Check[]>);

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl p-5 space-y-4">

      <div>
        <h3 className="text-sm font-semibold text-gray-800">Upload Excel Data</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Upload your Retail Dashboard Excel file directly. The system validates
          structure before writing any data.
        </p>
      </div>

      {/* ── Drop zone ────────────────────────────────────── */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => phase === 'idle' && !parsing && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition
          ${phase !== 'idle' || parsing ? 'cursor-default' : 'cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30'}
          ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'}`}
      >
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                 className="w-8 h-8 text-indigo-500 flex-shrink-0">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <div className="text-left">
              <p className="text-sm font-medium text-gray-800">{file.name}</p>
              <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB</p>
            </div>
            {phase === 'idle' && !parsing && (
              <button onClick={e => { e.stopPropagation(); reset(); }}
                      className="ml-auto text-xs text-gray-400 hover:text-red-500 transition">
                Remove
              </button>
            )}
          </div>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                 className="w-8 h-8 text-gray-300 mx-auto mb-2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p className="text-sm text-gray-500">Drop Excel file here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx only · max 50MB</p>
          </>
        )}
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
               onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      {/* ── Reading spinner ──────────────────────────────── */}
      {parsing && (
        <div className="flex items-center justify-center gap-2 h-9 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Reading Excel file…
        </div>
      )}

      {/* ── Sheets to process ─────────────────────────────── */}
      {file && parsed && phase === 'idle' && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Sheets to process</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSheets({ name_index: true, status_report: true, petrotrade: true, margin: true, volume_budget: true })}
                className="text-[10px] text-blue-600 hover:text-blue-800">Select all</button>
              <span className="text-gray-300 text-[10px]">|</span>
              <button
                type="button"
                onClick={() => setSheets({ name_index: false, status_report: true, petrotrade: true, margin: false, volume_budget: false })}
                className="text-[10px] text-blue-600 hover:text-blue-800">Daily only</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ['name_index',    'Name Index',    'Master site reference'],
              ['status_report', 'Status Report', 'Daily sales — primary truth'],
              ['petrotrade',    'Petrotrade',    'Partner coupon volumes'],
              ['margin',        'Margin',        'Dynamics invoiced data'],
              ['volume_budget', 'Volume Budget', 'Monthly targets & MOSO'],
            ] as [string, string, string][]).map(([key, label, sub]) => {
              const on = sheets[key];
              return (
                <label key={key}
                  className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer transition ${
                    on ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'
                  }`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={e => setSheets(s => ({ ...s, [key]: e.target.checked }))}
                    className="w-3 h-3 mt-0.5 flex-shrink-0 accent-[#1e3a5f]"
                  />
                  <div className="min-w-0">
                    <p className={`text-[11px] font-semibold leading-tight ${on ? 'text-blue-800' : 'text-gray-600'}`}>{label}</p>
                    <p className="text-[9px] text-gray-400 leading-tight">{sub}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Period override ───────────────────────────────── */}
      {file && parsed && phase !== 'done' && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 whitespace-nowrap">Period override:</label>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                 className="filter-input flex-1" />
          <span className="text-xs text-gray-400">Leave blank = current month</span>
        </div>
      )}

      {/* ── Action buttons ────────────────────────────────── */}
      {file && parsed && phase === 'idle' && (
        <button onClick={handleValidate}
                className="w-full h-9 bg-[#1e3a5f] hover:bg-[#162d4a] text-white
                           text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M9 2a1 1 0 000 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L13 5.414V8a1 1 0 102 0V3a1 1 0 00-1-1H9z"/>
            <path d="M3 5a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2v-3a1 1 0 10-2 0v3H3V7h3a1 1 0 000-2H3z"/>
          </svg>
          Validate File
        </button>
      )}

      {phase === 'validating' && (
        <div className="flex items-center justify-center gap-2 h-9 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Checking file structure…
        </div>
      )}

      {phase === 'preflighting' && (
        <div className="flex items-center justify-center gap-2 h-9 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Comparing file against existing data…
        </div>
      )}

      {phase === 'preflighted' && preflight && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-amber-800 flex items-center gap-2 mb-2">
              <IconWarn />
              {preflight.changedRows.toLocaleString()} row{preflight.changedRows === 1 ? '' : 's'} will be overwritten. Proceed?
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-amber-900">
              <div className="flex justify-between"><span>Date range</span>
                <span className="font-mono font-semibold">{preflight.dateFrom} → {preflight.dateTo}</span></div>
              <div className="flex justify-between"><span>Rows in file</span>
                <span className="font-mono font-semibold">{preflight.rowsInFile.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Existing rows</span>
                <span className="font-mono font-semibold">{preflight.rowsExisting.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>New rows</span>
                <span className="font-mono font-semibold text-emerald-700">{preflight.newRows.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Changed</span>
                <span className="font-mono font-semibold text-amber-700">{preflight.changedRows.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Unchanged</span>
                <span className="font-mono font-semibold text-gray-600">{preflight.unchangedRows.toLocaleString()}</span></div>
            </div>

            {preflight.sitesWithChanges.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-amber-900 uppercase tracking-wide mb-1">
                  Sites with changes ({preflight.sitesWithChanges.length})
                </p>
                <p className="text-[11px] text-amber-800 break-words">
                  {preflight.sitesWithChanges.slice(0, 30).join(', ')}
                  {preflight.sitesWithChanges.length > 30 && ` … +${preflight.sitesWithChanges.length - 30} more`}
                </p>
              </div>
            )}

            {preflight.sampleChanges.length > 0 && (
              <details className="mt-3">
                <summary className="text-[11px] font-semibold text-amber-900 uppercase tracking-wide cursor-pointer">
                  Sample changes ({preflight.sampleChanges.length})
                </summary>
                <div className="mt-1.5 space-y-1">
                  {preflight.sampleChanges.map((c, i) => (
                    <div key={i} className="text-[11px] font-mono text-amber-900 bg-white/50 px-2 py-1 rounded">
                      <span className="font-semibold">{c.siteCode}</span> · {c.date} · {c.field}: {' '}
                      <span className="text-red-600">{c.oldValue}</span> → <span className="text-emerald-700">{c.newValue}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={reset}
                    className="flex-1 h-9 bg-gray-100 hover:bg-gray-200 text-gray-700
                               text-sm font-semibold rounded-lg transition">
              Cancel
            </button>
            <button onClick={handleIngest}
                    className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white
                               text-sm font-semibold rounded-lg transition">
              Proceed with upload
            </button>
          </div>
        </div>
      )}

      {phase === 'ingesting' && (
        <div className="flex items-center justify-center gap-2 h-9 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Ingesting data — this may take up to 60 seconds…
        </div>
      )}

      {/* ── Validation Report ─────────────────────────────── */}
      {phase === 'validated' && validation && (
        <div className="space-y-3">

          {/* Summary bar */}
          <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg border
            ${validation.canIngest
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-red-50 border-red-200'}`}>
            <div className="flex items-center gap-2">
              {validation.canIngest
                ? <IconPass />
                : <IconError />}
              <span className={`text-sm font-semibold ${validation.canIngest ? 'text-emerald-700' : 'text-red-700'}`}>
                {validation.canIngest ? 'Validation passed — ready to ingest' : 'Validation failed — fix errors before ingesting'}
              </span>
            </div>
            <div className="flex gap-3 text-xs">
              {validation.summary.errors > 0 && (
                <span className="text-red-600 font-semibold">{validation.summary.errors} error{validation.summary.errors > 1 ? 's' : ''}</span>
              )}
              {validation.summary.warnings > 0 && (
                <span className="text-amber-600 font-semibold">{validation.summary.warnings} warning{validation.summary.warnings > 1 ? 's' : ''}</span>
              )}
              <span className="text-emerald-600 font-semibold">{validation.summary.passed} passed</span>
            </div>
          </div>

          {/* Date range & sheet counts */}
          {(validation.dateRange || Object.keys(validation.sheetRowCounts).length > 0) && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 grid grid-cols-2 gap-2">
              {validation.dateRange && (
                <div className="col-span-2">
                  <span className="text-xs text-gray-500">Date range: </span>
                  <span className="text-xs font-semibold text-gray-800">
                    {validation.dateRange.from} → {validation.dateRange.to}
                  </span>
                </div>
              )}
              {Object.entries(validation.sheetRowCounts).map(([sheet, count]) => (
                <div key={sheet} className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">{sheet}</span>
                  <span className="text-xs font-mono font-semibold text-gray-800">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {/* Check list — only show non-pass items by default, all expandable */}
          {grouped && Object.entries(grouped).map(([sheet, sheetChecks]) => {
            const hasIssues = sheetChecks.some(c => c.status !== 'pass');
            if (!hasIssues) return null;
            return (
              <div key={sheet}>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{sheet}</p>
                <div className="space-y-1">
                  {sheetChecks.filter(c => c.status !== 'pass').map((c, i) => (
                    <div key={i} className={`flex gap-2.5 px-3 py-2 rounded ${checkBg(c.status)}`}>
                      {checkIcon(c.status)}
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-700">{c.title}</p>
                        <p className="text-[11px] text-gray-500 break-words">{c.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Check-for-changes button (preflight diff) */}
          {validation.canIngest && (
            <button onClick={handlePreflight}
                    className="w-full h-9 bg-[#1e3a5f] hover:bg-[#162d4a] text-white
                               text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2">
              Check for changes
            </button>
          )}

          {!validation.canIngest && (
            <button onClick={reset}
                    className="w-full h-9 bg-gray-100 hover:bg-gray-200 text-gray-600
                               text-sm font-semibold rounded-lg transition">
              Upload a different file
            </button>
          )}
        </div>
      )}

      {/* ── Success ───────────────────────────────────────── */}
      {phase === 'done' && (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-emerald-700 flex items-center gap-2">
              <IconPass /> Ingestion complete
              {duration && <span className="font-normal text-emerald-600">({(duration/1000).toFixed(1)}s)</span>}
            </p>
            {rowCounts && (
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5">
                {Object.entries(rowCounts).map(([sheet, count]) => (
                  <div key={sheet} className="flex justify-between text-xs">
                    <span className="text-emerald-600 capitalize">{sheet.replace(/_/g,' ')}</span>
                    <span className="font-mono font-semibold text-emerald-800">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={reset}
                  className="w-full h-8 text-xs text-gray-500 hover:text-gray-700 transition">
            Upload another file
          </button>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────── */}
      {phase === 'error' && (
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-xs font-semibold text-red-700 flex items-center gap-2 mb-1">
              <IconError /> Failed
            </p>
            <p className="text-xs text-red-600">{errorMsg}</p>
            {ingestLog && (
              <details className="mt-2">
                <summary className="text-xs text-red-400 cursor-pointer">View log</summary>
                <pre className="text-[10px] text-red-400 mt-1 overflow-auto max-h-40 whitespace-pre-wrap">{ingestLog}</pre>
              </details>
            )}
          </div>
          <button onClick={reset}
                  className="w-full h-8 text-xs text-gray-500 hover:text-gray-700 transition">
            Try again
          </button>
        </div>
      )}

    </div>
  );
}
