'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface BudgetMatrix {
  sites: { code: string; name: string }[];
  matrix: { month: string; cells: ({ b: number; s: number } | null)[] }[];
}

interface DailySite { siteCode: string; siteName: string; dailyBudgetRate: number }
interface DailySalesResp {
  month: string;
  calendarDays: number;
  dates: string[];
  sites: DailySite[];
  data: Record<string, Record<string, number>>;
  siteTotals: Record<string, number>;
}

const TERRITORIES: { code: string; label: string }[] = [
  { code: '',        label: 'All territories' },
  { code: 'BRENDON', label: "Brendon's Territory" },
  { code: 'SALIYA',  label: "Saliya's Territory"  },
  { code: 'TAFARA',  label: "Tafara's Territory"  },
  { code: 'TENDAI',  label: "Tendai's Territory"  },
];

const fmt = (n: number) => Math.round(n).toLocaleString('en');

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtPeriod = (iso: string) => {
  const m = String(iso).match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS_SHORT[parseInt(m[2], 10) - 1]} ${m[1]}` : iso;
};

// ──────────────────────────────────────────────────────────────
// Top-level component
// ──────────────────────────────────────────────────────────────

type SubView = 'budget' | 'daily';

export default function DatabaseViewerTab() {
  const [view, setView] = useState<SubView>('budget');

  return (
    <div className="mt-5 space-y-4">
      <div className="flex gap-1.5">
        {([
          ['budget', 'Budget Periods'],
          ['daily',  'Daily Sales Report'],
        ] as [SubView, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md border transition
              ${view === id
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'budget' && <BudgetPeriodsView />}
      {view === 'daily'  && <DailySalesView   />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Sub-view A: Budget Periods
// ──────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function BudgetPeriodsView() {
  const [territory, setTerritory] = useState('');
  const [data, setData] = useState<BudgetMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [save, setSave]   = useState<Record<string, SaveState>>({});
  const [errMsg, setErr]  = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = territory ? `?territory=${territory}` : '';
      const res = await fetch(`/api/budget-matrix${qs}`);
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [territory]);

  useEffect(() => { load(); }, [load]);

  const updateCell = (rowIdx: number, colIdx: number, kind: 'b' | 's', val: number | null) => {
    setData(prev => {
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
    key: string,
  ) => {
    setSave(s => ({ ...s, [key]: 'saving' }));
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
      setSave(s => ({ ...s, [key]: 'saved' }));
      setTimeout(() => setSave(s => {
        if (s[key] !== 'saved') return s;
        const c = { ...s }; delete c[key]; return c;
      }), 1500);
    } catch (e: any) {
      setSave(s => ({ ...s, [key]: 'error' }));
      setErr(e.message || 'Save failed');
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-900">Budget Periods</p>
          <p className="text-xs text-gray-400">Click any cell to edit. Tab to next field. Saves on blur.</p>
        </div>
        <div className="flex items-center gap-2">
          {errMsg && <span className="text-[11px] text-red-600 font-medium">{errMsg}</span>}
          <label className="text-xs text-gray-500">Territory</label>
          <select value={territory} onChange={e => setTerritory(e.target.value)}
                  className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white">
            {TERRITORIES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
          <button onClick={load} className="text-[10px] text-blue-600 hover:text-blue-800">↺ Refresh</button>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-400 text-center py-8">Loading…</p>}

      {!loading && data && data.sites.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No budget data</p>
      )}

      {!loading && data && data.sites.length > 0 && (
        <div className="overflow-auto border border-gray-200 rounded-lg max-h-[72vh]">
          <table className="text-xs border-collapse">
            <thead>
              <tr className="bg-[#1e3a5f] text-white sticky top-0 z-20">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold sticky left-0 bg-[#1e3a5f] z-30 border-r border-[#162d4a] min-w-[110px]">
                  Month
                </th>
                {data.sites.map(s => (
                  <th key={s.code} colSpan={2}
                      className="px-3 py-2.5 text-center text-[11px] font-semibold whitespace-nowrap border-l border-[#162d4a] min-w-[180px]"
                      title={s.code}>
                    {s.name}
                  </th>
                ))}
              </tr>
              <tr className="bg-[#2d5080] text-white sticky top-[37px] z-20">
                <th className="sticky left-0 bg-[#2d5080] z-30 border-r border-[#162d4a]"></th>
                {data.sites.map(s => (
                  <Fragment key={s.code}>
                    <th className="px-2 py-1.5 text-right text-[10px] font-medium border-l border-[#162d4a]">Budget</th>
                    <th className="px-2 py-1.5 text-right text-[10px] font-medium">Stretch</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.matrix.map((row, rIdx) => (
                <tr key={row.month} className="hover:bg-blue-50/40">
                  <td className="px-3 py-2 font-semibold text-gray-800 sticky left-0 bg-white z-10 border-r border-gray-200 whitespace-nowrap">
                    {fmtPeriod(row.month)}
                  </td>
                  {data.sites.map((site, cIdx) => {
                    const cell = row.cells[cIdx];
                    const bKey = `${row.month}|${site.code}|b`;
                    const sKey = `${row.month}|${site.code}|s`;
                    return (
                      <Fragment key={site.code}>
                        <CellInput
                          value={cell?.b ?? null}
                          state={save[bKey]}
                          onCommit={(v) => {
                            updateCell(rIdx, cIdx, 'b', v);
                            const newCell = data.matrix[rIdx].cells[cIdx];
                            persist(site.code, row.month, v, newCell?.s ?? null, bKey);
                          }}
                          leftBorder
                        />
                        <CellInput
                          value={cell?.s ?? null}
                          state={save[sKey]}
                          onCommit={(v) => {
                            updateCell(rIdx, cIdx, 's', v);
                            const newCell = data.matrix[rIdx].cells[cIdx];
                            persist(site.code, row.month, newCell?.b ?? null, v, sKey);
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
      )}
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
    state === 'error'  ? 'bg-red-50' : '';

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

// ──────────────────────────────────────────────────────────────
// Sub-view B: Daily Sales Report
// ──────────────────────────────────────────────────────────────

const todayMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function DailySalesView() {
  const [month, setMonth]         = useState(todayMonth());
  const [territory, setTerritory] = useState('');
  const [data, setData]           = useState<DailySalesResp | null>(null);
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ month });
      if (territory) qs.set('territory', territory);
      const res = await fetch(`/api/db-viewer/daily-sales?${qs}`);
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [month, territory]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-900">Daily Sales Report</p>
          <p className="text-xs text-gray-400">Per-site daily volumes vs daily budget rate</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                 className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white" />
          <label className="text-xs text-gray-500">Territory</label>
          <select value={territory} onChange={e => setTerritory(e.target.value)}
                  className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white">
            {TERRITORIES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
          <button onClick={load} className="text-[10px] text-blue-600 hover:text-blue-800">↺ Refresh</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-600"/>≥110% surpassed</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-200"/>90–109% met</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-amber-200"/>70–89% under</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-200"/>&lt;70% well under</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-gray-100 border border-gray-200"/>no data</span>
      </div>

      {loading && <p className="text-sm text-gray-400 text-center py-8">Loading…</p>}

      {!loading && data && data.sites.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No data for the selected month</p>
      )}

      {!loading && data && data.sites.length > 0 && (
        <DailySalesMatrix data={data} />
      )}
    </div>
  );
}

function DailySalesMatrix({ data }: { data: DailySalesResp }) {
  // Pre-compute lookup for daily budget rates
  const rateMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of data.sites) m[s.siteCode] = s.dailyBudgetRate;
    return m;
  }, [data]);

  const cellClass = (val: number | undefined, rate: number | undefined): string => {
    if (val == null) return 'bg-gray-50 text-gray-300';
    if (!rate)       return 'bg-white text-gray-700';
    const ratio = (val / rate) * 100;
    if (ratio >= 110) return 'bg-emerald-600 text-white';
    if (ratio >= 90)  return 'bg-emerald-100 text-emerald-900';
    if (ratio >= 70)  return 'bg-amber-100 text-amber-900';
    return 'bg-red-100 text-red-900';
  };

  return (
    <div className="overflow-auto border border-gray-200 rounded-lg max-h-[72vh]">
      <table className="text-xs border-collapse">
        <thead>
          <tr className="bg-[#1e3a5f] text-white sticky top-0 z-20">
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold sticky left-0 bg-[#1e3a5f] z-30 border-r border-[#162d4a] min-w-[100px]">
              Date
            </th>
            {data.sites.map(s => (
              <th key={s.siteCode}
                  className="px-2 py-2.5 text-center text-[11px] font-semibold whitespace-nowrap border-l border-[#162d4a] min-w-[100px]"
                  title={`${s.siteCode} · daily budget ${fmt(s.dailyBudgetRate)} L`}>
                {s.siteName}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right text-[11px] font-semibold whitespace-nowrap border-l border-[#162d4a] bg-[#162d4a] sticky right-0 z-30 min-w-[110px]">
              Day Total
            </th>
          </tr>
        </thead>
        <tbody>
          {data.dates.map(d => {
            const dayLabel = d.slice(8, 10);
            const row = data.data[d] || {};
            const dayTotal = row._total || 0;
            return (
              <tr key={d} className="hover:bg-blue-50/30">
                <td className="px-3 py-1.5 font-semibold text-gray-700 sticky left-0 bg-white z-10 border-r border-gray-200 whitespace-nowrap">
                  {dayLabel} <span className="text-gray-400 font-normal">{d.slice(0, 7)}</span>
                </td>
                {data.sites.map(s => {
                  const v    = row[s.siteCode];
                  const rate = rateMap[s.siteCode];
                  return (
                    <td key={s.siteCode}
                        className={`px-2 py-1.5 text-right font-mono tabular-nums text-[11px] border-l border-gray-100 ${cellClass(v, rate)}`}>
                      {v != null ? fmt(v) : '—'}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[11px] font-semibold text-gray-900 bg-gray-50 border-l border-gray-200 sticky right-0 z-10">
                  {dayTotal > 0 ? fmt(dayTotal) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-gray-100 sticky bottom-0 z-20">
            <td className="px-3 py-2 font-bold text-gray-800 sticky left-0 bg-gray-100 z-30 border-r border-gray-300">
              MTD Total
            </td>
            {data.sites.map(s => (
              <td key={s.siteCode}
                  className="px-2 py-2 text-right font-mono tabular-nums text-[11px] font-bold text-gray-900 border-l border-gray-200">
                {fmt(data.siteTotals[s.siteCode] || 0)}
              </td>
            ))}
            <td className="px-3 py-2 text-right font-mono tabular-nums text-[12px] font-bold text-gray-900 bg-gray-200 border-l border-gray-300 sticky right-0 z-30">
              {fmt(data.siteTotals._total || 0)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
