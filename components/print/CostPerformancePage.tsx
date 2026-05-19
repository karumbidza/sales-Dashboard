'use client';
// components/print/CostPerformancePage.tsx
// Page 1 — Cost & Operational Snapshot.
//   4 cost tiles + 2 efficiency tiles + side-by-side Pareto / Trend
//   + Territory Snapshot strip.
import React from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer,
  Cell, CartesianGrid, LabelList,
} from 'recharts';
import type { ReportPayload } from '@/lib/buildReportPayload';
import { shortCategory } from '@/lib/categoryAbbrev';
import { Arrow } from './Arrow';
import { formatDelta } from '@/lib/format-delta';

interface Props {
  cost:       ReportPayload['cost'];
  efficiency: ReportPayload['efficiency'];
  territory:  ReportPayload['territory'];
}

function fmtCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
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

function fmtHours(n: number | null): string {
  if (n === null) return '—';
  return `${n.toFixed(1)}h`;
}

const PARETO_TIER_COLOR = ['#1e3a5f', '#3b82f6', '#93c5fd', '#cbd5e1'];

export default function CostPerformancePage({ cost, efficiency, territory }: Props) {
  // ── Pareto data ─────────────────────────────────────────────────
  const paretoData = cost.pareto.slice(0, 10).map(p => ({
    ...p,
    tier: p.cumulativePct <= 50 ? 0 : p.cumulativePct <= 80 ? 1 : p.cumulativePct <= 95 ? 2 : 3,
  }));
  const eightyIdx = paretoData.findIndex(p => p.cumulativePct >= 80);
  const paretoCaption = eightyIdx >= 0
    ? `${eightyIdx + 1} categories drive 80% of period spend`
    : `${paretoData.length} categories shown`;

  // ── Trend merged (bars for current year, lines for prior + budget) ─
  const trendMerged = cost.trend.current.map((p, i) => ({
    month:   p.month,
    current: p.value,
    prior:   cost.trend.priorYear[i]?.value ?? 0,
    budget:  cost.trend.budget[i]?.value    ?? 0,
  }));

  // ── Trend chart year labels — derived so they don't go stale at year rollover.
  const currentYearLabel = new Date().getFullYear();
  const priorYearLabel   = currentYearLabel - 1;

  // ── Cost-tile deltas ────────────────────────────────────────────
  const ytdLy   = formatDelta(cost.ytd.vsLY,     'down');
  const ytdBud  = formatDelta(cost.ytd.vsBudget, 'down');
  const mtdLm   = formatDelta(cost.mtd.vsLM,     'down');
  const mtdBud  = formatDelta(cost.mtd.vsBudget, 'down');
  // vsLM is a cents delta from the API (already in cents, not percent). Use 2 decimal precision.
  const cpLm    = formatDelta(cost.costPerLitre.vsLM, 'down', { decimals: 2 });

  // ── Efficiency-tile deltas ──────────────────────────────────────
  const respLm  = formatDelta(efficiency.ticketsOpened.vsLM, 'down');
  // Backlog vsLM are integer count deltas, not percents — treat them as deltas where
  // up = bad (more open). We render with custom magnitude (no decimal).
  const noActLm = formatDelta(efficiency.noActionOpen.vsLM, 'down', { decimals: 0 });
  const waitLm  = formatDelta(efficiency.waitingThirdParty.vsLM, 'down', { decimals: 0 });

  // ── Territory bar tiers (top 2 navy, next 2 blue) ───────────────
  const tmRows = territory.snapshot.slice(0, 5);

  return (
    <div className="cp-wrap">
      {/* ── COST PERFORMANCE lens ──────────────────────────────── */}
      <div className="cp-lens cp-lens-cost">COST PERFORMANCE</div>

      {/* 4 cost KPI tiles */}
      <div className="cp-kpi-strip">
        {/* YTD */}
        <div className="cp-kpi">
          <div className="cp-kpi-label">YTD R&amp;M Cost</div>
          <div className="cp-kpi-value">{fmtCurrency(cost.ytd.value)}</div>
          <div className="cp-kpi-sub">
            <span className={ytdLy.cls}><Arrow direction={ytdLy.direction} />{ytdLy.magnitude}%</span> LY
            {' · '}
            <span className={ytdBud.cls}><Arrow direction={ytdBud.direction} />{ytdBud.magnitude}%</span> Bud
          </div>
        </div>

        {/* MTD */}
        <div className="cp-kpi">
          <div className="cp-kpi-label">MTD R&amp;M Cost</div>
          <div className="cp-kpi-value">{fmtCurrency(cost.mtd.value)}</div>
          <div className="cp-kpi-sub">
            <span className={mtdLm.cls}><Arrow direction={mtdLm.direction} />{mtdLm.magnitude}%</span> LM
            {' · '}
            <span className={mtdBud.cls}><Arrow direction={mtdBud.direction} />{mtdBud.magnitude}%</span> Bud
          </div>
        </div>

        {/* Cost / Litre */}
        <div className="cp-kpi">
          <div className="cp-kpi-label">Cost / Litre</div>
          <div className="cp-kpi-value">{fmtPerLitre(cost.costPerLitre.value)}</div>
          <div className="cp-kpi-sub">
            <span className={cpLm.cls}><Arrow direction={cpLm.direction} />{cpLm.magnitude}¢</span> vs LM
          </div>
        </div>

        {/* Top Category · MTD with top-3 contributors */}
        <div className="cp-kpi">
          <div className="cp-kpi-label">Top Category · MTD</div>
          <div className="cp-kpi-value cp-kpi-cat">{cost.topCategory?.name || '—'}</div>
          <div className="cp-kpi-sub">
            {cost.topCategory
              ? `${fmtCurrency(cost.topCategory.value)} · ${cost.topCategory.pctOfTotal.toFixed(0)}% of MTD`
              : 'no data'}
          </div>
          {cost.topCategory && cost.topCategory.contributors.length > 0 && (
            <>
              <div className="cp-tile-divider" />
              <div className="cp-contrib-label">Top contributors</div>
              <div className="cp-contrib-list">
                {cost.topCategory.contributors.map(c => (
                  <div key={c.rank} className="cp-contrib-row">
                    <span className="cp-contrib-rank">{c.rank}</span>
                    <span className="cp-contrib-site">{c.siteName}</span>
                    <span className="cp-contrib-detail">{fmtCurrency(c.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── OPERATIONAL EFFICIENCY lens ────────────────────────── */}
      <div className="cp-lens cp-lens-eff">OPERATIONAL EFFICIENCY</div>

      {/* 2 efficiency tiles (two-metric layout) */}
      <div className="cp-eff-strip">
        {/* Tile 5: Tickets Opened + Avg Response */}
        <div className="cp-eff-tile">
          <div className="cp-eff-row">
            <div className="cp-eff-metric-left">
              <div className="cp-eff-metric-label">Tickets Opened · MTD</div>
              <div className="cp-eff-metric-value-big">{efficiency.ticketsOpened.value}</div>
            </div>
            <div className="cp-eff-metric-right">
              <div className="cp-eff-metric-label">Avg Response</div>
              <div className="cp-eff-metric-value-sm">{fmtHours(efficiency.ticketsOpened.avgResponseHours)}</div>
              <div className="cp-eff-metric-sub">
                <span className={respLm.cls}>
                  <Arrow direction={respLm.direction} />{respLm.magnitude}h
                </span> LM
              </div>
            </div>
          </div>
          <div className="cp-tile-divider" />
          <div className="cp-contrib-label">Top contributing sites</div>
          <div className="cp-contrib-list">
            {efficiency.ticketsOpened.contributors.length === 0 ? (
              <div className="cp-contrib-row"><span className="cp-contrib-site" style={{ fontStyle: 'italic', color: '#94a3b8', fontWeight: 400 }}>no tickets in period</span></div>
            ) : (
              efficiency.ticketsOpened.contributors.map(c => (
                <div key={c.rank} className="cp-contrib-row">
                  <span className="cp-contrib-rank">{c.rank}</span>
                  <span className="cp-contrib-site">{c.siteName}</span>
                  <span className="cp-contrib-detail">{c.count} tickets</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tile 6: Backlog Health (no-action + waiting) */}
        <div className="cp-eff-tile">
          <div className="cp-eff-row">
            <div className="cp-eff-metric-left">
              <div className="cp-eff-metric-label">No-Action Open</div>
              <div className="cp-eff-metric-value-big">{efficiency.noActionOpen.value}</div>
              <div className="cp-eff-metric-sub">
                <span className={noActLm.cls}>
                  <Arrow direction={noActLm.direction} />{noActLm.magnitude}
                </span> LM
              </div>
            </div>
            <div className="cp-eff-metric-right">
              <div className="cp-eff-metric-label">Waiting 3rd Party</div>
              <div className="cp-eff-metric-value-sm">{efficiency.waitingThirdParty.value}</div>
              <div className="cp-eff-metric-sub">
                <span className={waitLm.cls}>
                  <Arrow direction={waitLm.direction} />{waitLm.magnitude}
                </span> LM
              </div>
            </div>
          </div>
          <div className="cp-tile-divider" />
          <div className="cp-contrib-label">Most un-actioned sites</div>
          <div className="cp-contrib-list">
            {efficiency.noActionOpen.oldestSites.length === 0 ? (
              <div className="cp-contrib-row"><span className="cp-contrib-site" style={{ fontStyle: 'italic', color: '#94a3b8', fontWeight: 400 }}>no open backlog</span></div>
            ) : (
              efficiency.noActionOpen.oldestSites.map(s => (
                <div key={s.rank} className="cp-contrib-row">
                  <span className="cp-contrib-rank">{s.rank}</span>
                  <span className="cp-contrib-site">{s.siteName}</span>
                  <span className="cp-contrib-detail">
                    {s.openCount} open{s.staleCount > 0 ? ` · ${s.staleCount} >30d` : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Charts row (Pareto + Trend, side by side) ──────────── */}
      <div className="cp-charts">
        <div className="cp-chart-card">
          <div className="cp-chart-header">
            <div className="cp-chart-title">Cost Pareto · by category</div>
            <div className="cp-chart-meta">MTD</div>
          </div>
          <div style={{ width: '100%', height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={paretoData} margin={{ top: 6, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 7 }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                  tickFormatter={(v: string) => shortCategory(v)}
                />
                <YAxis yAxisId="left"  tick={{ fontSize: 8 }} tickFormatter={(v) => fmtCurrency(v)} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 8 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Bar yAxisId="left" dataKey="value" isAnimationActive={false}>
                  {paretoData.map((p, i) => <Cell key={i} fill={PARETO_TIER_COLOR[p.tier]} />)}
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="cumulativePct" stroke="#dc2626" strokeWidth={1.6} dot={{ r: 2 }} isAnimationActive={false} />
                <ReferenceLine yAxisId="right" y={80} stroke="#dc2626" strokeDasharray="4 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{ fontSize: 8, color: '#64748b', marginTop: 2 }}>{paretoCaption}</div>
        </div>

        <div className="cp-chart-card">
          <div className="cp-chart-header">
            <div className="cp-chart-title">Cost Trend · monthly</div>
            <div className="cp-chart-meta">
              <span style={{ background: '#1e3a5f', display: 'inline-block', width: 6, height: 6, marginRight: 3, verticalAlign: '-0px' }} />
              {currentYearLabel} &nbsp;
              <span style={{ borderTop: '1px dashed #94a3b8', display: 'inline-block', width: 8, marginRight: 3, verticalAlign: '2px' }} />
              {priorYearLabel} &nbsp;
              <span style={{ borderTop: '1px dashed #15803d', display: 'inline-block', width: 8, marginRight: 3, verticalAlign: '2px' }} />
              Bud
            </div>
          </div>
          <div style={{ width: '100%', height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendMerged} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 8 }} />
                <YAxis tick={{ fontSize: 8 }} tickFormatter={(v) => fmtCurrency(v)} />
                <Bar dataKey="current" fill="#1e3a5f" isAnimationActive={false} maxBarSize={22}>
                  <LabelList dataKey="current" position="top" className="cp-trend-bar-label"
                             formatter={(v: number) => v > 0 ? fmtCurrency(v) : ''} />
                </Bar>
                <Line type="monotone" dataKey="prior"  stroke="#94a3b8" strokeWidth={1.3} strokeDasharray="3 2" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="budget" stroke="#15803d" strokeWidth={1.3} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Territory Snapshot ─────────────────────────────────── */}
      <div className="cp-territory">
        <div className="cp-territory-header">
          <div className="cp-territory-title">Territory Snapshot · MTD spend &amp; YoY</div>
          <div className="cp-territory-sub">By Territory Manager</div>
        </div>
        {tmRows.length === 0 ? (
          <div style={{ fontSize: 8, color: '#94a3b8', fontStyle: 'italic' }}>no territory data in period</div>
        ) : (
          tmRows.map((tm, i) => {
            const barClass = i < 2 ? 'cp-territory-bar-1' : 'cp-territory-bar-2';
            const yoy = formatDelta(tm.yoyPct, 'down', { flatThreshold: 1 });
            return (
              <div key={tm.tmName} className="cp-territory-row">
                <span className="cp-territory-tm">{tm.tmName}</span>
                <span className="cp-territory-bar-track">
                  <span className={`cp-territory-bar ${barClass}`} style={{ width: `${tm.barPctOfMax}%` }} />
                </span>
                <span className="cp-territory-spend">{fmtCurrency(tm.mtdSpend)}</span>
                <span className={`cp-territory-yoy ${yoy.cls}`}>
                  <Arrow direction={yoy.direction} />{yoy.magnitude}% YoY
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
