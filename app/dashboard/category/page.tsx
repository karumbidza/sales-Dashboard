// app/dashboard/category/page.tsx
// Landing page for Category Analysis — lists every category ranked by
// tickets + cost in the current YTD window, each card links to the
// per-category deep-dive at /dashboard/category/[slug].
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const ChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-5" />
  </svg>
);

interface CategoryTile {
  slug:    string;
  name:    string;
  tickets: number;
  cost:    number;
}

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export default function CategoryChooserPage() {
  const router = useRouter();
  const [tiles, setTiles] = useState<CategoryTile[]>([]);
  const [loading, setLoading] = useState(true);

  // YTD window for ranking — page is a chooser, not the deep-dive itself.
  const year      = new Date().getUTCFullYear();
  const today     = new Date().toISOString().slice(0, 10);
  const dateFrom  = `${year}-01-01`;
  const dateTo    = today;

  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom, dateTo, territory: '', siteCode: '', category: '', dimension: 'tickets',
    }).toString();
    setLoading(true);
    fetch(`/api/rm/cost-heatmap?${qs}`)
      .then(r => r.json())
      .then(j => {
        const data = j.data;
        if (!data) { setTiles([]); return; }
        // Build a map of category slug → ticket total from ticketCategories
        const ticketMap = new Map<string, { name: string; total: number }>();
        for (const c of data.ticketCategories || []) ticketMap.set(c.slug, { name: c.name, total: c.total });
        // Cost from the invoice-driven categories list
        const costMap = new Map<string, number>();
        for (const c of data.categories || []) costMap.set(c.slug, c.total);
        const slugSet = new Set<string>();
        ticketMap.forEach((_, s) => slugSet.add(s));
        costMap.forEach((_, s) => slugSet.add(s));
        const arr: CategoryTile[] = [];
        slugSet.forEach(slug => {
          const t = ticketMap.get(slug);
          arr.push({
            slug,
            name:    t?.name || slug,
            tickets: t?.total || 0,
            cost:    costMap.get(slug) || 0,
          });
        });
        arr.sort((a, b) => b.tickets - a.tickets);
        setTiles(arr);
      })
      .catch(() => setTiles([]))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  const maxTickets = Math.max(1, ...tiles.map(t => t.tickets));
  const maxCost    = Math.max(1, ...tiles.map(t => t.cost));

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ChartIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>Category Analysis · pick a category to deep-dive</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); router.push('/login'); }}
                    className="text-xs text-white/60 hover:text-white px-2 py-1.5 rounded-md transition">
              Sign out
            </button>
          </div>
        </div>

        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <Link href="/dashboard/rm"                  className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">R&amp;M Cost</Link>
          <Link href="/dashboard/helpdesk"            className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Category Analysis</span>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <div className="bg-white border border-gray-200 rounded-md p-3 mb-4 text-[11px] text-gray-600">
          <span className="font-semibold uppercase tracking-wide text-gray-500 mr-2">Window</span>
          {dateFrom} → {dateTo} (YTD)
          <span className="float-right text-gray-400">Pick a category card to open the deep-dive</span>
        </div>

        {loading ? (
          <div className="text-center text-sm text-gray-400 py-12">Loading…</div>
        ) : tiles.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-12">No categories with activity in this window.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {tiles.map(t => (
              <Link key={t.slug} href={`/dashboard/category/${encodeURIComponent(t.slug)}`}
                    className="bg-white border border-gray-200 rounded-md p-4 hover:border-[#1e3a5f] hover:shadow-md transition-all">
                <div className="text-[13px] font-semibold text-gray-900 mb-3">{t.name}</div>
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">
                      <span>Tickets (YTD)</span>
                      <span className="text-gray-900 font-bold normal-case">{t.tickets.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                      <div className="h-full bg-[#3b82f6]" style={{ width: `${(t.tickets / maxTickets) * 100}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">
                      <span>Cost (YTD)</span>
                      <span className="text-gray-900 font-bold normal-case">{fmtCurrency(t.cost)}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                      <div className="h-full bg-[#dc2626]" style={{ width: `${(t.cost / maxCost) * 100}%` }} />
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-[#1e3a5f] mt-3">Open deep-dive →</div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
