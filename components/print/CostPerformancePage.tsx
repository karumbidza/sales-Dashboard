'use client';
// components/print/CostPerformancePage.tsx
// Page 1 — Cost Performance.
//   KPI strip (4 cards) + Pareto + Trend (with budget) + Top Movers callout.
import React from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell,
  LineChart, Legend, CartesianGrid,
} from 'recharts';
import type { ReportPayload } from '@/lib/buildReportPayload';
import { shortCategory } from '@/lib/categoryAbbrev';

interface Props {
  data: ReportPayload['cost'];
}

function fmtCurrency(n: number): string {
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

function fmtDelta(pct: number | null, goodDirection: 'up' | 'down'): { text: string; cls: string } {
  if (pct === null) return { text: '—', cls: 'kpi-dim' };
  const isUp = pct > 0;
  const arrow = isUp ? '▲' : pct < 0 ? '▼' : '•';
  const isGood = (isUp && goodDirection === 'up') || (!isUp && goodDirection === 'down');
  return {
    text: `${arrow} ${Math.abs(pct).toFixed(1)}%`,
    cls:  isGood ? 'kpi-good' : 'kpi-bad',
  };
}

const TIER_COLOR = ['#1e3a5f', '#3b82f6', '#93c5fd', '#cbd5e1'];

export default function CostPerformancePage({ data }: Props) {
  // Pareto: top 10 categories (already trimmed by buildReportPayload).
  const paretoData = data.pareto.slice(0, 10).map((p, i) => ({
    ...p,
    tier: p.cumulativePct <= 50 ? 0 : p.cumulativePct <= 80 ? 1 : p.cumulativePct <= 95 ? 2 : 3,
  }));

  // Merge trend: current + prior + budget into one array.
  const trendMerged = data.trend.current.map((p, i) => ({
    month:   p.month,
    current: p.value,
    prior:   data.trend.priorYear[i]?.value ?? 0,
    budget:  data.trend.budget[i]?.value    ?? 0,
  }));

  const ytdLy   = fmtDelta(data.ytd.vsLY,     'down');
  const ytdBud  = fmtDelta(data.ytd.vsBudget, 'down');
  const mtdLm   = fmtDelta(data.mtd.vsLM,     'down');
  const mtdBud  = fmtDelta(data.mtd.vsBudget, 'down');

  return (
    <div className="cp-wrap">
      {/* KPI strip */}
      <div className="cp-kpi-strip">
        <div className="cp-kpi">
          <div className="cp-kpi-label">YTD R&amp;M Cost</div>
          <div className="cp-kpi-value">{fmtCurrency(data.ytd.value)}</div>
          <div className="cp-kpi-sub">
            <span className={ytdLy.cls}>{ytdLy.text}</span> LY · <span className={ytdBud.cls}>{ytdBud.text}</span> Bud
          </div>
        </div>
        <div className="cp-kpi">
          <div className="cp-kpi-label">MTD R&amp;M Cost</div>
          <div className="cp-kpi-value">{fmtCurrency(data.mtd.value)}</div>
          <div className="cp-kpi-sub">
            <span className={mtdLm.cls}>{mtdLm.text}</span> LM · <span className={mtdBud.cls}>{mtdBud.text}</span> Bud
          </div>
        </div>
        <div className="cp-kpi">
          <div className="cp-kpi-label">Cost / Litre</div>
          <div className="cp-kpi-value">{fmtPerLitre(data.costPerLitre.value)}</div>
          <div className="cp-kpi-sub">
            fleet median: {fmtPerLitre(data.costPerLitre.fleetMedian)}
          </div>
        </div>
        <div className="cp-kpi">
          <div className="cp-kpi-label">Top Category</div>
          <div className="cp-kpi-value cp-kpi-cat">{data.topCategory?.name || '—'}</div>
          <div className="cp-kpi-sub">
            {data.topCategory
              ? `${fmtCurrency(data.topCategory.value)} · ${data.topCategory.pctOfTotal.toFixed(0)}% of total`
              : 'no data'}
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="cp-charts">
        <div className="cp-chart-card">
          <div className="cp-chart-title">COST PARETO</div>
          <div style={{ width: '100%', height: 220 }}>
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
                  {paretoData.map((p, i) => <Cell key={i} fill={TIER_COLOR[p.tier]} />)}
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="cumulativePct" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                <ReferenceLine yAxisId="right" y={80} stroke="#dc2626" strokeDasharray="4 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="cp-chart-card">
          <div className="cp-chart-title">COST TREND</div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendMerged} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 8 }} />
                <YAxis tick={{ fontSize: 8 }} tickFormatter={(v) => fmtCurrency(v)} />
                <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 8 }} iconSize={6} />
                <Line type="monotone" dataKey="current" name="Current" stroke="#1e3a5f" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="prior"   name="Prior"   stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 2" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="budget"  name="Budget"  stroke="#15803d" strokeWidth={1.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Movers callout */}
      <div className="cp-movers">
        <div className="cp-movers-col">
          <div className="cp-movers-title cp-movers-rising">Fastest Rising</div>
          {data.topMovers.rising.length === 0 ? (
            <div className="cp-movers-empty">no data</div>
          ) : (
            data.topMovers.rising.map(m => (
              <div key={m.siteCode} className="cp-mover-row">
                <span className="cp-mover-site">
                  <span className="cp-mover-code">{m.siteCode}</span> {m.siteName}
                </span>
                <span className="cp-mover-delta cp-bad">▲ +{fmtCurrency(m.delta)}</span>
              </div>
            ))
          )}
        </div>
        <div className="cp-movers-col">
          <div className="cp-movers-title cp-movers-falling">Fastest Falling</div>
          {data.topMovers.falling.length === 0 ? (
            <div className="cp-movers-empty">no data</div>
          ) : (
            data.topMovers.falling.map(m => (
              <div key={m.siteCode} className="cp-mover-row">
                <span className="cp-mover-site">
                  <span className="cp-mover-code">{m.siteCode}</span> {m.siteName}
                </span>
                <span className="cp-mover-delta cp-good">▼ {fmtCurrency(m.delta)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
