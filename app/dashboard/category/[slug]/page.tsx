// app/dashboard/category/[slug]/page.tsx
// Per-category technical deep-dive. Manager-focused view aimed at
// answering: why are tickets this high, what's costing this much,
// what are we doing wrong, what do we need to replace.
//
// Data: single fetch from /api/rm/category-deep-dive. Recommendations
// are deterministic rules — each item shows the trigger so a manager
// can audit it. No AI-generated insights here on purpose.
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import RMFilterBar, { defaultRMFilters, RMFilters } from '@/components/rm/RMFilterBar';

interface Kpi {
  ticketCount:   number;
  totalCost:     number;
  sitesAffected: number;
  mttrHours:     number | null;
  openPct:       number;
  prior:         { ticketCount: number; totalCost: number };
}
interface TrendPoint    { month: string; tickets: number; cost: number; }
interface SiteRow       { siteCode: string; siteName: string; tickets: number; cost: number; mttrHours: number | null; openCount: number; repeatFlag: boolean; }
interface DescriptionRow{ descriptionNorm: string; sampleSubject: string; count: number; pctOfCategory: number; }
interface ProviderRow   { provider: string; tickets: number; mttrHours: number | null; closedPct: number; }
interface StatusRow     { status: string; count: number; }
interface Recommendation {
  ruleId:   string;
  severity: 'high' | 'medium' | 'low';
  title:    string;
  detail:   string;
  trigger:  string;
  link?:    { label: string; href: string };
}
interface DeepDiveResponse {
  category:        { slug: string; name: string };
  window:          { dateFrom: string; dateTo: string; priorFrom: string; priorTo: string };
  kpi:             Kpi;
  trend:           TrendPoint[];
  sites:           SiteRow[];
  descriptions:    DescriptionRow[];
  providers:       ProviderRow[];
  statusMix:       StatusRow[];
  recommendations: Recommendation[];
}

const ChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-5" />
  </svg>
);

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function fmtNumber(n: number): string { return n.toLocaleString(); }
function pctChange(curr: number, prior: number): { text: string; up: boolean | null } {
  if (prior === 0) return { text: '—', up: null };
  const pct = ((curr - prior) / prior) * 100;
  return { text: `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`, up: pct >= 0 };
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 flex-1">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-[11px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

const SEV_STYLES: Record<Recommendation['severity'], { badge: string; left: string }> = {
  high:   { badge: 'bg-red-100 text-red-700',       left: 'border-l-red-500' },
  medium: { badge: 'bg-amber-100 text-amber-700',   left: 'border-l-amber-500' },
  low:    { badge: 'bg-gray-100 text-gray-700',     left: 'border-l-gray-400' },
};

export default function CategoryDeepDivePage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug   = params?.slug || '';
  const [filters, setFilters] = useState<RMFilters>(defaultRMFilters());
  const [data, setData] = useState<DeepDiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Notes — shared key with rm + helpdesk pages (same R&M Report).
  const notesKey = `rm-notes-${filters.dateFrom}-${filters.dateTo}`;
  const [notes, setNotes] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setNotes(localStorage.getItem(notesKey) || '');
  }, [notesKey]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (notes) localStorage.setItem(notesKey, notes);
    else localStorage.removeItem(notesKey);
  }, [notes, notesKey]);

  useEffect(() => {
    if (!slug) return;
    const qs = new URLSearchParams({
      slug,
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
    }).toString();
    setLoading(true);
    setError(null);
    fetch(`/api/rm/category-deep-dive?${qs}`)
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || r.statusText);
        return j;
      })
      .then(j => setData(j.data))
      .catch(e => { setError(e.message); setData(null); })
      .finally(() => setLoading(false));
  }, [slug, filters]);

  const trendChartData = useMemo(() => (data?.trend || []).map(t => ({ ...t })), [data]);
  const ticketDelta = data ? pctChange(data.kpi.ticketCount, data.kpi.prior.ticketCount) : null;
  const costDelta   = data ? pctChange(data.kpi.totalCost,   data.kpi.prior.totalCost)   : null;

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ChartIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>
                Category Deep Dive · {data?.category.name || slug}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => setNotesOpen(true)}
                    className="relative flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition">
              Notes
              {notes.trim() && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
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
        <div className="mb-3 text-[11px] text-gray-500">
          <Link href="/dashboard/category" className="hover:text-[#1e3a5f]">All categories</Link>
          <span className="mx-1.5">›</span>
          <span className="text-gray-800 font-medium">{data?.category.name || slug}</span>
        </div>

        <RMFilterBar value={filters} onChange={setFilters} />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-3 my-4">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="text-center text-sm text-gray-400 py-12">Loading deep-dive…</div>
        ) : data && (
          <>
            {/* Header KPI strip */}
            <div className="flex flex-wrap gap-[10px] mb-[10px]">
              <KpiTile label="Tickets in window" value={fmtNumber(data.kpi.ticketCount)}
                       sub={ticketDelta && <span className={ticketDelta.up === null ? 'text-gray-400' : ticketDelta.up ? 'text-red-600' : 'text-green-600'}>{ticketDelta.text} vs prior {data.window.priorFrom.slice(0, 7)} → {data.window.priorTo.slice(0, 7)}</span>} />
              <KpiTile label="Total spend" value={fmtCurrency(data.kpi.totalCost)}
                       sub={costDelta && <span className={costDelta.up === null ? 'text-gray-400' : costDelta.up ? 'text-red-600' : 'text-green-600'}>{costDelta.text} vs prior period</span>} />
              <KpiTile label="Sites affected" value={fmtNumber(data.kpi.sitesAffected)} />
              <KpiTile label="MTTR" value={data.kpi.mttrHours === null ? '—' : `${data.kpi.mttrHours}h`}
                       sub={<span className="text-gray-500">mean time to resolution</span>} />
              <KpiTile label="% Open" value={`${data.kpi.openPct}%`}
                       sub={<span className="text-gray-500">not closed or resolved</span>} />
            </div>

            {/* 12-month trend */}
            <div className="bg-white border border-gray-200 rounded-md p-3 mb-[10px]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-medium text-gray-800">12-month trend — tickets vs cost</div>
                <div className="text-[10px] text-gray-500">always last 12 months</div>
              </div>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trendChartData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="tickets" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="cost" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtCurrency(v)} />
                    <Tooltip formatter={(v: number, name: string) => name === 'cost' ? fmtCurrency(v) : `${v} tickets`} />
                    <Bar yAxisId="tickets" dataKey="tickets" fill="#3b82f6" />
                    <Line yAxisId="cost" type="monotone" dataKey="cost" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recommendations panel */}
            {data.recommendations.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-md p-3 mb-[10px]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-medium text-gray-800">Recommendations · {data.recommendations.length} items</div>
                  <div className="text-[10px] text-gray-500">deterministic rules · click trigger to audit</div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {data.recommendations.map((r, i) => (
                    <div key={`${r.ruleId}-${i}`} className={`border border-gray-200 border-l-4 ${SEV_STYLES[r.severity].left} rounded p-2.5`}>
                      <div className="flex items-start gap-2">
                        <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${SEV_STYLES[r.severity].badge}`}>
                          {r.severity}
                        </span>
                        <div className="flex-1">
                          <div className="text-[12px] font-semibold text-gray-900">{r.title}</div>
                          <div className="text-[11px] text-gray-700 mt-0.5">{r.detail}</div>
                          <div className="text-[10px] text-gray-500 italic mt-1">Rule: {r.trigger}</div>
                          {r.link && (
                            <Link href={r.link.href} className="inline-block text-[10px] text-[#1e3a5f] hover:underline mt-1">
                              {r.link.label} →
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Worst sites + Top failure modes */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-[10px] mb-[10px]">
              <div className="bg-white border border-gray-200 rounded-md p-3">
                <div className="text-[11px] font-medium text-gray-800 mb-2">Worst sites in window</div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                      <th className="text-left px-2 py-1">Site</th>
                      <th className="text-right px-2 py-1">Tickets</th>
                      <th className="text-right px-2 py-1">Cost</th>
                      <th className="text-right px-2 py-1">MTTR</th>
                      <th className="text-right px-2 py-1">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sites.slice(0, 12).map(s => (
                      <tr key={s.siteCode} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 text-gray-900 whitespace-nowrap">
                          <Link href={`/dashboard/helpdesk?siteCode=${encodeURIComponent(s.siteCode)}&category=${encodeURIComponent(slug)}`} className="hover:text-[#1e3a5f]">
                            <span className="font-mono text-[10px] text-gray-500 mr-1.5">{s.siteCode}</span>
                            {s.siteName}
                          </Link>
                          {s.repeatFlag && (
                            <span className="ml-2 text-[9px] uppercase tracking-wide font-semibold px-1 py-0.5 rounded bg-red-100 text-red-700">repeat</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium text-gray-900">{s.tickets}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700">{s.cost > 0 ? fmtCurrency(s.cost) : '—'}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700">{s.mttrHours === null ? '—' : `${s.mttrHours}h`}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700">{s.openCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-white border border-gray-200 rounded-md p-3">
                <div className="text-[11px] font-medium text-gray-800 mb-2">Top failure descriptions</div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                      <th className="text-left px-2 py-1">Subject</th>
                      <th className="text-right px-2 py-1">Tickets</th>
                      <th className="text-right px-2 py-1">% Cat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.descriptions.slice(0, 12).map(d => (
                      <tr key={d.descriptionNorm} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 text-gray-900">
                          <span title={d.descriptionNorm}>{d.sampleSubject.slice(0, 60)}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium text-gray-900">{d.count}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700">{d.pctOfCategory}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Contractor performance + Status mix */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-[10px] mb-[10px]">
              <div className="bg-white border border-gray-200 rounded-md p-3">
                <div className="text-[11px] font-medium text-gray-800 mb-2">Contractor performance</div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                      <th className="text-left px-2 py-1">Provider</th>
                      <th className="text-right px-2 py-1">Tickets</th>
                      <th className="text-right px-2 py-1">MTTR</th>
                      <th className="text-right px-2 py-1">Closed %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.providers.slice(0, 10).map(p => (
                      <tr key={p.provider} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 text-gray-900">{p.provider}</td>
                        <td className="px-2 py-1.5 text-right font-medium text-gray-900">{p.tickets}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700">{p.mttrHours === null ? '—' : `${p.mttrHours}h`}</td>
                        <td className="px-2 py-1.5 text-right text-gray-700">{p.closedPct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.providers.length === 1 && data.providers[0].provider === 'Unspecified' && (
                  <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                    No contractor data populated yet. Once <code>service_provider</code> is set in the helpdesk system, this panel becomes actionable.
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-md p-3">
                <div className="text-[11px] font-medium text-gray-800 mb-2">Status mix</div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                      <th className="text-left px-2 py-1">Status</th>
                      <th className="text-right px-2 py-1">Tickets</th>
                      <th className="text-right px-2 py-1">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.statusMix.map(s => {
                      const total = data.statusMix.reduce((a, b) => a + b.count, 0);
                      const pct = total > 0 ? (s.count / total * 100).toFixed(1) : '0';
                      return (
                        <tr key={s.status} className="border-t border-gray-100">
                          <td className="px-2 py-1.5 text-gray-900">{s.status}</td>
                          <td className="px-2 py-1.5 text-right font-medium text-gray-900">{s.count}</td>
                          <td className="px-2 py-1.5 text-right text-gray-700">{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      {notesOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
             onClick={() => setNotesOpen(false)}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl mx-4 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div>
                <div className="text-sm font-semibold text-gray-900">Report Notes</div>
                <div className="text-[11px] text-gray-500">saved locally per date window · shared with R&amp;M Cost + Helpdesk</div>
              </div>
              <button onClick={() => setNotesOpen(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2">×</button>
            </div>
            <div className="p-4">
              <textarea autoFocus value={notes} onChange={e => setNotes(e.target.value)}
                        placeholder="Notes on this category deep-dive…"
                        className="w-full text-sm border border-gray-200 rounded p-2 min-h-[200px] resize-y focus:outline-none focus:border-[#1e3a5f]" />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200 text-[11px] text-gray-500">
              <span>Window: {filters.dateFrom} → {filters.dateTo}</span>
              <button onClick={() => setNotesOpen(false)} className="text-xs font-medium px-3 py-1.5 rounded-md bg-[#1e3a5f] text-white hover:bg-[#16304f] transition">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
