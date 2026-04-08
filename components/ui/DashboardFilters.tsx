'use client';

import { Filters } from '@/app/dashboard/page';
import { useState, useRef, useEffect } from 'react';

// ── Data ───────────────────────────────────────────────────────────────────

const TERRITORIES = [
  { code: 'BRENDON', label: "Brendon" },
  { code: 'TAFARA',  label: "Tafara"  },
  { code: 'SALIYA',  label: "Saliya"  },
  { code: 'TENDAI',  label: "Tendai"  },
];

const PRODUCTS = [
  { code: 'diesel', label: 'Diesel (D50)' },
  { code: 'blend',  label: 'Blend (B10)'  },
  { code: 'ulp',    label: 'ULP / Petrol' },
];

const MOSO_TYPES = [
  { code: 'CLCO', label: 'CLCO – Co. Leased / Co. Operated'      },
  { code: 'COCO', label: 'COCO – Co. Owned / Co. Operated'        },
  { code: 'CODO', label: 'CODO – Co. Owned / Dealer Operated'     },
  { code: 'DODO', label: 'DODO – Dealer Owned / Dealer Operated'  },
];

function buildPresets() {
  const today = new Date();
  const fmt   = (d: Date) => d.toISOString().split('T')[0];
  const ago   = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  return [
    { label: 'MTD',      from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmt(today) },
    { label: 'Last 30d', from: fmt(ago(30)),    to: fmt(today) },
    { label: 'YTD',      from: `${today.getFullYear()}-01-01`,  to: fmt(today) },
    { label: 'Q1 25',    from: '2025-01-01',    to: '2025-03-31' },
    { label: 'Q4 24',    from: '2024-10-01',    to: '2024-12-31' },
  ];
}

// ── Dropdown ───────────────────────────────────────────────────────────────

interface DropdownProps {
  label:    string;
  options:  { code: string; label: string }[];
  selected: string;
  onChange: (val: string) => void;
}

function FilterDropdown({ label, options, selected, onChange }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeLabel = options.find(o => o.code === selected)?.label ?? null;
  const active = selected !== '';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`filter-input flex items-center gap-1.5 cursor-pointer select-none
          ${active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : ''}`}
        style={{ paddingRight: 8 }}
      >
        <span className="font-medium">{activeLabel ?? label}</span>
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 opacity-50 flex-shrink-0">
          <path d="M4 6l4 4 4-4"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200
                        rounded-lg shadow-lg py-1 min-w-[210px]">
          <label className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
            <input type="radio" checked={selected === ''}
                   onChange={() => { onChange(''); setOpen(false); }}
                   className="accent-indigo-600" />
            <span className="text-xs text-gray-400 italic">All {label}</span>
          </label>
          <div className="h-px bg-gray-100 mx-2 my-1" />
          {options.map(opt => (
            <label key={opt.code}
                   className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
              <input type="radio" checked={selected === opt.code}
                     onChange={() => { onChange(opt.code); setOpen(false); }}
                     className="accent-indigo-600" />
              <span className="text-xs text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

interface Props { filters: Filters; onChange: (f: Filters) => void; }

export default function DashboardFilters({ filters, onChange }: Props) {
  // Pending = what the user is editing; only committed on "Load"
  const [pending, setPending] = useState<Filters>(filters);
  const presets = buildPresets();

  const set = (partial: Partial<Filters>) =>
    setPending(p => ({ ...p, ...partial }));

  // Check whether pending differs from the currently applied filters
  const isDirty = JSON.stringify(pending) !== JSON.stringify(filters);

  const apply = () => onChange(pending);

  const reset = () => {
    const clean: Filters = {
      dateFrom:  new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                   .toISOString().split('T')[0],
      dateTo:    new Date().toISOString().split('T')[0],
      territory: '', product: '', siteCode: '', moso: '',
    };
    setPending(clean);
    onChange(clean);
  };

  const activePreset = presets.find(
    p => p.from === pending.dateFrom && p.to === pending.dateTo
  )?.label ?? null;

  const hasActiveFilters =
    filters.territory || filters.product || filters.moso;

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl mb-5 px-4"
         style={{ paddingTop: 10, paddingBottom: 10 }}>
      <div className="flex flex-wrap items-center gap-2">

        {/* Date range */}
        <input type="date" value={pending.dateFrom}
               onChange={e => set({ dateFrom: e.target.value })}
               className="filter-input" />
        <span className="text-xs text-gray-400 select-none">to</span>
        <input type="date" value={pending.dateTo}
               onChange={e => set({ dateTo: e.target.value })}
               className="filter-input" />

        <div className="w-px h-5 bg-gray-200 mx-1" />

        {/* Dropdowns */}
        <FilterDropdown label="Territory" options={TERRITORIES}
                        selected={pending.territory}
                        onChange={v => set({ territory: v })} />
        <FilterDropdown label="Product"   options={PRODUCTS}
                        selected={pending.product}
                        onChange={v => set({ product: v })} />
        <FilterDropdown label="MOSO"      options={MOSO_TYPES}
                        selected={pending.moso}
                        onChange={v => set({ moso: v })} />

        <div className="w-px h-5 bg-gray-200 mx-1" />

        {/* Presets — apply immediately */}
        {presets.map(p => (
          <button
            key={p.label}
            onClick={() => {
              const next = { ...pending, dateFrom: p.from, dateTo: p.to };
              setPending(next);
              onChange(next);          // presets load immediately
            }}
            className={`preset-btn ${activePreset === p.label && !isDirty ? 'active' : ''}`}
          >
            {p.label}
          </button>
        ))}

        <div className="w-px h-5 bg-gray-200 mx-1" />

        {/* ── LOAD button ─────────────────────────────────────────────── */}
        <button
          onClick={apply}
          disabled={!isDirty}
          className={`flex items-center gap-1.5 h-8 px-4 rounded-md text-xs font-semibold
                      transition-all
                      ${isDirty
                        ? 'bg-[#1e3a5f] text-white hover:bg-[#162d4a] shadow-sm'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
        >
          {isDirty && (
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
              <path d="M2 8a6 6 0 1110.89-3H11a1 1 0 100 2h4a1 1 0 001-1V2a1 1 0 10-2 0v1.17A8 8 0 102 8a1 1 0 002 0z"/>
            </svg>
          )}
          Load
        </button>

        {/* Reset */}
        {(hasActiveFilters || isDirty) && (
          <button onClick={reset}
                  className="preset-btn text-red-500 border-red-200
                             hover:bg-red-600 hover:border-red-600 hover:text-white">
            Reset
          </button>
        )}

      </div>

      {/* Dirty indicator */}
      {isDirty && (
        <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 8a1 1 0 110-2 1 1 0 010 2z"/>
          </svg>
          Filters changed — click Load to apply
        </p>
      )}

      {/* Applied filter pills */}
      {hasActiveFilters && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {filters.territory && (
            <span className="flex items-center gap-1 bg-indigo-50 text-indigo-700
                             text-[11px] font-medium px-2 py-0.5 rounded-full border border-indigo-200">
              {TERRITORIES.find(t => t.code === filters.territory)?.label}
              <button onClick={() => { set({ territory: '' }); onChange({ ...filters, territory: '' }); }}
                      className="ml-0.5 hover:text-indigo-900 font-bold">&times;</button>
            </span>
          )}
          {filters.product && (
            <span className="flex items-center gap-1 bg-teal-50 text-teal-700
                             text-[11px] font-medium px-2 py-0.5 rounded-full border border-teal-200">
              {PRODUCTS.find(p => p.code === filters.product)?.label}
              <button onClick={() => { set({ product: '' }); onChange({ ...filters, product: '' }); }}
                      className="ml-0.5 hover:text-teal-900 font-bold">&times;</button>
            </span>
          )}
          {filters.moso && (
            <span className="flex items-center gap-1 bg-purple-50 text-purple-700
                             text-[11px] font-medium px-2 py-0.5 rounded-full border border-purple-200">
              {filters.moso}
              <button onClick={() => { set({ moso: '' }); onChange({ ...filters, moso: '' }); }}
                      className="ml-0.5 hover:text-purple-900 font-bold">&times;</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
