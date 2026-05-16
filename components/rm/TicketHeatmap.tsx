// components/rm/TicketHeatmap.tsx
// Site × Category ticket-count heatmap. Sibling of CostHeatmap — same
// quintile-coloring and note-editing patterns but ranks by ticket
// count (default) or matches the cost heatmap's site list. Metric
// toggle for Count / MTTR / SLA; cell click → TicketDrawer.
//
// v1 limitation: MTTR and SLA are not yet exposed per-cell by the
// backend, so those metric toggle modes currently display the ticket
// count value as a placeholder until the backend extension lands.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RMFilters } from './RMFilterBar';
import TicketDrawer, { type TicketFilters } from '@/components/helpdesk/TicketDrawer';
import { shortCategory } from '@/lib/categoryAbbrev';

interface Cell {
  ticketCount:  number;
  invoiceCount: number;
  cost:         number;
  perLitre:     number | null;
  zScore:       number | null;
  anomaly:      0 | 1 | 2;
}

interface HeatmapResponse {
  sites:             { siteCode: string; siteName: string; total: number; volume: number }[];
  categories:        { slug: string; name: string; total: number }[];
  matrix:            Record<string, Record<string, Cell>>;
  statuses?:         string[];
  byStatus?:         Record<string, Record<string, number>>;
  ticketCategories?: { slug: string; name: string; total: number }[];
  ticketMatrix?:     Record<string, Record<string, number>>;
  ticketSites?:      { siteCode: string; siteName: string; total: number }[];
}

type Metric = 'count' | 'mttr' | 'sla';
type Source = 'tickets' | 'cost';
type View   = 'category' | 'status';

// 4–5 char abbreviations for status column headers to keep the table narrow.
const STATUS_ABBREV: Record<string, string> = {
  'Open':                   'OPEN',
  'Pending':                'PEND',
  'Waiting on Customer':    'W-CST',
  'Waiting on Third Party': 'W-3P',
  'In Progress':            'INPRG',
  'Resolved':               'RESV',
  'Closed':                 'CLSD',
  'Unspecified':            '—',
};
function shortStatus(s: string): string {
  return STATUS_ABBREV[s] || s.slice(0, 5).toUpperCase();
}

type ColorClass = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | null;

function cellColor(value: number | null, columnValues: Array<number | null>): ColorClass {
  if (value === null || value === 0) return null;
  const nonNull = columnValues
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => a - b);
  if (nonNull.length === 0) return null;
  if (nonNull.length === 1) return 'c3';
  const q = (p: number) => nonNull[Math.floor((nonNull.length - 1) * p)];
  if (value <= q(0.20)) return 'c1';
  if (value <= q(0.40)) return 'c2';
  if (value <= q(0.60)) return 'c3';
  if (value <= q(0.80)) return 'c4';
  return 'c5';
}

const TIER_BG: Record<NonNullable<ColorClass>, string> = {
  c1: 'bg-green-100',
  c2: 'bg-lime-100',
  c3: 'bg-yellow-100',
  c4: 'bg-orange-200',
  c5: 'bg-red-200',
};

function NoteCell({
  initial,
  onCommit,
  placeholder,
}: {
  initial: string;
  onCommit: (v: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerText !== initial) ref.current.innerText = initial;
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

interface Props {
  filters: RMFilters;
  /** 'commented' shows the per-site Note column and the source toggle (default).
   *  'plain' hides notes + source toggle, shows all sites uncapped — used for
   *  the YTD all-sites view on the helpdesk page and PDF page 6. */
  mode?: 'commented' | 'plain';
  /** Default row cap (commented mode only). Plain mode shows every site. */
  rowCap?: number;
  /** Card header title. */
  title?: string;
}

export default function TicketHeatmap({
  filters,
  mode = 'commented',
  rowCap = 20,
  title = 'Tickets · Site × Category',
}: Props) {
  const showNotes        = mode === 'commented';
  const showSourceToggle = mode === 'commented';
  const isAllSites       = mode === 'plain';

  const [source, setSource] = useState<Source>('tickets');
  const [metric, setMetric] = useState<Metric>('count');
  const [view,   setView]   = useState<View>('category');
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerFilters, setDrawerFilters] = useState<TicketFilters | null>(null);
  const [siteNotes, setSiteNotes] = useState<Record<string, string>>({});

  // Fetch the heatmap from the chosen dimension.
  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
      category:  filters.category,
      dimension: source,
    }).toString();
    setLoading(true);
    fetch(`/api/rm/cost-heatmap?${qs}`)
      .then(r => r.json())
      .then(j => setData(j.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters, source]);

  // Load shared notes once per period.
  useEffect(() => {
    if (typeof window === 'undefined' || !data) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/rm/notes?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}`,
      );
      const json = await res.json();
      if (cancelled) return;
      const apiMap: Record<string, string> = {};
      for (const r of json?.data || []) apiMap[r.siteCode] = r.note;
      setSiteNotes(apiMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [data, filters.dateFrom, filters.dateTo]);

  function updateSiteNote(siteCode: string, value: string) {
    setSiteNotes(prev => ({ ...prev, [siteCode]: value }));
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

  // Ticket-heatmap is fully ticket-driven: site list, category list, and
  // per-cell counts all come from the helpdesk system, independent of
  // invoices. Falls back to the invoice-driven sites/categories when the
  // API hasn't been redeployed with the ticket-* fields.
  const ticketSites      = data?.ticketSites      || data?.sites      || [];
  const ticketCategories = data?.ticketCategories || data?.categories?.map(c => ({ slug: c.slug, name: c.name, total: 0 })) || [];
  const ticketMatrix     = data?.ticketMatrix     || {};

  const visibleSites = useMemo(() => {
    if (!data) return [];
    if (isAllSites) return ticketSites;        // every site with tickets
    return ticketSites.slice(0, rowCap);       // top N
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isAllSites, rowCap, ticketSites]);
  const categories = ticketCategories;

  function ticketCellValue(siteCode: string, slug: string): number | null {
    const v = ticketMatrix[siteCode]?.[slug];
    return v && v > 0 ? v : null;
  }

  function fmtCell(v: number | null): string {
    if (v === null) return '—';
    if (metric === 'count') return v.toString();
    if (metric === 'mttr')  return `${v.toFixed(1)}d`;
    return `${v.toFixed(0)}%`;
  }

  const columnValueArrays = categories.map(c =>
    visibleSites.map(s => ticketCellValue(s.siteCode, c.slug)),
  );

  function onCellClick(siteCode: string, categorySlug: string) {
    setDrawerFilters({
      dateFrom: filters.dateFrom,
      dateTo:   filters.dateTo,
      siteCode,
      category: categorySlug,
    });
  }

  const metricToggle = (m: Metric, label: string) => (
    <button
      key={m}
      onClick={() => setMetric(m)}
      className={`text-[10px] px-2 py-0.5 rounded ${
        metric === m
          ? 'bg-[#ea580c] text-white'
          : 'border border-gray-300 text-gray-600'
      }`}
    >
      {label}
    </button>
  );

  const viewToggle = (v: View, label: string) => (
    <button
      key={v}
      onClick={() => setView(v)}
      className={`text-[10px] px-2 py-0.5 rounded ${
        view === v
          ? 'bg-[#1e3a5f] text-white'
          : 'border border-gray-300 text-gray-600'
      }`}
    >
      {label}
    </button>
  );

  const statuses = data?.statuses || [];
  const byStatus = data?.byStatus || {};

  // Per-status column values across visible sites, used for quintile coloring.
  const statusColumnValueArrays = statuses.map(st =>
    visibleSites.map(s => {
      const v = byStatus[s.siteCode]?.[st];
      return v && v > 0 ? v : null;
    }),
  );

  function onStatusCellClick(siteCode: string, status: string) {
    setDrawerFilters({
      dateFrom: filters.dateFrom,
      dateTo:   filters.dateTo,
      siteCode,
      status,
    });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 mb-[10px]">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div className="text-[11px] font-medium text-gray-800">
          {title}
        </div>
        <div className="flex items-center gap-3">
          {showSourceToggle && (
            <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
              Sites
              <select
                value={source}
                onChange={e => setSource(e.target.value as Source)}
                className="text-[11px] border border-gray-300 rounded px-1.5 py-0.5 font-normal normal-case tracking-normal"
              >
                <option value="tickets">Top by tickets</option>
                <option value="cost">Match cost sites</option>
              </select>
            </label>
          )}
          <div className="flex gap-0.5">
            {viewToggle('category', 'Category')}
            {viewToggle('status',   'Status')}
          </div>
          {view === 'category' && (
            <div className="flex gap-0.5">
              {metricToggle('count', 'Count')}
              {metricToggle('mttr',  'MTTR')}
              {metricToggle('sla',   'SLA %')}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">
          Loading…
        </div>
      ) : !data || visibleSites.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-xs text-gray-400">
          No tickets in window
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                  Site
                </th>
                {view === 'category'
                  ? categories.map(c => (
                      <th
                        key={c.slug}
                        className="text-right px-1.5 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap"
                        title={c.name}
                      >
                        {shortCategory(c.name)}
                      </th>
                    ))
                  : statuses.map(st => (
                      <th
                        key={st}
                        className="text-right px-1.5 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap"
                        title={st}
                      >
                        {shortStatus(st)}
                      </th>
                    ))}
                {showNotes && (
                  <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold w-[220px]">
                    Note
                  </th>
                )}
                <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleSites.map(s => {
                const categoryRowTotal = categories.reduce((sum, c) => {
                  const v = ticketCellValue(s.siteCode, c.slug);
                  return sum + (v ?? 0);
                }, 0);
                const statusRowTotal = statuses.reduce((sum, st) => {
                  const v = byStatus[s.siteCode]?.[st] || 0;
                  return sum + v;
                }, 0);
                const rowTotal = view === 'category' ? categoryRowTotal : statusRowTotal;
                return (
                  <tr key={s.siteCode}>
                    <td className="px-2 py-1 text-gray-900 whitespace-nowrap">
                      <span className="font-mono text-[10px] text-gray-500 mr-1.5">
                        {s.siteCode}
                      </span>
                      {s.siteName}
                    </td>
                    {view === 'category'
                      ? categories.map((c, i) => {
                          const v   = ticketCellValue(s.siteCode, c.slug);
                          const cls = cellColor(v, columnValueArrays[i]);
                          return (
                            <td key={c.slug} className="px-0.5 py-0.5">
                              {v !== null ? (
                                <button
                                  onClick={() => onCellClick(s.siteCode, c.slug)}
                                  className={`w-full px-1.5 py-1 text-right text-[11px] rounded hover:opacity-80 transition-opacity ${cls ? TIER_BG[cls] : ''}`}
                                  title={`${s.siteName} · ${c.name}: ${fmtCell(v)}`}
                                >
                                  {fmtCell(v)}
                                </button>
                              ) : (
                                <div className="w-full px-1.5 py-1 text-right text-[11px] text-gray-300">
                                  —
                                </div>
                              )}
                            </td>
                          );
                        })
                      : statuses.map((st, i) => {
                          const raw = byStatus[s.siteCode]?.[st];
                          const v   = raw && raw > 0 ? raw : null;
                          const cls = cellColor(v, statusColumnValueArrays[i]);
                          return (
                            <td key={st} className="px-0.5 py-0.5">
                              {v !== null ? (
                                <button
                                  onClick={() => onStatusCellClick(s.siteCode, st)}
                                  className={`w-full px-1.5 py-1 text-right text-[11px] rounded hover:opacity-80 transition-opacity ${cls ? TIER_BG[cls] : ''}`}
                                  title={`${s.siteName} · ${st}: ${v}`}
                                >
                                  {v}
                                </button>
                              ) : (
                                <div className="w-full px-1.5 py-1 text-right text-[11px] text-gray-300">
                                  —
                                </div>
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
                      {rowTotal > 0 ? rowTotal : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drawerFilters && (
        <TicketDrawer
          open
          filters={drawerFilters}
          onClose={() => setDrawerFilters(null)}
        />
      )}
    </div>
  );
}
