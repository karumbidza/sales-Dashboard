// components/ui/DashboardFilters.tsx
'use client';

import { Filters } from '@/app/dashboard/page';
import { useState } from 'react';

const TERRITORIES = [
  { code: '', label: 'All Territories' },
  { code: 'BRENDON', label: "Brendon's Territory" },
  { code: 'TAFARA',  label: "Tafara's Territory" },
  { code: 'SALIYA',  label: "Saliya's Territory" },
  { code: 'TENDAI',  label: "Tendai's Territory" },
];

const PRODUCTS = [
  { code: '', label: 'All Products' },
  { code: 'diesel', label: 'Diesel (D50)' },
  { code: 'blend',  label: 'Blend (B10)' },
  { code: 'ulp',    label: 'ULP (Petrol)' },
];

const MOSO_TYPES = [
  { code: '', label: 'All MOSO' },
  { code: 'CLCO', label: 'CLCO' },
  { code: 'COCO', label: 'COCO' },
  { code: 'CODO', label: 'CODO' },
  { code: 'DODO', label: 'DODO' },
];

// Quick date presets
function datePresets(set: (f: Partial<Filters>) => void) {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return [
    { label: 'MTD', action: () => set({ dateFrom: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), dateTo: fmt(today) }) },
    { label: 'Last 30d', action: () => { const f = new Date(today); f.setDate(f.getDate() - 30); set({ dateFrom: fmt(f), dateTo: fmt(today) }); } },
    { label: 'Last 7d',  action: () => { const f = new Date(today); f.setDate(f.getDate() - 7);  set({ dateFrom: fmt(f), dateTo: fmt(today) }); } },
    { label: 'YTD', action: () => set({ dateFrom: `${today.getFullYear()}-01-01`, dateTo: fmt(today) }) },
    { label: 'Q1 25', action: () => set({ dateFrom: '2025-01-01', dateTo: '2025-03-31' }) },
    { label: 'Q4 24', action: () => set({ dateFrom: '2024-10-01', dateTo: '2024-12-31' }) },
  ];
}

interface Props { filters: Filters; onChange: (f: Filters) => void; }

export default function DashboardFilters({ filters, onChange }: Props) {
  const set = (partial: Partial<Filters>) => onChange({ ...filters, ...partial });

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 font-medium">From</label>
          <input
            type="date" value={filters.dateFrom}
            onChange={e => set({ dateFrom: e.target.value })}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 font-medium">To</label>
          <input
            type="date" value={filters.dateTo}
            onChange={e => set({ dateTo: e.target.value })}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {/* Territory */}
        <select
          value={filters.territory}
          onChange={e => set({ territory: e.target.value })}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {TERRITORIES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>

        {/* Product */}
        <select
          value={filters.product}
          onChange={e => set({ product: e.target.value })}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {PRODUCTS.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
        </select>

        {/* MOSO */}
        <select
          value={filters.moso}
          onChange={e => set({ moso: e.target.value })}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {MOSO_TYPES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>

        {/* Divider */}
        <div className="h-4 w-px bg-gray-200 mx-1" />

        {/* Quick presets */}
        <div className="flex gap-1.5 flex-wrap">
          {datePresets(set).map(p => (
            <button
              key={p.label}
              onClick={p.action}
              className="px-2.5 py-1 bg-gray-100 hover:bg-blue-100 hover:text-blue-700 text-gray-600 rounded-md text-xs font-medium transition"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Reset */}
        <button
          onClick={() => onChange({
            dateFrom: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
            dateTo:   new Date().toISOString().split('T')[0],
            territory: '', product: '', siteCode: '', moso: '',
          })}
          className="ml-auto px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-md text-xs transition"
        >
          ✕ Reset
        </button>
      </div>

      {/* Active filter pills */}
      <div className="flex gap-2 mt-2 flex-wrap">
        {filters.territory && (
          <span className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
            Territory: {TERRITORIES.find(t => t.code === filters.territory)?.label}
            <button onClick={() => set({ territory: '' })} className="hover:text-blue-900">×</button>
          </span>
        )}
        {filters.product && (
          <span className="flex items-center gap-1 bg-teal-50 text-teal-700 text-xs px-2 py-0.5 rounded-full">
            Product: {PRODUCTS.find(p => p.code === filters.product)?.label}
            <button onClick={() => set({ product: '' })} className="hover:text-teal-900">×</button>
          </span>
        )}
        {filters.moso && (
          <span className="flex items-center gap-1 bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full">
            MOSO: {filters.moso}
            <button onClick={() => set({ moso: '' })} className="hover:text-purple-900">×</button>
          </span>
        )}
      </div>
    </div>
  );
}
