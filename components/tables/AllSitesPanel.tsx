'use client';

import { useMemo, useState } from 'react';
import SiteBreakdownTable from './SiteBreakdownTable';

export type AllSitesSortKey = 'volume' | 'vsBudgetPct' | 'vsStretchPct' | 'revenue' | 'avgDaily' | 'netMarginCpl';

const SORT_OPTIONS: { key: AllSitesSortKey; label: string }[] = [
  { key: 'volume',        label: 'Volume' },
  { key: 'vsBudgetPct',   label: 'Vs Budget %' },
  { key: 'vsStretchPct',  label: 'Vs Stretch %' },
  { key: 'revenue',       label: 'Revenue' },
  { key: 'avgDaily',      label: 'Avg Daily' },
  { key: 'netMarginCpl',  label: 'Net Margin / L' },
];

interface Props {
  data: any[];
  sortBy: AllSitesSortKey;
  onSortChange: (k: AllSitesSortKey) => void;
}

export default function AllSitesPanel({ data, sortBy, onSortChange }: Props) {
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? data.filter(s => (s.siteName || '').toLowerCase().includes(q))
      : data;
    return [...filtered].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (bv as number) - (av as number);
    });
  }, [data, search, sortBy]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search sites…"
          className="text-sm border border-gray-200 rounded-md px-3 py-1.5 w-64 focus:outline-none focus:border-[#1e3a5f]"
        />
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500">Sort by</label>
          <select
            value={sortBy}
            onChange={e => onSortChange(e.target.value as AllSitesSortKey)}
            className="text-sm border border-gray-200 rounded-md px-2 py-1.5"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <SiteBreakdownTable data={visible} type="sites" paginate />
    </div>
  );
}
