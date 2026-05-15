'use client';

import { useEffect, useState } from 'react';

export interface RMFilters {
  dateFrom:  string;
  dateTo:    string;
  territory: string;   // tm_code or ''
  siteCode:  string;   // site_code or ''
  category:  string;   // slug or ''
}

interface FilterOptions {
  territories: { code: string; name: string }[];
  sites:       { code: string; name: string; territoryCode: string | null }[];
  categories:  { slug: string; name: string }[];
}

interface Props {
  value: RMFilters;
  onChange: (next: RMFilters) => void;
}

export function defaultRMFilters(): RMFilters {
  const today = new Date();
  const year = today.getUTCFullYear();
  const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10);
  return {
    dateFrom:  `${year}-01-01`,
    dateTo:    yyyymmdd(today),
    territory: '',
    siteCode:  '',
    category:  '',
  };
}

export default function RMFilterBar({ value, onChange }: Props) {
  const [opts, setOpts] = useState<FilterOptions | null>(null);

  useEffect(() => {
    fetch('/api/rm/filters')
      .then(r => r.json())
      .then(j => setOpts(j.data || null))
      .catch(() => setOpts({ territories: [], sites: [], categories: [] }));
  }, []);

  const visibleSites = (opts?.sites || []).filter(
    s => !value.territory || s.territoryCode === value.territory,
  );

  return (
    <div className="card flex flex-wrap gap-3 items-end mb-4">
      <div>
        <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">From</label>
        <input type="date" value={value.dateFrom}
               onChange={e => onChange({ ...value, dateFrom: e.target.value })}
               className="text-sm border rounded px-2 py-1" />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">To</label>
        <input type="date" value={value.dateTo}
               onChange={e => onChange({ ...value, dateTo: e.target.value })}
               className="text-sm border rounded px-2 py-1" />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Territory</label>
        <select value={value.territory}
                onChange={e => onChange({ ...value, territory: e.target.value, siteCode: '' })}
                className="text-sm border rounded px-2 py-1 min-w-[160px]">
          <option value="">All territories</option>
          {(opts?.territories || []).map(t => (
            <option key={t.code} value={t.code}>{t.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Site</label>
        <select value={value.siteCode}
                onChange={e => onChange({ ...value, siteCode: e.target.value })}
                className="text-sm border rounded px-2 py-1 min-w-[200px]">
          <option value="">All sites</option>
          {visibleSites.map(s => (
            <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Category</label>
        <select value={value.category}
                onChange={e => onChange({ ...value, category: e.target.value })}
                className="text-sm border rounded px-2 py-1 min-w-[180px]">
          <option value="">All categories</option>
          {(opts?.categories || []).map(c => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <a href="#cost-lens" className="text-[11px] font-medium text-[#1e3a5f] hover:underline">
          Cost Lens ↓
        </a>
        <a href="#efficiency-lens" className="text-[11px] font-medium text-[#ea580c] hover:underline">
          Efficiency Lens ↓
        </a>
      </div>
    </div>
  );
}
