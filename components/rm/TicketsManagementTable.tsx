'use client';

// components/rm/TicketsManagementTable.tsx
// Excel-style tickets management.
//
// Workflow:
//   1. Click a row's Exclude checkbox → marks the row as PENDING (local
//      state only). Visual: row highlighted yellow + checkbox reflects
//      the pending future state, not the current server state.
//   2. Top bar's Reason dropdown + Save button become active.
//   3. User picks a reason (Sales / IT / Test / Other / custom), clicks
//      Save → ONE batched POST + ONE batched DELETE; pending excludes
//      go up, pending un-excludes come down.
//   4. Optimistic UI: rows update locally before the refetch finishes,
//      so the table never "blanks out" with a loading state.
//
// Re-import safety: rm_helpdesk_exclusions is keyed by Freshdesk
// ticket_id. Ingest path uses ON CONFLICT (ticket_id) DO UPDATE for
// tickets but does not touch the exclusions table. So an excluded
// ticket stays excluded across re-imports; its status/resolution still
// get refreshed each time.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RMFilters } from './RMFilterBar';

interface TicketRow {
  ticketId:       number;
  siteCode:       string;
  siteName:       string;
  subject:        string;
  status:         string;
  priority:       string | null;
  serviceProvider:string | null;
  createdTime:    string | null;
  resolvedTime:   string | null;
  isExcluded:     boolean;
  excludeReason:  string | null;
}

type ColKey =
  | 'ticketId' | 'site' | 'subject' | 'status' | 'priority' | 'createdTime' | 'excludeReason';
type SortDir = 'asc' | 'desc';

const REASON_OPTIONS = ['Sales', 'IT', 'Test', 'Other'] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function rowSortValue(r: TicketRow, key: ColKey): string | number {
  switch (key) {
    case 'ticketId':     return r.ticketId;
    case 'site':         return r.siteName ?? r.siteCode ?? '';
    case 'subject':      return r.subject ?? '';
    case 'status':       return r.status ?? '';
    case 'priority':     return r.priority ?? '';
    case 'createdTime':  return r.createdTime ?? '';
    case 'excludeReason':return r.excludeReason ?? '';
  }
}

function rowFilterValue(r: TicketRow, key: ColKey): string {
  switch (key) {
    case 'ticketId':     return String(r.ticketId);
    case 'site':         return r.siteName ?? r.siteCode ?? '';
    case 'subject':      return r.subject ?? '';
    case 'status':       return r.status ?? '';
    case 'priority':     return r.priority ?? '';
    case 'createdTime':  return r.createdTime ?? '';
    case 'excludeReason':return r.excludeReason ?? '';
  }
}

const FILTERABLE: ColKey[] = ['ticketId', 'site', 'status', 'priority', 'excludeReason'];

// ────────────────────────────────────────────────────────────────────────────
// Column dropdown popover — sort + filter checklist
// ────────────────────────────────────────────────────────────────────────────

interface DropdownProps {
  colKey: ColKey;
  label: string;
  uniqueValues: string[];
  selected: Set<string>;
  sort: { key: ColKey; dir: SortDir } | null;
  filterable: boolean;
  onSort: (dir: SortDir) => void;
  onApply: (selected: Set<string>) => void;
  onClear: () => void;
  onClose: () => void;
}

function ColumnDropdown({
  colKey, label, uniqueValues, selected, sort, filterable,
  onSort, onApply, onClear, onClose,
}: DropdownProps) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));

  const filteredValues = useMemo(() => {
    if (!search.trim()) return uniqueValues;
    const q = search.toLowerCase();
    return uniqueValues.filter(v => v.toLowerCase().includes(q));
  }, [uniqueValues, search]);

  const allChecked  = draft.size === 0 || filteredValues.every(v => draft.has(v));
  const noneChecked = filteredValues.every(v => !draft.has(v));

  function toggle(v: string) {
    const next = new Set(draft);
    if (next.has(v)) next.delete(v); else next.add(v);
    setDraft(next);
  }
  function toggleAll() {
    if (allChecked) {
      const next = new Set(draft);
      for (const v of filteredValues) next.delete(v);
      setDraft(next);
    } else {
      const next = new Set(draft);
      for (const v of filteredValues) next.add(v);
      setDraft(next);
    }
  }

  return (
    <div
      className="absolute z-30 mt-1 bg-white border border-gray-300 rounded-md shadow-xl text-xs"
      style={{ minWidth: 240, top: '100%', left: 0 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{label}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-base leading-none">×</button>
      </div>

      <div className="px-3 py-2 border-b border-gray-100">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Sort</div>
        <div className="grid grid-cols-2 gap-1">
          <button
            onClick={() => onSort('asc')}
            className={`text-xs px-2 py-1 rounded border transition ${
              sort?.key === colKey && sort.dir === 'asc'
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white border-gray-200 hover:border-gray-400'
            }`}
          >↑ Ascending</button>
          <button
            onClick={() => onSort('desc')}
            className={`text-xs px-2 py-1 rounded border transition ${
              sort?.key === colKey && sort.dir === 'desc'
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white border-gray-200 hover:border-gray-400'
            }`}
          >↓ Descending</button>
        </div>
      </div>

      {filterable && (
        <>
          <div className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">Filter</div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1 mb-2 focus:outline-none focus:border-[#1e3a5f]"
              autoFocus
            />
            <div className="max-h-48 overflow-y-auto border border-gray-100 rounded">
              <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer border-b border-gray-100 bg-gray-50/50">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = !allChecked && !noneChecked; }}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5"
                />
                <span className="font-medium">(Select all)</span>
              </label>
              {filteredValues.length === 0 && (
                <div className="px-2 py-2 text-gray-400 italic">no matches</div>
              )}
              {filteredValues.map(v => (
                <label key={v} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.has(v)}
                    onChange={() => toggle(v)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate" title={v}>{v === '' ? <em className="text-gray-400">(empty)</em> : v}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => { setDraft(new Set()); onClear(); onClose(); }}
              className="text-xs text-gray-600 hover:text-gray-900"
            >Clear filter</button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
              >Cancel</button>
              <button
                onClick={() => { onApply(draft); onClose(); }}
                className="text-xs font-medium text-white bg-[#1e3a5f] hover:bg-[#16304f] px-3 py-1 rounded transition"
              >Apply</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Column header — label + sort arrow + ▼ caret
// ────────────────────────────────────────────────────────────────────────────

interface HeaderProps {
  colKey: ColKey;
  label: string;
  sort: { key: ColKey; dir: SortDir } | null;
  hasFilter: boolean;
  openColumn: ColKey | null;
  onOpenChange: (col: ColKey | null) => void;
  filterable: boolean;
  uniqueValues: string[];
  selected: Set<string>;
  onSort: (dir: SortDir) => void;
  onApply: (s: Set<string>) => void;
  onClear: () => void;
  align?: 'left' | 'right';
}

function ColumnHeader(props: HeaderProps) {
  const { colKey, label, sort, hasFilter, openColumn, onOpenChange, filterable, align = 'left' } = props;
  const isOpen = openColumn === colKey;
  const isSorted = sort?.key === colKey;
  const sortArrow = isSorted ? (sort!.dir === 'asc' ? '↑' : '↓') : '';

  return (
    <th
      className={`px-2 py-2 text-${align} relative`}
      style={{ verticalAlign: 'middle' }}
    >
      <div className="inline-flex items-center gap-1">
        <span>{label}</span>
        {sortArrow && <span className="text-[#1e3a5f] text-[10px]">{sortArrow}</span>}
        {hasFilter && <span className="w-1 h-1 rounded-full bg-[#1e3a5f]" title="Filter active" />}
        <button
          onClick={e => { e.stopPropagation(); onOpenChange(isOpen ? null : colKey); }}
          className="ml-0.5 text-gray-400 hover:text-gray-700 leading-none"
          aria-label={`Open ${label} menu`}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M1 3 L5 7 L9 3 Z" />
          </svg>
        </button>
      </div>
      {isOpen && (
        <ColumnDropdown
          colKey={colKey}
          label={label}
          uniqueValues={props.uniqueValues}
          selected={props.selected}
          sort={sort}
          filterable={filterable}
          onSort={props.onSort}
          onApply={props.onApply}
          onClear={props.onClear}
          onClose={() => onOpenChange(null)}
        />
      )}
    </th>
  );
}

// ────────────────────────────────────────────────────────────────────────────

interface Props { filters: RMFilters }

export default function TicketsManagementTable({ filters }: Props) {
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showExcluded, setShowExcluded] = useState(false);

  // PENDING CHANGES — local-only until the user clicks Save.
  const [pendingExclude,   setPendingExclude]   = useState<Set<number>>(new Set());
  const [pendingUnexclude, setPendingUnexclude] = useState<Set<number>>(new Set());

  // Reason picker for the pending excludes
  const [reasonValue, setReasonValue] = useState<string>('Sales');
  const [reasonOther, setReasonOther] = useState<string>('');

  const [saving, setSaving] = useState(false);

  // Sort + filter state (unchanged from previous version)
  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir } | null>(
    { key: 'createdTime', dir: 'desc' },
  );
  const [filterSets, setFilterSets] = useState<Record<ColKey, Set<string>>>({
    ticketId: new Set(), site: new Set(), subject: new Set(),
    status: new Set(), priority: new Set(),
    createdTime: new Set(), excludeReason: new Set(),
  });
  const [openColumn, setOpenColumn] = useState<ColKey | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click outside closes any open dropdown
  useEffect(() => {
    if (!openColumn) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenColumn(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openColumn]);

  const fetchRows = useCallback(async (showSpinner = true) => {
    const qs = new URLSearchParams({
      dateFrom: filters.dateFrom,
      dateTo:   filters.dateTo,
      siteCode: filters.siteCode,
      limit:    '2000',
      includeExcluded: showExcluded ? 'true' : 'false',
    }).toString();
    if (showSpinner) setLoading(true);
    try {
      const r = await fetch(`/api/helpdesk/tickets?${qs}`);
      const j = await r.json();
      setRows(j.data ?? []);
    } catch {
      setRows([]);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [filters, showExcluded]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // ── Pending state helpers ──────────────────────────────────────────
  const totalPending = pendingExclude.size + pendingUnexclude.size;
  const hasExcludesPending = pendingExclude.size > 0;

  function effectiveExcluded(t: TicketRow): boolean {
    // Visual state = server state XOR pending toggle
    if (t.isExcluded) return !pendingUnexclude.has(t.ticketId);
    return pendingExclude.has(t.ticketId);
  }

  function rowIsPending(t: TicketRow): boolean {
    return pendingExclude.has(t.ticketId) || pendingUnexclude.has(t.ticketId);
  }

  function toggleExclude(t: TicketRow) {
    if (t.isExcluded) {
      setPendingUnexclude(prev => {
        const next = new Set(prev);
        if (next.has(t.ticketId)) next.delete(t.ticketId);
        else next.add(t.ticketId);
        return next;
      });
    } else {
      setPendingExclude(prev => {
        const next = new Set(prev);
        if (next.has(t.ticketId)) next.delete(t.ticketId);
        else next.add(t.ticketId);
        return next;
      });
    }
  }

  function discardPending() {
    setPendingExclude(new Set());
    setPendingUnexclude(new Set());
  }

  async function savePending() {
    if (totalPending === 0) return;
    setSaving(true);
    try {
      const reason = reasonValue === 'Other' ? (reasonOther.trim() || 'Other') : reasonValue;
      const promises: Promise<any>[] = [];
      if (pendingExclude.size > 0) {
        promises.push(fetch('/api/helpdesk/exclusions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ticketIds: Array.from(pendingExclude), reason }),
        }));
      }
      if (pendingUnexclude.size > 0) {
        promises.push(fetch('/api/helpdesk/exclusions', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ticketIds: Array.from(pendingUnexclude) }),
        }));
      }

      // Optimistic update — flip the affected rows immediately so the
      // table doesn't blink while the refetch is in flight.
      setRows(prev => prev.map(r => {
        if (pendingExclude.has(r.ticketId)) {
          return { ...r, isExcluded: true, excludeReason: reason };
        }
        if (pendingUnexclude.has(r.ticketId)) {
          return { ...r, isExcluded: false, excludeReason: null };
        }
        return r;
      }));

      // Clear pending immediately — server confirmation will come via refetch.
      setPendingExclude(new Set());
      setPendingUnexclude(new Set());

      await Promise.all(promises);
      // Quiet refetch (no spinner) to reconcile with server truth.
      fetchRows(false);
    } finally {
      setSaving(false);
    }
  }

  // ── Unique values for filter checklists ────────────────────────────
  function uniqueFor(key: ColKey): string[] {
    const set = new Set<string>();
    for (const r of rows) set.add(rowFilterValue(r, key));
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  const uniqueCache = useMemo(
    () => ({
      ticketId:     uniqueFor('ticketId'),
      site:         uniqueFor('site'),
      subject:      uniqueFor('subject'),
      status:       uniqueFor('status'),
      priority:     uniqueFor('priority'),
      createdTime:  uniqueFor('createdTime'),
      excludeReason:uniqueFor('excludeReason'),
    }),
    [rows], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Apply filters + sort ───────────────────────────────────────────
  const visibleRows = useMemo(() => {
    const filtered = rows.filter(r => {
      for (const key of FILTERABLE) {
        const allowed = filterSets[key];
        if (allowed.size === 0) continue;
        if (!allowed.has(rowFilterValue(r, key))) return false;
      }
      return true;
    });
    if (!sort) return filtered;
    return [...filtered].sort((a, b) => {
      const av = rowSortValue(a, sort.key);
      const bv = rowSortValue(b, sort.key);
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, filterSets, sort]);

  const excludedCount = useMemo(() => rows.filter(r => r.isExcluded).length, [rows]);
  const activeFilterCount = useMemo(
    () => FILTERABLE.filter(k => filterSets[k].size > 0).length,
    [filterSets],
  );

  function setColumnSort(key: ColKey, dir: SortDir) {
    setSort({ key, dir });
  }
  function setColumnFilter(key: ColKey, allowed: Set<string>) {
    setFilterSets(prev => ({ ...prev, [key]: allowed }));
  }
  function clearColumnFilter(key: ColKey) {
    setFilterSets(prev => ({ ...prev, [key]: new Set() }));
  }
  function clearAllFilters() {
    setFilterSets({
      ticketId: new Set(), site: new Set(), subject: new Set(),
      status: new Set(), priority: new Set(),
      createdTime: new Set(), excludeReason: new Set(),
    });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-md" ref={containerRef}>
      {/* Header strip — info + pending action bar + sort/filter clear + show-excluded */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="text-[10px] uppercase font-semibold tracking-[0.6px] text-gray-500">
            Tickets · Manage
          </div>
          <span className="text-[11px] text-gray-500">
            {visibleRows.length} of {rows.length}{activeFilterCount > 0 ? ' (filtered)' : ''} · {excludedCount} excluded
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Reason picker (only relevant if there are pending excludes) */}
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">Reason</label>
            <select
              value={reasonValue}
              onChange={e => setReasonValue(e.target.value)}
              disabled={!hasExcludesPending || saving}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:border-[#1e3a5f]"
            >
              {REASON_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonValue === 'Other' && hasExcludesPending && (
              <input
                type="text"
                value={reasonOther}
                onChange={e => setReasonOther(e.target.value)}
                placeholder="Custom…"
                disabled={saving}
                className="text-xs border border-gray-200 rounded px-2 py-1 w-32 focus:outline-none focus:border-[#1e3a5f] disabled:bg-gray-50"
              />
            )}
          </div>

          {/* Discard pending */}
          {totalPending > 0 && (
            <button
              onClick={discardPending}
              disabled={saving}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded transition"
            >
              Discard
            </button>
          )}

          {/* Save */}
          <button
            onClick={savePending}
            disabled={totalPending === 0 || saving}
            className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${
              totalPending > 0
                ? 'text-white bg-[#1e3a5f] hover:bg-[#16304f]'
                : 'text-gray-400 bg-gray-100 cursor-not-allowed'
            } disabled:opacity-60`}
            title={
              totalPending === 0
                ? 'No pending changes'
                : `Save ${pendingExclude.size} excludes${pendingUnexclude.size > 0 ? ` + ${pendingUnexclude.size} un-excludes` : ''}`
            }
          >
            {saving ? 'Saving…' : `Save${totalPending > 0 ? ` (${totalPending})` : ''}`}
          </button>

          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded transition"
              title="Clear all column filters"
            >
              Clear filters ({activeFilterCount})
            </button>
          )}

          <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showExcluded}
              onChange={e => setShowExcluded(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Show excluded
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-500 uppercase text-[10px] tracking-wider">
              <ColumnHeader
                colKey="ticketId" label="Ticket"
                sort={sort} hasFilter={filterSets.ticketId.size > 0}
                openColumn={openColumn} onOpenChange={setOpenColumn} filterable={true}
                uniqueValues={uniqueCache.ticketId}
                selected={filterSets.ticketId}
                onSort={dir => setColumnSort('ticketId', dir)}
                onApply={s => setColumnFilter('ticketId', s)}
                onClear={() => clearColumnFilter('ticketId')}
              />
              <ColumnHeader
                colKey="site" label="Site"
                sort={sort} hasFilter={filterSets.site.size > 0}
                openColumn={openColumn} onOpenChange={setOpenColumn} filterable={true}
                uniqueValues={uniqueCache.site}
                selected={filterSets.site}
                onSort={dir => setColumnSort('site', dir)}
                onApply={s => setColumnFilter('site', s)}
                onClear={() => clearColumnFilter('site')}
              />
              <ColumnHeader
                colKey="subject" label="Subject"
                sort={sort} hasFilter={false}
                openColumn={openColumn} onOpenChange={setOpenColumn} filterable={false}
                uniqueValues={[]}
                selected={new Set()}
                onSort={dir => setColumnSort('subject', dir)}
                onApply={() => {}}
                onClear={() => {}}
              />
              <ColumnHeader
                colKey="status" label="Status"
                sort={sort} hasFilter={filterSets.status.size > 0}
                openColumn={openColumn} onOpenChange={setOpenColumn} filterable={true}
                uniqueValues={uniqueCache.status}
                selected={filterSets.status}
                onSort={dir => setColumnSort('status', dir)}
                onApply={s => setColumnFilter('status', s)}
                onClear={() => clearColumnFilter('status')}
              />
              <ColumnHeader
                colKey="priority" label="Priority"
                sort={sort} hasFilter={filterSets.priority.size > 0}
                openColumn={openColumn} onOpenChange={setOpenColumn} filterable={true}
                uniqueValues={uniqueCache.priority}
                selected={filterSets.priority}
                onSort={dir => setColumnSort('priority', dir)}
                onApply={s => setColumnFilter('priority', s)}
                onClear={() => clearColumnFilter('priority')}
              />
              <ColumnHeader
                colKey="createdTime" label="Created"
                sort={sort} hasFilter={false}
                openColumn={openColumn} onOpenChange={setOpenColumn} filterable={false}
                uniqueValues={[]}
                selected={new Set()}
                onSort={dir => setColumnSort('createdTime', dir)}
                onApply={() => {}}
                onClear={() => {}}
              />
              <th className="px-2 py-2 text-left w-16">Exclude</th>
              <ColumnHeader
                colKey="excludeReason" label="Reason"
                sort={sort} hasFilter={filterSets.excludeReason.size > 0}
                openColumn={openColumn} onOpenChange={setOpenColumn} filterable={true}
                uniqueValues={uniqueCache.excludeReason}
                selected={filterSets.excludeReason}
                onSort={dir => setColumnSort('excludeReason', dir)}
                onApply={s => setColumnFilter('excludeReason', s)}
                onClear={() => clearColumnFilter('excludeReason')}
              />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400 text-xs">Loading…</td></tr>
            )}
            {!loading && visibleRows.length === 0 && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400 text-xs">No tickets in window</td></tr>
            )}
            {!loading && visibleRows.length === 0 && rows.length > 0 && (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400 text-xs">No rows match the active filters</td></tr>
            )}
            {!loading && visibleRows.map(t => {
              const eff = effectiveExcluded(t);
              const pending = rowIsPending(t);
              const rowCls = pending
                ? 'bg-amber-50/80'
                : eff
                  ? 'bg-gray-50 text-gray-400 italic'
                  : 'hover:bg-blue-50/40';
              return (
                <tr key={t.ticketId} className={`border-t border-gray-100 ${rowCls}`}>
                  <td className="px-2 py-1.5 font-mono text-[11px]">#{t.ticketId}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{t.siteName}</div>
                    <div className="text-gray-400 text-[10px]">{t.siteCode}</div>
                  </td>
                  <td className="px-2 py-1.5 max-w-md truncate" title={t.subject}>{t.subject}</td>
                  <td className="px-2 py-1.5">{t.status}</td>
                  <td className="px-2 py-1.5">{t.priority ?? '—'}</td>
                  <td className="px-2 py-1.5">{fmtDate(t.createdTime)}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={eff}
                      onChange={() => toggleExclude(t)}
                      disabled={saving}
                      className="h-3.5 w-3.5"
                      aria-label={eff ? `Mark to un-exclude ticket ${t.ticketId}` : `Mark to exclude ticket ${t.ticketId}`}
                      title={
                        pending
                          ? (t.isExcluded
                              ? 'Pending un-exclude — click Save to commit'
                              : 'Pending exclude — click Save to commit')
                          : (t.isExcluded ? 'Currently excluded' : 'Mark as junk / non-R&M')
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5 text-[11px]">{t.excludeReason ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
