'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RMFilters } from './RMFilterBar';
import InvoiceDrawer, { InvoiceFilters } from '@/components/maintenance/InvoiceDrawer';

// Reliable PDF-capturable inline note cell. <input>/<textarea> values
// don't always render in html2canvas; a contentEditable <div> writes
// the text as plain DOM so the PDF picks it up. Width matches the
// 200px column; long text wraps to multiple lines, growing row height.
function NoteCell({
  initial, onCommit, placeholder,
}: {
  initial: string;
  onCommit: (v: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerText !== initial) {
      ref.current.innerText = initial;
    }
    // Mount-only — don't re-sync on every state change or the cursor jumps.
    // The wrapper passes key={`${dateFrom}-${dateTo}-${siteCode}`} so a
    // window-change forces a fresh mount with the new value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={e => onCommit(e.currentTarget.innerText.trim())}
      data-placeholder={placeholder}
      className="rm-note-cell w-full text-[11px] border border-gray-200 rounded px-1.5 py-1 whitespace-pre-wrap break-words leading-snug focus:outline-none focus:border-[#1e3a5f]"
      style={{ minHeight: 24 }}
    />
  );
}

interface Cell {
  cost: number;
  perLitre: number | null;
  zScore:   number | null;
  ticketCount:  number;
  invoiceCount: number;
  anomaly: 0 | 1 | 2;
}

interface HeatmapResponse {
  sites:      { siteCode: string; siteName: string; total: number; volume: number }[];
  categories: { slug: string; name: string; total: number }[];
  matrix:     Record<string, Record<string, Cell>>;
}

type Metric = 'cost' | 'perLitre' | 'zScore';

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPerLitre(n: number | null): string {
  if (n === null) return '—';
  const cents = n * 100;
  if (Math.abs(cents) >= 100) return `$${n.toFixed(2)}/L`;
  if (Math.abs(cents) >= 1)   return `${cents.toFixed(1)}¢/L`;
  return `${cents.toFixed(2)}¢/L`;
}

// 4-step blue ramp for $ YTD mode (by quartile)
function costColor(value: number, max: number): { bg: string; text: string } {
  if (max === 0 || value === 0) return { bg: '#f3f4f6', text: '#9ca3af' };
  const ratio = value / max;
  if (ratio < 0.25) return { bg: '#dbeafe', text: '#1e3a5f' };
  if (ratio < 0.50) return { bg: '#93c5fd', text: '#1e3a5f' };
  if (ratio < 0.75) return { bg: '#3b82f6', text: '#ffffff' };
  return { bg: '#1e3a5f', text: '#ffffff' };
}

// Diverging red/blue ramp for z-score (centered at 0)
function zScoreColor(z: number | null): { bg: string; text: string } {
  if (z === null) return { bg: '#f3f4f6', text: '#9ca3af' };
  if (z >  2)  return { bg: '#b91c1c', text: '#ffffff' };
  if (z >  1)  return { bg: '#fca5a5', text: '#7f1d1d' };
  if (z > -1)  return { bg: '#f3f4f6', text: '#374151' };
  if (z > -2)  return { bg: '#bfdbfe', text: '#1e3a5f' };
  return { bg: '#1e3a5f', text: '#ffffff' };
}

interface Props {
  filters: RMFilters;
  /** 'commented' shows the per-site Note column (default).
   *  'plain' hides notes and shows all sites uncapped — used for the
   *  YTD all-sites view. */
  mode?: 'commented' | 'plain';
  /** Default row cap before "Show all" is clicked (commented mode only). */
  rowCap?: number;
  /** Section title in the card header. */
  title?: string;
}

export default function CostHeatmap({
  filters,
  mode = 'commented',
  rowCap = 12,
  title = 'Site × Category Cost',
}: Props) {
  const showNotes  = mode === 'commented';
  const isAllSites = mode === 'plain';
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<Metric>('cost');
  const [showAll, setShowAll] = useState(false);
  const [drawerFilters, setDrawerFilters] = useState<InvoiceFilters | null>(null);
  // Sort key: 'total' = site total cost desc (default).
  // Otherwise a category slug — sites ordered by their spend in that category desc.
  const [sortBy, setSortBy] = useState<string>('total');
  // Per-site free-text notes — persisted to the rm_site_notes DB table.
  // Shows in the column just before Total, and is captured in the PDF
  // as static text.
  const [siteNotes, setSiteNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === 'undefined' || !data) return;
    let cancelled = false;
    (async () => {
      // 1. Load from API
      const res = await fetch(`/api/rm/notes?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}`);
      const json = await res.json();
      if (cancelled) return;
      const apiMap: Record<string, string> = {};
      for (const r of json?.data || []) apiMap[r.siteCode] = r.note;

      // 2. One-shot migration: any local notes the API doesn't have
      const merged = { ...apiMap };
      const toMigrate: Array<{ siteCode: string; note: string }> = [];
      for (const s of data.sites) {
        const local = localStorage.getItem(`rm-site-note-${filters.dateFrom}-${filters.dateTo}-${s.siteCode}`);
        if (local && !apiMap[s.siteCode]) {
          merged[s.siteCode] = local;
          toMigrate.push({ siteCode: s.siteCode, note: local });
        }
      }
      setSiteNotes(merged);

      // 3. Fire-and-forget migration POSTs
      for (const m of toMigrate) {
        fetch('/api/rm/notes', {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({
            siteCode: m.siteCode,
            dateFrom: filters.dateFrom,
            dateTo:   filters.dateTo,
            note:     m.note,
          }),
        }).catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, [data, filters.dateFrom, filters.dateTo]);

  function updateSiteNote(siteCode: string, value: string) {
    setSiteNotes(prev => ({ ...prev, [siteCode]: value }));
    // Keep localStorage write as one-release fallback.
    if (typeof window !== 'undefined') {
      const k = `rm-site-note-${filters.dateFrom}-${filters.dateTo}-${siteCode}`;
      if (value) localStorage.setItem(k, value);
      else       localStorage.removeItem(k);
    }
    // Persist to API (fire-and-forget — state is already updated optimistically).
    fetch('/api/rm/notes', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({
        siteCode,
        dateFrom: filters.dateFrom,
        dateTo:   filters.dateTo,
        note:     value,
      }),
    }).catch(() => {});
  }

  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
      category:  filters.category,
    }).toString();
    setLoading(true);
    fetch(`/api/rm/cost-heatmap?${qs}`)
      .then(r => r.json())
      .then(j => setData(j.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const sortedSites = useMemo(() => {
    if (!data) return [];
    if (sortBy === 'total') return data.sites;
    const slug = sortBy;
    // Sort sites by their spend in the chosen category desc; sites with no
    // cell for that category fall to the bottom.
    return [...data.sites].sort((a, b) => {
      const aCost = data.matrix[a.siteCode]?.[slug]?.cost ?? -1;
      const bCost = data.matrix[b.siteCode]?.[slug]?.cost ?? -1;
      return bCost - aCost;
    });
  }, [data, sortBy]);

  const visibleSites = useMemo(() => {
    if (isAllSites) return sortedSites;            // YTD full list
    const cap = showAll ? sortedSites.length : rowCap;
    return sortedSites.slice(0, cap);
  }, [sortedSites, showAll, rowCap, isAllSites]);

  // Show all categories — table scrolls horizontally on narrow viewports
  const displayCats = data?.categories ?? [];

  const maxCost = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const s of data.sites) {
      for (const c of data.categories) {
        const cell = data.matrix[s.siteCode]?.[c.slug];
        if (cell && cell.cost > m) m = cell.cost;
      }
    }
    return m;
  }, [data]);

  function getCellValue(cell: Cell | undefined): { display: string; color: { bg: string; text: string } } {
    if (!cell) return { display: '—', color: { bg: '#f3f4f6', text: '#9ca3af' } };
    if (metric === 'cost')      return { display: fmtCurrency(cell.cost),      color: costColor(cell.cost, maxCost) };
    if (metric === 'perLitre')  return { display: fmtPerLitre(cell.perLitre),  color: cell.perLitre !== null ? costColor(cell.perLitre, 0.1) : { bg: '#f3f4f6', text: '#9ca3af' } };
    return { display: cell.zScore !== null ? cell.zScore.toFixed(1) : '—',     color: zScoreColor(cell.zScore) };
  }

  function onCellClick(siteCode: string, categorySlug: string) {
    setDrawerFilters({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      siteCode,
      territory: filters.territory,
      category:  categorySlug,
    });
  }

  const metricToggle = (m: Metric, label: string) => (
    <button onClick={() => setMetric(m)}
            className={`text-[10px] px-2 py-0.5 rounded ${metric === m ? 'bg-[#1e3a5f] text-white' : 'border border-gray-300 text-gray-600'}`}>
      {label}
    </button>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 mb-[10px]">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div className="text-[11px] font-medium text-gray-800">{title}</div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
            Sort
            <select value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                    className="text-[11px] border border-gray-300 rounded px-1.5 py-0.5 font-normal normal-case tracking-normal">
              <option value="total">Site total cost</option>
              {data?.categories.map(c => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-0.5">
            {metricToggle('cost',     '$ YTD')}
            {metricToggle('perLitre', '¢/L')}
            {metricToggle('zScore',   'z-score')}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">Loading…</div>
      ) : !data || data.sites.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">No data in window</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Site</th>
                {displayCats.map(c => (
                  <th key={c.slug} className="text-right px-1.5 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap" title={c.name}>
                    {c.name.split(/\s+/)[0]}
                  </th>
                ))}
                {showNotes && (
                  <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold w-[220px]">Note</th>
                )}
                <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {visibleSites.map(s => (
                <tr key={s.siteCode} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                  <td className="px-2 py-1 text-gray-900 whitespace-nowrap">
                    <span className="font-mono text-[10px] text-gray-500 mr-1.5">{s.siteCode}</span>
                    {s.siteName}
                  </td>
                  {displayCats.map(c => {
                    const cell = data.matrix[s.siteCode]?.[c.slug];
                    const { display, color } = getCellValue(cell);
                    const marker = cell?.anomaly === 2 ? ' ⚠⚠' : cell?.anomaly === 1 ? ' ⚠' : '';
                    return (
                      <td key={c.slug} className="px-0.5 py-0.5">
                        {cell ? (
                          <button
                            onClick={() => onCellClick(s.siteCode, c.slug)}
                            className="w-full px-1.5 py-1 text-right text-[11px] rounded hover:opacity-80 transition-opacity"
                            style={{ background: color.bg, color: color.text }}
                            title={`${s.siteName} · ${c.name}: ${display}${marker}\nInvoices: ${cell.invoiceCount} · Tickets: ${cell.ticketCount}${cell.zScore !== null ? `\nz = ${cell.zScore}σ` : ''}`}>
                            {display}{marker}
                          </button>
                        ) : (
                          <div className="w-full px-1.5 py-1 text-right text-[11px] text-gray-300">—</div>
                        )}
                      </td>
                    );
                  })}
                  {showNotes && (
                    <td className="px-1.5 py-0.5 align-top w-[220px]">
                      <NoteCell
                        key={`${filters.dateFrom}-${filters.dateTo}-${s.siteCode}`}
                        initial={siteNotes[s.siteCode] || ''}
                        onCommit={v => updateSiteNote(s.siteCode, v)}
                        placeholder="add note…"
                      />
                    </td>
                  )}
                  <td className="px-2 py-1 text-right font-medium text-gray-900 whitespace-nowrap">
                    {fmtCurrency(s.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-600 font-semibold">Total</td>
                {displayCats.map(c => (
                  <td key={c.slug} className="px-1.5 py-1.5 text-right text-[11px] font-semibold text-gray-900 whitespace-nowrap" title={`${c.name}: ${fmtCurrency(c.total)}`}>
                    {fmtCurrency(c.total)}
                  </td>
                ))}
                {showNotes && <td className="px-2 py-1.5 w-[220px]"></td>}
                <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-gray-900 whitespace-nowrap">
                  {fmtCurrency(data.categories.reduce((a, b) => a + b.total, 0))}
                </td>
              </tr>
            </tfoot>
          </table>

          {!isAllSites && !showAll && data.sites.length > rowCap && (
            <div className="text-[10px] text-gray-500 mt-2 flex items-center justify-between">
              <span>{data.sites.length - rowCap} more sites · click any cell for invoice detail</span>
              <button onClick={() => setShowAll(true)} className="text-[#1e3a5f] hover:underline font-medium">
                Show all
              </button>
            </div>
          )}
          {!isAllSites && showAll && (
            <div className="text-[10px] text-gray-500 mt-2">
              <button onClick={() => setShowAll(false)} className="text-[#1e3a5f] hover:underline font-medium">
                Collapse to top {rowCap}
              </button>
            </div>
          )}
        </div>
      )}

      {drawerFilters && (
        <InvoiceDrawer
          open={drawerFilters !== null}
          filters={drawerFilters}
          onClose={() => setDrawerFilters(null)}
          onReclassified={() => {}}
        />
      )}
    </div>
  );
}
