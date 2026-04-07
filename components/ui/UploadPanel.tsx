// components/ui/UploadPanel.tsx
'use client';

import { useState, useRef } from 'react';

interface RowCounts { [sheet: string]: number; }
interface Props { onSuccess: () => void; }

export default function UploadPanel({ onSuccess }: Props) {
  const [file, setFile]     = useState<File | null>(null);
  const [period, setPeriod] = useState('');
  const [status, setStatus]       = useState<'idle'|'uploading'|'success'|'error'>('idle');
  const [log, setLog]             = useState('');
  const [rowCounts, setRowCounts] = useState<RowCounts | null>(null);
  const [duration, setDuration]   = useState<number | null>(null);
  const [dragging, setDragging]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) setFile(f);
    else alert('Please upload an Excel file (.xlsx)');
  };

  const handleSubmit = async () => {
    if (!file) return;
    setStatus('uploading');
    setLog('');
    const fd = new FormData();
    fd.append('file', file);
    if (period) fd.append('period', period + '-01');

    try {
      const res = await fetch('/api/ingest', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        setStatus('success');
        setLog(data.log || '');
        setRowCounts(data.rowCounts || null);
        setDuration(data.durationMs || null);
        onSuccess();
      } else {
        setStatus('error');
        setLog(data.error || data.log || 'Unknown error');
      }
    } catch (e: any) {
      setStatus('error');
      setLog(e.message);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">📤 Upload Excel Data</h3>
      <p className="text-xs text-gray-400 mb-4">
        Upload the daily Retail Dashboard Excel file to refresh all metrics.
        All 5 sheets (Name Index, Status Report, Petrotrade, Margin, Volume Budget) will be processed.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition mb-4
          ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}
      >
        <div className="text-4xl mb-2">📊</div>
        {file ? (
          <>
            <p className="text-sm font-medium text-gray-700">{file.name}</p>
            <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(0)} KB</p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500">Drop Excel file here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx files only, max 50MB</p>
          </>
        )}
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      {/* Period override */}
      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs text-gray-500 whitespace-nowrap">Period override (optional):</label>
        <input
          type="month" value={period} onChange={e => setPeriod(e.target.value)}
          placeholder="YYYY-MM"
          className="border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <span className="text-xs text-gray-400">Leave blank to use current month</span>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!file || status === 'uploading'}
        className="w-full py-2.5 bg-[#1e3a5f] hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400
          text-white text-sm font-semibold rounded-lg transition"
      >
        {status === 'uploading' ? '⏳ Processing…' : '⬆ Ingest Data'}
      </button>

      {status === 'success' && (
        <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
          <p className="text-xs font-semibold text-emerald-700">
            Ingestion successful! Dashboard refreshed.
            {duration && <span className="font-normal text-emerald-600 ml-1">({(duration/1000).toFixed(1)}s)</span>}
          </p>
          {rowCounts && Object.keys(rowCounts).length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {Object.entries(rowCounts).map(([sheet, count]) => (
                <div key={sheet} className="flex justify-between text-xs">
                  <span className="text-emerald-600 capitalize">{sheet.replace(/_/g,' ')}</span>
                  <span className="font-mono font-semibold text-emerald-800">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {status === 'error' && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-semibold text-red-700 mb-1">❌ Ingestion failed</p>
          <pre className="text-xs text-red-500 whitespace-pre-wrap overflow-auto max-h-40">{log}</pre>
        </div>
      )}
      {status === 'success' && log && (
        <details className="mt-2">
          <summary className="text-xs text-gray-400 cursor-pointer">View ingestion log</summary>
          <pre className="text-xs text-gray-400 bg-gray-50 p-2 rounded mt-1 overflow-auto max-h-60">{log}</pre>
        </details>
      )}
    </div>
  );
}
