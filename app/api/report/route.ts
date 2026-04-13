// app/api/report/route.ts
// Generates a structured PDF report using Puppeteer (headless Chrome)
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { GET as kpisHandler } from '@/app/api/kpis/route';
import { GET as topSitesHandler } from '@/app/api/top-sites/route';
import { GET as territoriesHandler } from '@/app/api/territory-performance/route';
import { GET as trendHandler } from '@/app/api/sales-trend/route';
import { GET as yearlyHandler } from '@/app/api/yearly-volume-vs-budget/route';
import { GET as unmatchedHandler } from '@/app/api/unmatched-rows/route';

export const dynamic = 'force-dynamic';

// ── HTML escape — prevents XSS in generated reports ─────────────────────────
function esc(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Generates the HTML that Puppeteer will render ────────────────────────────
function buildReportHTML(data: any): string {
  const { meta, kpis, topSites, territories, margin, breakdown, comments } = data;
  const fmtVol  = (n: number | null | undefined) =>
    n == null ? '—' : Math.round(Number(n)).toLocaleString('en');
  const fmtRev  = (n: number | null | undefined) => {
    if (n == null) return '—';
    const v = Number(n);
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  };
  const fmtVar  = (pct: number | null | undefined) => {
    if (pct == null || !Number.isFinite(Number(pct))) return '—';
    const diff = Number(pct) - 100;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toFixed(1)}%`;
  };
  const varColor = (pct: number | null | undefined) => {
    if (pct == null) return '#6b7280';
    if (pct >= 100) return '#16a34a';
    if (pct >= 85)  return '#d97706';
    return '#dc2626';
  };
  const fmtPeriod = (iso: string) => {
    if (!iso) return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${m[3]} ${months[parseInt(m[2],10)-1]} ${m[1]}`;
  };

  // ── Inline SVG icons (mirror components/KPICards.tsx) ─────────────────────
  const ICONS: Record<string, string> = {
    barrel:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v14M19 5v14"/><ellipse cx="12" cy="19" rx="7" ry="3"/><path d="M5 12h14"/></svg>`,
    chart:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    target:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    trending:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    lightning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    dollar:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    handshake: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 7.65l1.06 1.06L12 21.23l7.77-7.77 1.06-1.06a5.4 5.4 0 0 0-.41-7.82z"/></svg>`,
    cash:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    store:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 9l1-5h16l1 5"/><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/><path d="M5 21V9M19 21V9M5 21h14"/></svg>`,
    calendar:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  };

  const badgeClass = (pct: number | null | undefined): string => {
    if (pct == null) return 'b-gray';
    if (pct >= 100) return 'b-green';
    if (pct >= 85)  return 'b-amber';
    return 'b-red';
  };
  const growthClass = (n: number | null | undefined): string =>
    n == null ? 'g-gray' : n >= 0 ? 'g-green' : 'g-red';
  const growthArrow = (n: number) => n >= 0 ? '▲' : '▼';

  // ── Inline SVG: stacked daily volume bar chart ─────────────────────────
  // Daily Volume Trend — matches dashboard SalesTrendChart exactly:
  // stacked bars (diesel/blend/ULP) + total line + budget/stretch lines + colored dots
  const dailyChartSVG = (rows: any[], info: { year: number; month: number; monthEndDay: number }): string => {
    const W = 1200, H = 280, P = { l: 52, r: 16, t: 10, b: 44 };
    const innerW = W - P.l - P.r;
    const innerH = H - P.t - P.b;
    const totalDays = info.monthEndDay;
    if (!rows || rows.length === 0 || totalDays <= 0) {
      return `<svg viewBox="0 0 ${W} ${H}" width="100%">
        <text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="11" fill="#9ca3af">No daily data</text>
      </svg>`;
    }

    const DIESEL = '#1e40af', BLEND = '#0891b2', ULP = '#059669';
    const TOTAL = '#6366f1', BUDGET_C = '#f59e0b', STRETCH_C = '#dc2626';
    const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    const monthlyBudget  = rows[0]?.budget_volume  ?? 0;
    const monthlyStretch = rows[0]?.stretch_volume ?? 0;
    const dailyRate      = totalDays > 0 ? monthlyBudget  / totalDays : 0;
    const dailyStretch   = totalDays > 0 ? monthlyStretch / totalDays : 0;

    // Map data by day-of-month
    interface DayData { total: number; diesel: number; blend: number; ulp: number; }
    const byDay: Record<number, DayData> = {};
    let lastDayWithData = 0;
    for (const r of rows) {
      const d = parseInt(String(r.date || r.period || '').slice(8, 10), 10);
      if (!Number.isFinite(d) || d < 1 || d > totalDays) continue;
      const total = Number(r?.actual_volume || 0);
      byDay[d] = {
        total,
        diesel: Number(r?.diesel_volume || 0),
        blend:  Number(r?.blend_volume  || 0),
        ulp:    Number(r?.ulp_volume    || 0),
      };
      if (total > 0 && d > lastDayWithData) lastDayWithData = d;
    }

    const avgDaily = (() => {
      const vals = Object.values(byDay).filter(v => v.total > 0).map(v => v.total);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    })();

    const xStep = innerW / totalDays;
    const barW  = Math.max(3, xStep * 0.6);
    const allTotals = Object.values(byDay).map(v => v.total);
    const yMax = Math.max(...allTotals, dailyRate, dailyStretch, avgDaily) * 1.15 || 1;
    const yScale = (v: number) => P.t + innerH - (v / yMax) * innerH;
    const barH = (v: number) => (v / yMax) * innerH;

    // Grid lines + Y ticks
    const grid: string[] = [];
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4;
      const y = P.t + innerH - (innerH * i) / 4;
      const lbl = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
                : v >= 1_000     ? `${Math.round(v / 1_000)}K`
                : Math.round(v).toString();
      grid.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="#f0f0f0" stroke-dasharray="3 3"/>`);
      grid.push(`<text x="${P.l - 6}" y="${y + 4}" text-anchor="end" font-size="9.5" fill="#9ca3af">${lbl}</text>`);
    }

    const bars: string[] = [];
    const dots: string[] = [];
    const xLbls: string[] = [];
    const totalLine: string[] = [];
    const projLine: string[] = [];
    for (let day = 1; day <= totalDays; day++) {
      const cx = P.l + xStep * (day - 0.5);
      const dd = byDay[day];
      const dt = new Date(info.year, info.month - 1, day);
      const wd = WEEKDAYS[dt.getDay()];

      if (dd && dd.total > 0) {
        // Stacked bars: diesel (bottom) → blend (middle) → ULP (top)
        const bx = cx - barW / 2;
        let stackY = yScale(0); // baseline

        if (dd.diesel > 0) {
          const h = barH(dd.diesel);
          stackY -= h;
          bars.push(`<rect x="${bx}" y="${stackY}" width="${barW}" height="${h}" fill="${DIESEL}" rx="1"/>`);
        }
        if (dd.blend > 0) {
          const h = barH(dd.blend);
          stackY -= h;
          bars.push(`<rect x="${bx}" y="${stackY}" width="${barW}" height="${h}" fill="${BLEND}" rx="1"/>`);
        }
        if (dd.ulp > 0) {
          const h = barH(dd.ulp);
          stackY -= h;
          bars.push(`<rect x="${bx}" y="${stackY}" width="${barW}" height="${h}" fill="${ULP}" rx="1"/>`);
        }

        // Total line point
        const cy = yScale(dd.total);
        totalLine.push(`${cx},${cy}`);

        // Dot — color by budget/stretch achievement
        const metStretch = dailyStretch > 0 && dd.total >= dailyStretch;
        const metBudget  = dailyRate > 0 && dd.total >= dailyRate;
        const fill   = metStretch ? '#16a34a' : metBudget ? '#84cc16' : '#ffffff';
        const stroke = metStretch || metBudget ? '#ffffff' : TOTAL;
        const radius = metStretch ? 5.5 : metBudget ? 5 : 4;
        dots.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>`);
      }

      // Projection line from last data day through month end
      if (day >= lastDayWithData && avgDaily > 0) {
        projLine.push(`${cx},${yScale(avgDaily)}`);
      }

      // X-axis label — every day, like the dashboard
      xLbls.push(`<text x="${cx}" y="${H - 22}" text-anchor="middle" font-size="8.5" font-weight="600" fill="#374151">${wd}</text>`);
      xLbls.push(`<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="8.5" fill="#6b7280">${String(day).padStart(2,'0')}</text>`);
    }

    const budgetLine = dailyRate > 0
      ? `<line x1="${P.l}" x2="${W - P.r}" y1="${yScale(dailyRate)}" y2="${yScale(dailyRate)}" stroke="${BUDGET_C}" stroke-width="2" stroke-dasharray="5 5"/>`
      : '';
    const stretchLine = dailyStretch > 0
      ? `<line x1="${P.l}" x2="${W - P.r}" y1="${yScale(dailyStretch)}" y2="${yScale(dailyStretch)}" stroke="${STRETCH_C}" stroke-width="1.5" stroke-dasharray="3 3"/>`
      : '';
    const projSvg = projLine.length > 1
      ? `<polyline points="${projLine.join(' ')}" fill="none" stroke="#a5b4fc" stroke-width="1.5" stroke-dasharray="4 4"/>`
      : '';

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%">
        ${grid.join('')}
        ${bars.join('')}
        ${budgetLine}
        ${stretchLine}
        ${projSvg}
        <polyline points="${totalLine.join(' ')}" fill="none" stroke="${TOTAL}" stroke-width="2.5"/>
        ${dots.join('')}
        ${xLbls.join('')}
      </svg>
    `;
  };

  // Compact stats line (daily budget · daily stretch · met budget X/N days)
  const dailyChartStats = (rows: any[], info: { monthEndDay: number }): string => {
    const monthlyBudget  = rows?.[0]?.budget_volume  ?? 0;
    const monthlyStretch = rows?.[0]?.stretch_volume ?? 0;
    const dailyRate      = info.monthEndDay > 0 ? monthlyBudget  / info.monthEndDay : 0;
    const dailyStretch   = info.monthEndDay > 0 ? monthlyStretch / info.monthEndDay : 0;
    const days = (rows || []).filter((d: any) => Number(d?.actual_volume || 0) > 0);
    const metBudget  = dailyRate    > 0 ? days.filter((d: any) => Number(d.actual_volume) >= dailyRate).length : 0;
    const metStretch = dailyStretch > 0 ? days.filter((d: any) => Number(d.actual_volume) >= dailyStretch).length : 0;
    const parts: string[] = [];
    if (dailyRate > 0)    parts.push(`daily budget ${Math.round(dailyRate).toLocaleString('en')} L`);
    if (dailyStretch > 0) parts.push(`daily stretch ${Math.round(dailyStretch).toLocaleString('en')} L`);
    if (dailyRate > 0)    parts.push(`met budget ${metBudget}/${days.length} days`);
    if (dailyStretch > 0) parts.push(`met stretch ${metStretch}/${days.length} days`);
    return parts.join(' · ');
  };

  // Legend row for the daily volume chart (rendered as HTML below the SVG)
  const dailyChartLegend = (rows: any[], info: { monthEndDay: number }): string => {
    const monthlyBudget  = rows?.[0]?.budget_volume  ?? 0;
    const monthlyStretch = rows?.[0]?.stretch_volume ?? 0;
    const dailyRate      = info.monthEndDay > 0 ? monthlyBudget  / info.monthEndDay : 0;
    const dailyStretch   = info.monthEndDay > 0 ? monthlyStretch / info.monthEndDay : 0;
    const bar = (color: string) =>
      `<span style="display:inline-block;width:8px;height:8px;background:${color};border-radius:1px;margin-right:4px;vertical-align:middle"></span>`;
    const line = (color: string, dashed = false) =>
      `<span style="display:inline-block;width:14px;height:0;border-top:2px ${dashed ? 'dashed' : 'solid'} ${color};vertical-align:middle;margin-right:4px"></span>`;
    const dot = (fill: string, stroke: string) =>
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${fill};border:1.5px solid ${stroke};margin-right:4px;vertical-align:middle"></span>`;
    return `
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:5px;font-size:8.5px;color:#374151">
        <span>${bar('#1e40af')}Diesel</span>
        <span>${bar('#0891b2')}Blend</span>
        <span>${bar('#059669')}ULP</span>
        <span>${line('#6366f1')}Total</span>
        <span>${line('#f59e0b', true)}Budget${dailyRate > 0 ? ` (${Math.round(dailyRate).toLocaleString('en')} L)` : ''}</span>
        <span>${line('#dc2626', true)}Stretch${dailyStretch > 0 ? ` (${Math.round(dailyStretch).toLocaleString('en')} L)` : ''}</span>
        <span style="color:#9ca3af">·</span>
        <span>${dot('#16a34a','#fff')}Met stretch</span>
        <span>${dot('#84cc16','#fff')}Met budget</span>
        <span>${dot('#fff','#6366f1')}Below</span>
      </div>
    `;
  };

  // ── Territory Scorecard (HTML grid, mirrors dashboard component) ───────
  const territoryScorecardHTML = (terrs: any[]): string => {
    if (!terrs || terrs.length === 0) {
      return `<div style="text-align:center;color:#9ca3af;font-size:11px;padding:24px">No territory data</div>`;
    }
    const fmtVolCompact = (n: number | null | undefined): string => {
      if (n == null || !Number.isFinite(Number(n))) return '—';
      const v = Number(n);
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
      if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K`;
      return Math.round(v).toLocaleString('en');
    };
    // Only show key territories in the report
  const REPORT_TERRITORIES = ['brendon', 'tendai', 'saliya'];
  const filtered = terrs.filter(t => {
    const name = String(t.territoryName || t.territoryCode || '').toLowerCase();
    return REPORT_TERRITORIES.some(rt => name.includes(rt));
  });
  const sorted = [...(filtered.length > 0 ? filtered : terrs)].sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0));
    const shortName = (t: any) =>
      String(t.territoryName || t.territoryCode || '?').replace(/'s Territory$/i, '').replace(/\sTerritory$/i, '');
    const varColor = (pct: number | null | undefined) =>
      pct == null ? '#9ca3af' : pct >= 100 ? '#16a34a' : pct >= 85 ? '#d97706' : '#dc2626';
    const growthColor = (n: number | null | undefined) =>
      n == null ? '#9ca3af' : n >= 0 ? '#16a34a' : '#dc2626';

    const cards = sorted.map((t: any) => {
      const volume   = Number(t.volume)        || 0;
      const budget   = Number(t.budgetVolume)  || 0;
      const stretch  = Number(t.stretchVolume) || 0;
      const prior    = Number(t.priorVolume)   || 0;
      const dieselV  = Number(t.dieselVol)     || 0;
      const petrolV  = (Number(t.blendVol) || 0) + (Number(t.ulpVol) || 0);
      const products = dieselV + petrolV;

      const max = Math.max(volume, stretch * 1.05, 1);
      const actualPct  = (volume  / max) * 100;
      const budgetPct  = (budget  / max) * 100;
      const stretchPct = (stretch / max) * 100;
      const fill =
        budget > 0 && volume >= stretch        ? '#10b981' :
        budget > 0 && volume >= budget         ? '#84cc16' :
        budget > 0 && volume >= 0.85 * budget  ? '#f59e0b' :
        '#ef4444';

      const vsBud = t.vsBudgetPct  != null ? Number(t.vsBudgetPct)  - 100 : null;
      const vsStr = t.vsStretchPct != null ? Number(t.vsStretchPct) - 100 : null;
      const fmtDelta = (n: number | null) =>
        n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

      const arrow = t.growthPct != null
        ? `<span style="font-size:10px;font-weight:700;color:${growthColor(t.growthPct)}">
             ${Number(t.growthPct) >= 0 ? '▲' : '▼'} ${Math.abs(Number(t.growthPct)).toFixed(1)}%
           </span>`
        : '';

      return `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
            <div>
              <h3 style="font-size:11px;font-weight:700;color:#0f172a;line-height:1.1;margin:0">${esc(shortName(t))}</h3>
              <p style="font-size:8px;color:#9ca3af;margin:1px 0 0">${t.siteCount ?? 0} sites${t.contributionPct != null ? ` · ${Number(t.contributionPct).toFixed(1)}%` : ''}</p>
            </div>
            ${arrow}
          </div>

          <p style="font-size:18px;font-weight:700;color:#0f172a;line-height:1;margin:1px 0 0;font-variant-numeric:tabular-nums">
            ${fmtVolCompact(volume)} <span style="font-size:10px;font-weight:500;color:#9ca3af">L</span>
          </p>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px;margin-top:4px;font-size:8px;font-variant-numeric:tabular-nums">
            <div>
              <p style="color:#9ca3af;text-transform:uppercase;letter-spacing:0.3px;font-weight:700;font-size:7px;margin:0">Budget</p>
              <p style="color:#374151;font-family:monospace;margin:0">${fmtVolCompact(budget)} L</p>
            </div>
            <div>
              <p style="color:#9ca3af;text-transform:uppercase;letter-spacing:0.3px;font-weight:700;font-size:7px;margin:0">Stretch</p>
              <p style="color:#374151;font-family:monospace;margin:0">${fmtVolCompact(stretch)} L</p>
            </div>
            <div>
              <p style="color:#9ca3af;text-transform:uppercase;letter-spacing:0.3px;font-weight:700;font-size:7px;margin:0">Prior</p>
              <p style="color:#374151;font-family:monospace;margin:0">${fmtVolCompact(prior)} L</p>
            </div>
          </div>

          <div style="position:relative;width:100%;height:6px;background:#f3f4f6;border-radius:3px;margin:5px 0;overflow:hidden">
            <div style="position:absolute;top:0;left:0;height:100%;width:${actualPct}%;background:${fill};border-radius:3px"></div>
            ${budget  > 0 ? `<div style="position:absolute;top:-2px;height:10px;width:1.5px;background:#f59e0b;left:${budgetPct}%"></div>`  : ''}
            ${stretch > 0 ? `<div style="position:absolute;top:-2px;height:10px;width:1.5px;background:#f43f5e;left:${stretchPct}%"></div>` : ''}
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px">
            <div style="border:1px solid #f3f4f6;background:#f9fafb;border-radius:4px;padding:3px 6px">
              <p style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;color:#6b7280;margin:0">Vs Budget</p>
              <p style="font-size:11px;font-weight:700;color:${varColor(t.vsBudgetPct)};margin:0;font-variant-numeric:tabular-nums">${fmtDelta(vsBud)}</p>
            </div>
            <div style="border:1px solid #f3f4f6;background:#f9fafb;border-radius:4px;padding:3px 6px">
              <p style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;color:#6b7280;margin:0">Vs Stretch</p>
              <p style="font-size:11px;font-weight:700;color:${varColor(t.vsStretchPct)};margin:0;font-variant-numeric:tabular-nums">${fmtDelta(vsStr)}</p>
            </div>
          </div>

          <div style="font-size:8.5px;line-height:1.5">
            <div style="display:flex;justify-content:space-between"><span style="color:#6b7280">Avg daily</span><span style="font-family:monospace;color:#1f2937">${fmtVol(t.avgDaily)} L</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#6b7280">Avg price</span><span style="font-family:monospace;color:#1f2937">${t.avgPrice != null ? `$${Number(t.avgPrice).toFixed(2)}/L` : '—'}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#6b7280">Cash ratio</span><span style="font-family:monospace;color:#1f2937">${t.cashRatioPct != null ? `${Number(t.cashRatioPct).toFixed(1)}%` : '—'}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#6b7280">Net margin</span><span style="font-family:monospace;color:#1f2937">${t.netMarginCpl != null ? `$${(Number(t.netMarginCpl) / 100).toFixed(2)}/L` : '—'}</span></div>
          </div>

          ${products > 0 ? `
          <div style="margin-top:5px;padding-top:5px;border-top:1px solid #f3f4f6">
            <p style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;color:#6b7280;margin:0 0 2px">Product mix</p>
            <div style="display:flex;height:4px;border-radius:2px;overflow:hidden;background:#f3f4f6">
              <div style="background:#1d4ed8;width:${(dieselV / products) * 100}%"></div>
              <div style="background:#0891b2;width:${(petrolV / products) * 100}%"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:7px;color:#6b7280;margin-top:1px;font-variant-numeric:tabular-nums">
              <span>Diesel ${((dieselV / products) * 100).toFixed(0)}%</span>
              <span>Petrol ${((petrolV / products) * 100).toFixed(0)}%</span>
            </div>
          </div>` : ''}
        </div>
      `;
    }).join('');

    return `<div style="display:grid;grid-template-columns:repeat(${Math.min(sorted.length, 4)},1fr);gap:8px">${cards}</div>`;
  };

  // ── Inline SVG: territory donut ────────────────────────────────────────
  // Yearly Volume vs Budget vs Last Year — three grouped bars per month,
  // matches the dashboard chart 1:1 (vs-budget % above completed months,
  // softer styling for future months, dashed today divider).
  const yearlyVolumeBudgetSVG = (rows: any[], year: number, priorYear: number): string => {
    const W = 960, H = 280;
    const P = { l: 48, r: 12, t: 22, b: 28 };
    const innerW = W - P.l - P.r;
    const innerH = H - P.t - P.b;

    if (!rows || rows.length === 0) {
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="11" fill="#9ca3af">No data</text>
      </svg>`;
    }

    // Y scale based on max across all three series
    const allVals: number[] = [];
    rows.forEach((r: any) => {
      if (r.actualCY?.total != null) allVals.push(r.actualCY.total);
      if (r.actualPY?.total != null) allVals.push(r.actualPY.total);
      if (r.budgetCY    != null)     allVals.push(r.budgetCY);
    });
    const yMax = Math.max(...allVals, 1) * 1.1;

    const yScale = (v: number) => P.t + innerH - (v / yMax) * innerH;
    const groupW = innerW / 12;
    const barGap = 2;
    const barW   = (groupW - 2 * barGap - 6) / 3;

    // Y-axis ticks (5 levels)
    const yTicks: string[] = [];
    for (let i = 0; i <= 4; i++) {
      const v = yMax * (i / 4);
      const y = yScale(v);
      const label = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
                  : v >= 1_000     ? `${Math.round(v / 1_000)}K`
                  : Math.round(v).toString();
      yTicks.push(`
        <line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}"
              stroke="#f1f5f9" stroke-dasharray="3 3"/>
        <text x="${P.l - 6}" y="${y + 3}" text-anchor="end"
              font-size="9" fill="#9ca3af">${label}</text>
      `);
    }

    // Find last completed month index for the today divider
    let lastCompletedIdx = -1;
    rows.forEach((r: any, i: number) => { if (!r.isFuture) lastCompletedIdx = i; });

    // Bars
    const COLORS = { actualCY: '#1e40af', budgetCY: '#f59e0b', actualPY: '#94a3b8' };
    const bars: string[] = [];
    const labels: string[] = [];

    rows.forEach((r: any, i: number) => {
      const groupX = P.l + i * groupW + 3;
      const cx = groupX + groupW / 2;

      const cyVal  = r.actualCY?.total ?? null;
      const budVal = r.budgetCY ?? null;
      const pyVal  = r.actualPY?.total ?? null;

      const cyOpacity  = r.isFuture ? 0   : 1;
      const refOpacity = r.isFuture ? 0.45 : 1;

      // Actual CY bar
      if (cyVal != null && cyOpacity > 0) {
        const y = yScale(cyVal);
        const h = (P.t + innerH) - y;
        bars.push(`<rect x="${groupX}" y="${y}" width="${barW}" height="${h}"
                         fill="${COLORS.actualCY}" rx="2"/>`);

        // vs-budget % label above the bar
        if (budVal != null && budVal > 0) {
          const pct = ((cyVal - budVal) / budVal) * 100;
          const color = pct >= 0 ? '#16a34a' : '#dc2626';
          const sign  = pct >= 0 ? '+' : '';
          labels.push(`<text x="${groupX + barW / 2}" y="${y - 4}" text-anchor="middle"
                            font-size="9" font-weight="700" fill="${color}">${sign}${pct.toFixed(1)}%</text>`);
        }
      }

      // Budget CY bar
      if (budVal != null) {
        const y = yScale(budVal);
        const h = (P.t + innerH) - y;
        bars.push(`<rect x="${groupX + barW + barGap}" y="${y}" width="${barW}" height="${h}"
                         fill="${COLORS.budgetCY}" fill-opacity="${refOpacity}" rx="2"/>`);
      }

      // Actual PY bar
      if (pyVal != null) {
        const y = yScale(pyVal);
        const h = (P.t + innerH) - y;
        bars.push(`<rect x="${groupX + 2 * (barW + barGap)}" y="${y}" width="${barW}" height="${h}"
                         fill="${COLORS.actualPY}" fill-opacity="${refOpacity}" rx="2"/>`);
      }

      // Month label
      labels.push(`<text x="${cx}" y="${H - 10}" text-anchor="middle"
                         font-size="9" fill="#6b7280">${r.monthLabel}</text>`);
    });

    // Today divider — vertical dashed line at the right edge of the last completed month group
    let dividerSvg = '';
    if (lastCompletedIdx >= 0 && lastCompletedIdx < 11) {
      const dx = P.l + (lastCompletedIdx + 1) * groupW;
      dividerSvg = `
        <line x1="${dx}" x2="${dx}" y1="${P.t}" y2="${P.t + innerH}"
              stroke="#94a3b8" stroke-dasharray="4 4" stroke-width="1"/>
        <text x="${dx + 4}" y="${P.t + 9}" font-size="8" fill="#64748b">today</text>
      `;
    }

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
        ${yTicks.join('')}
        ${bars.join('')}
        ${dividerSvg}
        ${labels.join('')}
        <line x1="${P.l}" x2="${W - P.r}" y1="${P.t + innerH}" y2="${P.t + innerH}" stroke="#e5e7eb"/>
      </svg>
    `;
  };

  const yearlyChartLegend = (year: number, priorYear: number): string => {
    return `
      <div style="display:flex;gap:14px;justify-content:center;margin-top:6px;font-size:9px;color:#374151">
        <span><span style="display:inline-block;width:9px;height:9px;background:#1e40af;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Actual ${year}</span>
        <span><span style="display:inline-block;width:9px;height:9px;background:#f59e0b;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Budget ${year}</span>
        <span><span style="display:inline-block;width:9px;height:9px;background:#94a3b8;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Actual ${priorYear}</span>
      </div>
    `;
  };

  // Territory Analysis — grouped vertical bars per territory: actual / budget
  // / stretch (budget × 1.1). Vs-budget % above each actual bar.
  const territoryAnalysisSVG = (terrs: any[]): string => {
    const W = 720, H = 240, P = { l: 48, r: 12, t: 24, b: 30 };
    const innerW = W - P.l - P.r;
    const innerH = H - P.t - P.b;

    if (!terrs || terrs.length === 0) {
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
        <text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="11" fill="#9ca3af">No data</text>
      </svg>`;
    }

    // Filter, sort by actual desc, normalize names
    const rows = (terrs || [])
      .filter((t: any) => (Number(t.volume) || 0) > 0 || (Number(t.budgetVolume) || 0) > 0)
      .sort((a: any, b: any) => (Number(b.volume) || 0) - (Number(a.volume) || 0))
      .map((t: any) => ({
        name:    String(t.territoryName || t.territoryCode || '?').replace(/'s Territory$/i, ''),
        actual:  Number(t.volume) || 0,
        budget:  Number(t.budgetVolume) || 0,
        stretch: (Number(t.budgetVolume) || 0) * 1.1,
        vsBud:   t.vsBudgetPct,
      }));

    if (rows.length === 0) {
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
        <text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="11" fill="#9ca3af">No data</text>
      </svg>`;
    }

    const allVals = rows.flatMap(r => [r.actual, r.budget, r.stretch]);
    const yMax = Math.max(...allVals, 1) * 1.12;
    const yScale = (v: number) => P.t + innerH - (v / yMax) * innerH;

    const groupW = innerW / rows.length;
    const barGap = 3;
    const barW   = (groupW - 2 * barGap - 10) / 3;

    // Y-axis ticks (5)
    const yTicks: string[] = [];
    for (let i = 0; i <= 4; i++) {
      const v = yMax * (i / 4);
      const y = yScale(v);
      const label = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
                  : v >= 1_000     ? `${Math.round(v / 1_000)}K`
                  : Math.round(v).toString();
      yTicks.push(`
        <line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}"
              stroke="#f1f5f9" stroke-dasharray="3 3"/>
        <text x="${P.l - 6}" y="${y + 3}" text-anchor="end"
              font-size="9" fill="#9ca3af">${label}</text>
      `);
    }

    const COL = { actual: '#1e40af', budget: '#f59e0b', stretch: '#94a3b8' };
    const bars: string[] = [];
    const labels: string[] = [];

    rows.forEach((r, i) => {
      const groupX = P.l + i * groupW + 5;
      const cx = groupX + (barW * 3 + barGap * 2) / 2;

      // Actual
      const ay = yScale(r.actual);
      const ah = (P.t + innerH) - ay;
      bars.push(`<rect x="${groupX}" y="${ay}" width="${barW}" height="${ah}"
                       fill="${COL.actual}" rx="2"/>`);

      // vs-budget % above actual
      if (r.budget > 0 && r.vsBud != null) {
        const pct = Number(r.vsBud) - 100; // delta from budget
        const color = pct >= 0 ? '#16a34a' : '#dc2626';
        const sign  = pct >= 0 ? '+' : '';
        labels.push(`<text x="${groupX + barW / 2}" y="${ay - 4}" text-anchor="middle"
                          font-size="9" font-weight="700" fill="${color}">${sign}${pct.toFixed(1)}%</text>`);
      }

      // Budget
      if (r.budget > 0) {
        const by = yScale(r.budget);
        const bh = (P.t + innerH) - by;
        bars.push(`<rect x="${groupX + barW + barGap}" y="${by}" width="${barW}" height="${bh}"
                         fill="${COL.budget}" rx="2"/>`);
      }
      // Stretch
      if (r.stretch > 0) {
        const sy = yScale(r.stretch);
        const sh = (P.t + innerH) - sy;
        bars.push(`<rect x="${groupX + 2 * (barW + barGap)}" y="${sy}" width="${barW}" height="${sh}"
                         fill="${COL.stretch}" rx="2"/>`);
      }

      // Territory name
      labels.push(`<text x="${cx}" y="${H - 12}" text-anchor="middle"
                         font-size="10" font-weight="600" fill="#374151">${esc(r.name)}</text>`);
    });

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
        ${yTicks.join('')}
        ${bars.join('')}
        ${labels.join('')}
        <line x1="${P.l}" x2="${W - P.r}" y1="${P.t + innerH}" y2="${P.t + innerH}" stroke="#e5e7eb"/>
      </svg>
    `;
  };

  const territoryAnalysisLegend = (): string => `
    <div style="display:flex;gap:14px;justify-content:center;margin-top:6px;font-size:9px;color:#374151">
      <span><span style="display:inline-block;width:9px;height:9px;background:#1e40af;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Actual</span>
      <span><span style="display:inline-block;width:9px;height:9px;background:#f59e0b;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Budget</span>
      <span><span style="display:inline-block;width:9px;height:9px;background:#94a3b8;border-radius:2px;vertical-align:middle;margin-right:4px"></span>Stretch</span>
    </div>
  `;

  const territoryDonutSVG = (terrs: any[]): string => {
    const palette = ['#1e3a5f', '#0891b2', '#16a34a', '#d97706', '#6b7280', '#7c3aed'];
    const W = 300, H = 300, cx = W / 2, cy = H / 2, R = 120, r = 72;

    if (!terrs || terrs.length === 0) {
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <text x="${cx}" y="${cy}" text-anchor="middle" font-size="11" fill="#9ca3af">No data</text>
      </svg>`;
    }

    const total = terrs.reduce((s, t) => s + (Number(t.volume) || 0), 0);
    if (total <= 0) {
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        <text x="${cx}" y="${cy}" text-anchor="middle" font-size="11" fill="#9ca3af">No volume</text>
      </svg>`;
    }

    let acc = -Math.PI / 2;
    const arcs: string[] = [];
    const labels: string[] = [];

    // Short label: take the leading word of the territory name (e.g.
    // "Brendon's Territory" → "Brendon")
    const shortName = (t: any) => {
      const raw = String(t.territoryName || t.territoryCode || '');
      return raw.split(/['\s]/)[0] || raw;
    };

    terrs.forEach((t, i) => {
      const v = Number(t.volume) || 0;
      const sweep = (v / total) * Math.PI * 2;
      const a0 = acc;
      const a1 = acc + sweep;
      const aMid = (a0 + a1) / 2;
      acc = a1;
      const large = sweep > Math.PI ? 1 : 0;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const xi1 = cx + r * Math.cos(a1), yi1 = cy + r * Math.sin(a1);
      const xi0 = cx + r * Math.cos(a0), yi0 = cy + r * Math.sin(a0);
      const color = palette[i % palette.length];
      arcs.push(`
        <path d="M ${x0} ${y0}
                 A ${R} ${R} 0 ${large} 1 ${x1} ${y1}
                 L ${xi1} ${yi1}
                 A ${r} ${r} 0 ${large} 0 ${xi0} ${yi0}
                 Z"
              fill="${color}"/>
      `);

      // Label inside the segment if it's wide enough
      if (sweep > 0.18) {
        const labelR = (R + r) / 2;
        const lx = cx + labelR * Math.cos(aMid);
        const ly = cy + labelR * Math.sin(aMid);
        const pct = ((v / total) * 100).toFixed(1);
        labels.push(`
          <text x="${lx}" y="${ly - 3}" text-anchor="middle"
                font-size="11" font-weight="700" fill="#ffffff">${esc(shortName(t))}</text>
          <text x="${lx}" y="${ly + 10}" text-anchor="middle"
                font-size="10" font-weight="600" fill="#ffffff" opacity="0.92">${pct}%</text>
        `);
      }
    });

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
        ${arcs.join('')}
        ${labels.join('')}
      </svg>
    `;
  };

  const territoryLegend = (terrs: any[]): string => {
    const palette = ['#1e3a5f', '#0891b2', '#16a34a', '#d97706', '#6b7280', '#7c3aed'];
    const total   = (terrs || []).reduce((s, t) => s + (Number(t.volume) || 0), 0);
    return `
      <div class="donut-legend">
        ${(terrs || []).map((t, i) => {
          const pct = total > 0 ? ((Number(t.volume) || 0) / total) * 100 : 0;
          return `<div>
            <span class="swatch" style="background:${palette[i % palette.length]}"></span>
            ${esc(t.territoryName || t.territoryCode)}
            <span style="color:#9ca3af">(${pct.toFixed(1)}%)</span>
          </div>`;
        }).join('')}
      </div>
    `;
  };

  // Tile renderer — mirrors dashboard KPICard exactly
  const tile = (opts: {
    icon: string;
    label: string;
    value: string;
    sub?: string;
    badgePct?: number | null;
    badgeText?: string;
    badgeHtml?: string;
    growth?: number | null;
    growthLabel?: string;
    highlight?: boolean;
  }) => {
    const { icon, label, value, sub, badgePct, badgeText, badgeHtml, growth, growthLabel, highlight } = opts;
    const badge = badgeHtml
      ? badgeHtml
      : badgeText
        ? `<span class="kpi-badge ${badgeClass(badgePct)}">${esc(badgeText)}</span>`
        : badgePct != null
          ? `<span class="kpi-badge ${badgeClass(badgePct)}">${fmtVar(badgePct)}</span>`
          : '';
    const growthLine = growth != null
      ? `<p class="kpi-growth ${growthClass(growth)}">${growthArrow(growth)} ${Math.abs(growth).toFixed(1)}% ${growthLabel || 'vs prior'}</p>`
      : '';
    return `
      <div class="kpi ${highlight ? 'highlight' : ''}">
        <div class="kpi-top">
          <div class="kpi-icon-wrap">${ICONS[icon] || ''}</div>
          ${badge}
        </div>
        <p class="kpi-label">${esc(label)}</p>
        <p class="kpi-value">${value}</p>
        ${sub ? `<p class="kpi-sub">${sub}</p>` : ''}
        ${growthLine}
      </div>`;
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
               color: #111827; background: #ffffff; -webkit-print-color-adjust: exact; }
  .page { padding: 20px 32px; min-height: 210mm; position: relative; }
  .page.fixed { height: 210mm; overflow: hidden; }

  /* ── Header ─────────────────────────────────────────────────── */
  .hdr { display: flex; justify-content: space-between; align-items: flex-end;
         padding-bottom: 8px; margin-bottom: 12px; border-bottom: 2px solid #1e3a5f; }
  .hdr h1 { font-size: 20px; font-weight: 700; color: #1e3a5f; letter-spacing: -0.2px; }
  .hdr .sub { font-size: 10px; color: #9ca3af; margin-top: 2px; }
  .hdr .meta { text-align: right; font-size: 9.5px; color: #6b7280; line-height: 1.55; }
  .hdr .meta strong { color: #111827; font-weight: 600; }
  .badge { display: inline-block; background: #1e3a5f; color: #fff;
           padding: 2px 8px; border-radius: 3px; font-size: 9px;
           font-weight: 600; letter-spacing: 0.4px; }

  /* ── Section title ──────────────────────────────────────────── */
  .stitle { font-size: 9px; font-weight: 700; color: #1e3a5f;
            text-transform: uppercase; letter-spacing: 1.1px;
            margin: 10px 0 6px;
            display: flex; align-items: center; gap: 8px; }
  .stitle::before { content: ''; display: inline-block;
                    width: 3px; height: 11px; background: #1e3a5f;
                    border-radius: 2px; }
  .stitle small { font-weight: 500; color: #94a3b8; letter-spacing: 0.4px;
                  text-transform: none; font-size: 9px; }

  /* ── KPI tiles (match dashboard KPICards.tsx exactly) ────────── */
  .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .kpi  { position: relative; background: #ffffff; border: 1px solid #e5e7eb;
          border-radius: 8px; padding: 8px 10px; overflow: hidden; }
  .kpi.highlight { border-color: #c7d2fe; box-shadow: inset 0 0 0 1px #e0e7ff; }
  .kpi.highlight::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0;
    height: 2px; background: #818cf8;
  }
  .kpi-top { display: flex; justify-content: space-between; align-items: flex-start;
             margin-bottom: 8px; }
  .kpi-icon-wrap { background: #f9fafb; border: 1px solid #f3f4f6;
                   border-radius: 6px; padding: 6px; display: inline-flex; }
  .kpi-icon-wrap svg { width: 14px; height: 14px; color: #9ca3af; }
  .kpi-badge { font-size: 10px; font-weight: 600; padding: 2px 8px;
               border-radius: 999px; line-height: 1.4; }
  .b-green { background: #d1fae5; color: #047857; }
  .b-amber { background: #fef3c7; color: #92400e; }
  .b-red   { background: #fee2e2; color: #991b1b; }
  .b-gray  { background: #f3f4f6; color: #6b7280; }
  .kpi-label { font-size: 9px; font-weight: 600; color: #6b7280;
               text-transform: uppercase; letter-spacing: 0.5px;
               margin-bottom: 2px; }
  .kpi-value { font-size: 15px; font-weight: 700; color: #111827;
               line-height: 1.2; letter-spacing: -0.3px;
               font-variant-numeric: tabular-nums; }
  .kpi-sub { font-size: 9px; color: #9ca3af; margin-top: 2px;
             font-variant-numeric: tabular-nums; }
  .kpi-growth { font-size: 9px; font-weight: 600; margin-top: 4px;
                font-variant-numeric: tabular-nums; }
  .g-green { color: #16a34a; }
  .g-red   { color: #dc2626; }

  /* ── Tables (one consistent style across all pages) ──────────── */
  /* Card wrapper around every data table — gives the rounded outline,
     keeps the headers clean, and makes the report read uniformly. */
  .tcard { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
           overflow: hidden; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  thead tr { background: #f8fafc; }
  th { color: #475569; font-size: 8px;
       text-transform: uppercase; letter-spacing: 0.45px; font-weight: 700;
       text-align: left; padding: 5px 8px;
       border-bottom: 1.5px solid #e5e7eb;
       white-space: nowrap; }
  th.num { text-align: right; }
  td { font-size: 9.5px; padding: 4px 8px;
       border-bottom: 1px solid #f1f5f9;
       color: #111827; vertical-align: middle; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.muted { color: #4b5563; }
  /* Zebra striping — odd body rows get a soft tint for scannability */
  tbody tr:nth-child(even) { background: #fafbfc; }
  tbody tr:last-child td { border-bottom: none; }
  /* First column always emphasized (site / territory name) */
  td:first-child { font-weight: 600; color: #0f172a; }
  .rnk { display: inline-block; width: 15px; height: 15px; border-radius: 50%;
         background: #1e3a5f; color: #ffffff; font-size: 8px; font-weight: 700;
         text-align: center; line-height: 15px; }

  /* ── Comments ──────────────────────────────────────────────── */
  .cmt { border-left: 3px solid #1e3a5f; padding: 6px 10px; margin-bottom: 6px;
         background: #f9fafb; border-radius: 0 4px 4px 0; }
  .cmt .who { font-size: 9px; color: #6b7280; margin-bottom: 2px; }
  .cmt .who strong { color: #111827; }
  .cmt .txt { font-size: 10px; color: #374151; }

  /* ── Footer ────────────────────────────────────────────────── */
  .ftr { margin-top: auto; padding-top: 8px; border-top: 1px solid #e5e7eb;
         display: flex; justify-content: space-between;
         font-size: 8.5px; color: #9ca3af; }

  /* ── Page breaks ───────────────────────────────────────────── */
  .page + .page, .page + div { page-break-before: always; }
  .pghdr { display: flex; justify-content: space-between; align-items: baseline;
           margin-bottom: 8px; padding-bottom: 6px;
           border-bottom: 2px solid #1e3a5f; }
  .pghdr h2 { font-size: 15px; font-weight: 700; color: #1e3a5f;
              letter-spacing: -0.2px; }
  .pghdr span { font-size: 9px; color: #6b7280;
                font-variant-numeric: tabular-nums; }
  .pghdr span strong { color: #111827; font-weight: 600; }

  /* ── Long-table pagination (Full Site Breakdown) ─────────── */
  table.paged       { table-layout: auto; }
  table.paged thead { display: table-header-group; }
  table.paged tfoot { display: table-row-group; }
  table.paged tr    { page-break-inside: avoid; }
  /* Compact variant — Full Site Breakdown. Larger font for visibility. */
  table.compact th { padding: 8px 9px; font-size: 10px; }
  table.compact td { padding: 7px 9px; font-size: 10.5px; }

  /* ── Charts row ────────────────────────────────────────────── */
  .charts-row { display: grid; grid-template-columns: 2.4fr 1fr;
                gap: 10px; margin-top: 10px; }
  .chart-card { background: #fff; border: 1px solid #e5e7eb;
                border-radius: 10px; padding: 10px 14px;
                display: flex; flex-direction: column; }
  .chart-card.daily { height: 290px; }
  .chart-card.donut { height: 290px; align-items: center; }
  .chart-title { font-size: 11px; font-weight: 700; color: #111827;
                 margin-bottom: 6px; align-self: flex-start; }
  .chart-card svg { display: block; flex: 1 1 auto; min-height: 0;
                    width: 100%; height: 100%; }
  .chart-card.donut svg { max-width: 220px; max-height: 220px; }
  /* Yearly chart on page 2 — sized to share the page with the daily trend */
  .chart-card.yearly { height: 300px; }
  /* Daily chart variant on page 2 — slightly more compact than the page-1 size */
  .chart-card.daily.compact { }
</style>
</head>
<body>

<!-- ─────────────────────────── PAGE 1 — KPIs ─────────────────────────── -->
<div class="page fixed">

  <div class="hdr">
    <div>
      <h1>Redan Sales Dashboard</h1>
      <p class="sub">${esc(meta.reportName || 'Period Performance Report')}</p>
    </div>
    <div class="meta">
      <span class="badge">${esc(meta.territory || 'ALL TERRITORIES')}</span><br/>
      ${fmtPeriod(meta.dateFrom)} &nbsp;→&nbsp; ${fmtPeriod(meta.dateTo)}<br/>
      Prepared by <strong>${esc(meta.generatedBy || 'System')}</strong> ·
      ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
    </div>
  </div>

  <div class="stitle">Key Performance Indicators</div>
  <div class="kpis">

    ${/* 1. Active Sites */ tile({
      icon:  'store',
      label: 'Active Sites',
      value: String(kpis.mtd?.activeSites ?? '—'),
      sub:   `${kpis.mtd?.tradingDays ?? 0} days reporting`,
    })}

    ${/* 2. MTD Volume */ (() => {
      const proj = kpis.projection;
      const fullBudget = kpis.budget?.fullMonthBudget;
      let projColor = '#374151';
      if (proj && fullBudget > 0) {
        const diffPct = Math.abs(proj.value - fullBudget) / fullBudget;
        if (diffPct <= 0.05)            projColor = '#d97706';
        else if (proj.value > fullBudget) projColor = '#16a34a';
        else                             projColor = '#dc2626';
      }
      const projLine = proj
        ? `<p style="font-size:10px;color:${projColor};font-weight:600;margin-top:6px;padding-top:6px;border-top:1px solid #f1f5f9;font-variant-numeric:tabular-nums">
             ${proj.isNextMonth ? `${proj.label}: ~${fmtVol(proj.value)} L` : `Projected: ~${fmtVol(proj.value)} L`}
             ${proj.isNextMonth ? `<span style="font-size:8px;background:#f3f4f6;color:#6b7280;padding:1px 5px;border-radius:3px;margin-left:4px;text-transform:uppercase;letter-spacing:0.4px">Next month</span>` : ''}
           </p>`
        : '';
      const momPct = kpis.growth?.mtdGrowthPct;
      const momBadge = momPct != null
        ? `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:${momPct >= 0 ? '#dcfce7' : '#fef2f2'};color:${momPct >= 0 ? '#16a34a' : '#dc2626'}">${momPct >= 0 ? '+' : ''}${momPct.toFixed(1)}%</span>`
        : '';
      return tile({
        icon:  'barrel',
        label: 'MTD Volume',
        value: `${fmtVol(kpis.mtd?.volume)} L`,
        sub:   `Budget: ${fmtVol(kpis.budget?.mtdBudget)} L (${kpis.budget?.daysElapsed ?? '—'}/${kpis.budget?.daysInMonth ?? '—'} days)${projLine}`,
        badgeHtml: momBadge,
        highlight: true,
      });
    })()}

    ${/* 3. Average Daily Sales */ (() => {
      const dailyBudget = kpis.budget?.mtdBudget && kpis.budget?.daysElapsed
        ? kpis.budget.mtdBudget / kpis.budget.daysElapsed : null;
      const aboveBudget = dailyBudget != null && kpis.mtd?.avgDaily != null && kpis.mtd.avgDaily >= dailyBudget;
      const td = kpis.mtd?.tradingDays ?? 0;
      const dD = td > 0 && kpis.mtd?.dieselVolume ? Math.round(kpis.mtd.dieselVolume / td) : null;
      const dB = td > 0 && kpis.mtd?.blendVolume ? Math.round(kpis.mtd.blendVolume / td) : null;
      const dU = td > 0 && kpis.mtd?.ulpVolume ? Math.round(kpis.mtd.ulpVolume / td) : null;
      const split = [dD != null ? `D: ${fmtVol(dD)}` : '', dB != null ? `B: ${fmtVol(dB)}` : '', dU != null ? `U: ${fmtVol(dU)}` : ''].filter(Boolean).join(' · ');
      const bdgt = dailyBudget != null ? ` · Bdgt: ${fmtVol(Math.round(dailyBudget))}` : '';
      return tile({
        icon:  'lightning',
        label: 'Avg Daily Sales',
        value: `<span style="color:${aboveBudget ? '#16a34a' : '#111827'}">${fmtVol(kpis.mtd?.avgDaily)} L</span>`,
        sub:   `${split}${bdgt}`,
      });
    })()}

    ${/* 4. Vs Stretch + Vs Budget (dual stat) */ (() => {
      const vsS = kpis.budget?.vsStretchPct;
      const vsB = kpis.budget?.vsBudgetPct;
      const colorOf = (pct: number | null | undefined) =>
        pct == null ? '#9ca3af' : pct >= 100 ? '#16a34a' : pct >= 85 ? '#d97706' : '#dc2626';
      const badge = (vsS ?? 0) >= 100 ? 'STRETCH ACHIEVED' : (vsB ?? 0) >= 100 ? 'BUDGET MET' : undefined;
      const dual = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:2px">
          <div style="border:1px solid #f3f4f6;background:#f9fafb;border-radius:6px;padding:10px 10px;display:flex;flex-direction:column">
            <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;margin-bottom:auto;padding-bottom:5px;line-height:1.3">Vs Stretch</p>
            <p style="font-size:20px;font-weight:700;color:${colorOf(vsS)};line-height:1.1;font-variant-numeric:tabular-nums">${fmtVar(vsS)}</p>
          </div>
          <div style="border:1px solid #f3f4f6;background:#f9fafb;border-radius:6px;padding:10px 10px;display:flex;flex-direction:column">
            <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#6b7280;margin-bottom:auto;padding-bottom:5px;line-height:1.3">Vs Budget</p>
            <p style="font-size:20px;font-weight:700;color:${colorOf(vsB)};line-height:1.1;font-variant-numeric:tabular-nums">${fmtVar(vsB)}</p>
          </div>
        </div>
      `;
      return tile({
        icon:  'target',
        label: 'MTD Targets',
        value: dual,
        badgePct: vsS,
        badgeText: badge,
      });
    })()}

    ${/* 5. MoM Growth */ (() => {
      const cy  = kpis.mtd?.activeSites;
      const py  = kpis.growth?.priorMtdActiveSites;
      const d   = (cy != null && py != null) ? cy - py : null;
      const priorTxt = `${fmtVol(kpis.growth?.priorMtdVolume)} L last month`;
      const deltaColor = d == null || d === 0 ? '#6b7280' : d > 0 ? '#16a34a' : '#dc2626';
      const deltaSign  = d == null || d === 0 ? '±' : d > 0 ? '+' : '−';
      const deltaHtml  = d != null
        ? `<span style="color:${deltaColor};font-weight:600">${deltaSign}${Math.abs(d)} site${Math.abs(d) === 1 ? '' : 's'}</span>`
        : '';
      const sub = d != null ? `${deltaHtml} · ${priorTxt}` : priorTxt;
      const pct = kpis.growth?.mtdGrowthPct;
      const valColor = pct == null ? '#374151' : pct >= 0 ? '#16a34a' : '#dc2626';
      return tile({
        icon:  'trending',
        label: 'MoM Growth',
        value: `<span style="color:${valColor}">${pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}</span>`,
        sub,
      });
    })()}

    ${/* 6. Avg Margin */ tile({
      icon:  'calendar',
      label: 'Avg Margin',
      value: kpis.margin?.avgCplPerSite != null
              ? `$${(kpis.margin.avgCplPerSite / 100).toFixed(2)}/L`
              : '—',
      sub:   kpis.margin?.sitesWithMargin
              ? `${kpis.margin.sitesWithMargin} of ${kpis.mtd?.activeSites ?? '?'} active sites have margin data`
              : 'Net gross margin',
    })}

    ${/* 7. Cash Ratio */ (() => {
      const cur = kpis.mtd?.cashRatio != null ? kpis.mtd.cashRatio * 100 : null;
      const prior = kpis.growth?.priorMtdCashRatio != null ? kpis.growth.priorMtdCashRatio * 100 : null;
      const delta = cur != null && prior != null && prior > 0 ? cur - prior : null;
      const crBadge = delta != null
        ? `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:${delta >= 0 ? '#dcfce7' : '#fef2f2'};color:${delta >= 0 ? '#16a34a' : '#dc2626'}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp</span>`
        : '';
      return tile({
        icon:  'cash',
        label: 'Cash Ratio',
        value: cur != null ? `${cur.toFixed(1)}%` : '—',
        sub:   `Coupon: ${fmtVol(kpis.mtd?.couponVolume)} L · Card: ${fmtVol(kpis.mtd?.cardVolume)} L`,
        badgeHtml: crBadge,
      });
    })()}

    ${/* 8. Petrotrade */ (() => {
      const cur = kpis.petrotrade?.mtdVolume ?? 0;
      const prior = kpis.petrotrade?.priorMtdVolume ?? 0;
      const pct = prior > 0 ? ((cur - prior) / prior) * 100 : null;
      const badgeHtml = pct != null
        ? `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:${pct >= 0 ? '#dcfce7' : '#fef2f2'};color:${pct >= 0 ? '#16a34a' : '#dc2626'}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>`
        : '';
      return tile({
        icon:  'handshake',
        label: 'Petrotrade Vol',
        value: `${fmtVol(cur)} <span style="font-size:10px;font-weight:500;color:#9ca3af">L</span>`,
        sub:   `Margin: ${fmtRev(kpis.petrotrade?.mtdMargin)}`,
        badgeHtml,
      });
    })()}

    ${/* 9. Redan Flexi Volume */ (() => {
      const cy = kpis.mtd?.flexVolume;
      const py = kpis.growth?.priorMtdFlexVolume;
      const flexGrowth = (cy != null && py != null && py > 0)
        ? ((cy - py) / py) * 100
        : null;
      const flexBadge = flexGrowth != null
        ? `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:${flexGrowth >= 0 ? '#dcfce7' : '#fef2f2'};color:${flexGrowth >= 0 ? '#16a34a' : '#dc2626'}">${flexGrowth >= 0 ? '+' : ''}${flexGrowth.toFixed(1)}%</span>`
        : '';
      return tile({
        icon:  'dollar',
        label: 'Redan Flexi Volume',
        value: `${fmtVol(cy)} L`,
        sub:   py != null ? `${fmtVol(py)} L last month` : 'Flexi blend + flexi diesel',
        badgeHtml: flexBadge,
      });
    })()}

    ${/* 10. YTD Volume */ (() => {
      const cy  = kpis.ytd?.activeSites;
      const py  = kpis.growth?.priorYtdActiveSites;
      const d   = (cy != null && py != null) ? cy - py : null;
      const priorTxt = `${fmtVol(kpis.growth?.priorYtdVolume)} L prior year`;
      const deltaColor = d == null || d === 0 ? '#6b7280' : d > 0 ? '#16a34a' : '#dc2626';
      const deltaSign  = d == null || d === 0 ? '±' : d > 0 ? '+' : '−';
      const deltaHtml  = d != null
        ? `<span style="color:${deltaColor};font-weight:600">${deltaSign}${Math.abs(d)} site${Math.abs(d) === 1 ? '' : 's'}</span>`
        : '';
      const sub = d != null ? `${deltaHtml} · ${priorTxt}` : priorTxt;
      const yoyPct = kpis.growth?.ytdGrowthPct;
      const yoyBadge = yoyPct != null
        ? `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:${yoyPct >= 0 ? '#dcfce7' : '#fef2f2'};color:${yoyPct >= 0 ? '#16a34a' : '#dc2626'}">${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(1)}%</span>`
        : '';
      const vsBudget = kpis.ytd?.vsBudgetPct;
      return tile({
        icon:  'chart',
        label: 'YTD Volume',
        value: `${fmtVol(kpis.ytd?.volume)} L`,
        sub,
        badgeHtml: yoyBadge,
        growth: vsBudget != null ? vsBudget - 100 : null,
        growthLabel: 'vs budget',
      });
    })()}

  </div>

  <div class="stitle" style="margin-top:8px">Territory Scorecard <small>sorted by volume</small></div>
  ${territoryScorecardHTML(territories || [])}

  <div class="ftr">
    <span>Redan Sales Dashboard · Confidential</span>
    <span>Page 1 · ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
  </div>
</div>

<!-- ─────────────── PAGE 2 — Top 20 Sites ─────────────── -->
<div class="page fixed">

  <div class="pghdr">
    <h2>Top 20 Sites</h2>
    <span>Sorted by vs stretch · ${fmtPeriod(meta.dateFrom)} → ${fmtPeriod(meta.dateTo)}</span>
  </div>

  <div class="tcard"><table>
    <thead><tr>
      <th style="width:20px">#</th>
      <th>Site</th>
      <th>Territory</th>
      <th>MOSO</th>
      <th class="num">Volume (L)</th>
      <th class="num">Avg Daily</th>
      <th class="num">Vs Budget</th>
      <th class="num">Vs Stretch</th>
    </tr></thead>
    <tbody>
      ${(topSites || []).sort((a: any, b: any) => (b.vsStretchPct ?? 0) - (a.vsStretchPct ?? 0)).map((s: any, i: number) => `
        <tr>
          <td><span class="rnk">${i + 1}</span></td>
          <td><strong>${esc(s.siteName)}</strong></td>
          <td class="muted">${esc(s.territoryName) || '—'}</td>
          <td class="muted">${esc(s.moso) || '—'}</td>
          <td class="num">${fmtVol(s.volume)}</td>
          <td class="num muted">${fmtVol(s.avgDaily)}</td>
          <td class="num" style="color:${varColor(s.vsBudgetPct)};font-weight:600">${fmtVar(s.vsBudgetPct)}</td>
          <td class="num" style="color:${varColor(s.vsStretchPct)}">${fmtVar(s.vsStretchPct)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>

  ${comments && comments.length > 0 ? `
    <div class="stitle" style="margin-top: 10px">Analyst Notes</div>
    ${comments.map((c: any) => `
      <div class="cmt">
        <div class="who"><strong>${esc(c.author)}</strong> · ${new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}${c.ref_site_code ? ` · ${esc(c.ref_site_code)}` : ''}</div>
        <div class="txt">${esc(c.comment_text)}</div>
      </div>
    `).join('')}
  ` : ''}

  <div class="ftr">
    <span>Redan Sales Dashboard · Confidential</span>
    <span>Page 2</span>
  </div>
</div>

<!-- ─────────────── PAGE 3 — Charts ─────────────── -->
<div class="page fixed">

  <div class="pghdr">
    <h2>${data.yearly?.year ?? ''} Volume Outlook</h2>
    <span>Respects territory filter</span>
  </div>

  <div class="stitle">Daily Volume Trend
    <small>${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(data.trendMonth?.month || 1) - 1]} ${data.trendMonth?.year || ''}${(() => {
      const stats = dailyChartStats(data.trend || [], data.trendMonth || { monthEndDay: 30 });
      return stats ? ` · ${stats}` : '';
    })()}</small></div>
  <div class="chart-card daily compact" style="margin-bottom:8px">
    ${dailyChartSVG(data.trend || [], data.trendMonth || { year: new Date().getFullYear(), month: new Date().getMonth()+1, monthEndDay: 30 })}
    ${dailyChartLegend(data.trend || [], data.trendMonth || { monthEndDay: 30 })}
  </div>

  <div class="stitle">${data.yearly?.year ?? ''} Volume — Actual vs Budget vs ${data.yearly?.priorYear ?? ''}</div>
  <div class="chart-card yearly">
    <div style="font-size:8px;color:#9ca3af;margin-bottom:3px">
      Future months show budget &amp; prior‑year as reference (lighter fill). % above each bar = actual vs budget for that month.
    </div>
    ${yearlyVolumeBudgetSVG(data.yearly?.data || [], data.yearly?.year || 0, data.yearly?.priorYear || 0)}
    ${yearlyChartLegend(data.yearly?.year || 0, data.yearly?.priorYear || 0)}
  </div>

  ${data.unmatched?.counts?.all > 0 ? `
  <div class="stitle" style="margin-top:8px">Unmatched Submissions</div>
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px 10px">
    <div style="font-size:9px;color:#991b1b;font-weight:600;margin-bottom:4px">
      ${data.unmatched.counts.distinctCodes} site code(s) · ${data.unmatched.counts.all} row(s) dropped
    </div>
    <table style="width:100%;font-size:8px">
      <thead><tr>
        <th style="text-align:left;padding:2px 4px;color:#7f1d1d">Raw Code</th>
        <th style="text-align:left;padding:2px 4px;color:#7f1d1d">Sheet</th>
        <th style="text-align:right;padding:2px 4px;color:#7f1d1d">Rows</th>
      </tr></thead>
      <tbody>
        ${(data.unmatched.data || []).slice(0, 6).map((u: any) => `
          <tr>
            <td style="padding:2px 4px;font-family:monospace;color:#dc2626;font-weight:600">${esc(u.rawSiteCode)}</td>
            <td style="padding:2px 4px;color:#6b7280">${esc(u.sheet)}</td>
            <td style="padding:2px 4px;text-align:right;color:#374151">${u.rowCount}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <div class="ftr">
    <span>Redan Sales Dashboard · Confidential</span>
    <span>Page 3</span>
  </div>
</div>

<!-- ─────────────────────── PAGE 4+ — Full Site Breakdown (multi-page) ─────────────────────── -->
<div style="padding: 20px 32px;">

  <div class="pghdr">
    <h2>Full Site Breakdown</h2>
    <span>${(breakdown || []).length} sites · ${fmtPeriod(meta.dateFrom)} → ${fmtPeriod(meta.dateTo)}</span>
  </div>

  <div class="tcard"><table class="paged compact">
    <thead><tr>
      <th>Site</th>
      <th>Territory</th>
      <th>MOSO</th>
      <th class="num">Volume (L)</th>
      <th class="num">Avg / Day</th>
      <th class="num">Budget (L)</th>
      <th class="num">Vs Budget</th>
      <th class="num">Vs Stretch</th>
      <th class="num">Cum. Loss (L)</th>
      <th class="num">Cash %</th>
      <th class="num">Coupon + Card (L)</th>
      <th class="num">Flex (L)</th>
      <th class="num">Net Margin</th>
    </tr></thead>
    <tbody>
      ${(breakdown || []).map((r: any) => {
        const days = parseInt(r.days_traded || 0) || 0;
        const vol  = parseFloat(r.volume || 0);
        const rev  = parseFloat(r.revenue || 0);
        const avg  = days > 0 ? vol / days : 0;
        const loss = parseFloat(r.gain_loss || 0);
        const lossColor = loss < 0 ? '#dc2626' : '#6b7280';
        const cashVal   = parseFloat(r.cash_value || 0);
        const cashPct   = rev > 0 ? (cashVal / rev) * 100 : null;
        const couponVol = parseFloat(r.coupon_volume || 0);
        const cardVol   = parseFloat(r.card_volume   || 0);
        const flexVol   = parseFloat(r.flex_volume   || 0);
        const netMargin = parseFloat(r.net_margin || 0);
        const invVol    = parseFloat(r.inv_volume || 0);
        const cpl       = invVol > 0 ? (netMargin / invVol) * 100 : null;
        const budgetVol  = parseFloat(r.budget_volume || 0);
        const stretchVol = budgetVol * 1.1;
        const vsBudPct   = budgetVol  > 0 ? (vol / budgetVol)  * 100 : null;
        const vsStrPct   = stretchVol > 0 ? (vol / stretchVol) * 100 : null;
        return `
        <tr>
          <td><strong>${esc(r.site_name || r.site_code)}</strong></td>
          <td class="muted">${esc(r.territory_name) || '—'}</td>
          <td class="muted">${esc(r.moso) || '—'}</td>
          <td class="num">${fmtVol(vol)}</td>
          <td class="num muted">${fmtVol(avg)}</td>
          <td class="num muted">${budgetVol > 0 ? fmtVol(budgetVol) : '—'}</td>
          <td class="num" style="color:${varColor(vsBudPct)};font-weight:600">${fmtVar(vsBudPct)}</td>
          <td class="num" style="color:${varColor(vsStrPct)};font-weight:600">${fmtVar(vsStrPct)}</td>
          <td class="num" style="color:${lossColor}">${fmtVol(loss)}</td>
          <td class="num muted">${cashPct != null ? cashPct.toFixed(1) + '%' : '—'}</td>
          <td class="num muted">${(couponVol + cardVol) > 0 ? fmtVol(couponVol + cardVol) : '—'}</td>
          <td class="num muted">${flexVol   > 0 ? fmtVol(flexVol)   : '—'}</td>
          <td class="num">${cpl != null ? `$${(cpl / 100).toFixed(2)}/L` : '—'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>

  <div class="ftr" style="padding:20px 32px 20px;">
    <span>Redan Sales Dashboard · Confidential</span>
    <span>Full Site Breakdown</span>
  </div>
</div>

</body>
</html>`;
}

// ── Rate limiter (Puppeteer is expensive — max 3 reports/IP/minute) ──────────
const reportRateMap = new Map<string, { count: number; resetAt: number }>();
function checkReportRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = reportRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    reportRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 3) return false;
  entry.count++;
  return true;
}

// ── API Route ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkReportRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests — try again in a minute' }, { status: 429 });
  }

  try {
    const body = await req.json();
    let { dateFrom, dateTo } = body;
    const { territory, product, generatedBy, reportName } = body;

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
    }
    // Defend against a flipped range coming from the dashboard filter
    if (dateFrom > dateTo) {
      const tmp = dateFrom; dateFrom = dateTo; dateTo = tmp;
    }

    // Call API handlers directly (no HTTP round-trips, no middleware auth)
    const baseUrl = 'http://localhost';  // only used for URL parsing, not actual fetching
    const params = new URLSearchParams({ dateFrom, dateTo, ...(territory && { territory }), ...(product && { product }) });

    const refDate     = new Date(dateTo);
    const refYear     = refDate.getFullYear();
    const refMonth    = refDate.getMonth() + 1;
    const monthStart  = `${refYear}-${String(refMonth).padStart(2,'0')}-01`;
    const monthEndDay = new Date(refYear, refMonth, 0).getDate();
    const monthEnd    = `${refYear}-${String(refMonth).padStart(2,'0')}-${String(monthEndDay).padStart(2,'0')}`;
    // Full month for daily chart — shows all days with phantom projection for remaining
    const trendParams = new URLSearchParams({
      dateFrom: monthStart, dateTo: monthEnd, granularity: 'daily',
      ...(territory && { territory }), ...(product && { product }),
    });
    const yearlyParams = new URLSearchParams({ ...(territory && { territory }) });

    // Helper: call a route handler directly and parse its JSON response
    const callHandler = async (label: string, handler: Function, qs: URLSearchParams) => {
      try {
        const fakeReq = new NextRequest(`${baseUrl}/api/?${qs}`);
        const res = await handler(fakeReq);
        return await res.json();
      } catch (err: any) {
        console.error(`Report handler ${label} error:`, err.message);
        return { error: `${label}: ${err.message}` };
      }
    };

    const [kpisRes, topSitesRes, territoriesRes, trendRes, yearlyRes, unmatchedRes] = await Promise.all([
      callHandler('kpis',        kpisHandler,        params),
      callHandler('topSites',    topSitesHandler,     new URLSearchParams(params.toString() + '&limit=20&sortBy=budget')),
      callHandler('territories', territoriesHandler,  params),
      callHandler('trend',       trendHandler,        trendParams),
      callHandler('yearly',      yearlyHandler,       yearlyParams).catch(() => null),
      callHandler('unmatched',   unmatchedHandler,    new URLSearchParams({ pageSize: '10' })).catch(() => null),
    ]);

    const failedEndpoints = [
      kpisRes?.error && `KPIs: ${kpisRes.error}`,
      topSitesRes?.error && `Top Sites: ${topSitesRes.error}`,
      territoriesRes?.error && `Territories: ${territoriesRes.error}`,
      trendRes?.error && `Trend: ${trendRes.error}`,
    ].filter(Boolean);

    if (failedEndpoints.length > 0) {
      console.error('Report data fetch failures:', failedEndpoints);
      return NextResponse.json({
        error: 'Report data failed: ' + failedEndpoints.join('; '),
      }, { status: 500 });
    }

    // Create report record
    const reportRow = await queryOne<any>(
      `INSERT INTO reports (report_name, date_from, date_to, territory_filter, product_filter, generated_by, report_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        reportName || `Sales Report ${dateFrom} to ${dateTo}`,
        dateFrom, dateTo,
        territory || null,
        product || null,
        generatedBy || 'System',
        JSON.stringify({ kpis: kpisRes }),
      ]
    );

    const reportId = reportRow.id;

    // Fetch comments
    const commentsRows = await query(
      'SELECT * FROM report_comments WHERE report_id = $1 ORDER BY created_at',
      [reportId]
    );

    // ── Margin total for the period ────────────────────────────────────────
    // site_margins holds $/L per (site, month). Multiply by actual monthly
    // sales volume to get net margin $.
    const marginParams: any[] = [dateFrom, dateTo];
    let marginTerritoryClause = '';
    if (territory) {
      marginParams.push(String(territory).toUpperCase());
      marginTerritoryClause = `AND t.tm_code = $${marginParams.length}`;
    }
    const marginRow = await queryOne<any>(`
      WITH monthly_sales AS (
        SELECT s.site_code,
               DATE_TRUNC('month', s.sale_date)::DATE AS m,
               SUM(s.total_volume) AS volume
        FROM sales s
        WHERE s.sale_date >= $1 AND s.sale_date <= $2
        GROUP BY s.site_code, DATE_TRUNC('month', s.sale_date)
      )
      SELECT
        COALESCE(SUM(sm.margin_per_litre * COALESCE(ms.volume, 0)), 0) AS gross_margin,
        COALESCE(SUM(sm.margin_per_litre * COALESCE(ms.volume, 0)), 0) AS net_margin,
        COALESCE(SUM(COALESCE(ms.volume, 0)), 0)                       AS inv_volume
      FROM site_margins sm
      JOIN sites si ON sm.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      LEFT JOIN monthly_sales ms
        ON ms.site_code = sm.site_code AND ms.m = sm.period_month
      WHERE sm.period_month >= DATE_TRUNC('month', $1::DATE)
        AND sm.period_month <= DATE_TRUNC('month', $2::DATE)
      ${marginTerritoryClause}
    `, marginParams);

    // ── Full site breakdown for page 3 ─────────────────────────────────────
    const breakdownParams: any[] = [dateFrom, dateTo];
    let breakdownTerritory = '';
    if (territory) {
      breakdownParams.push(String(territory).toUpperCase());
      breakdownTerritory = `AND t.tm_code = $${breakdownParams.length}`;
    }
    const breakdownRows = await query<any>(`
      SELECT
        si.site_code,
        si.budget_name AS site_name,
        si.moso,
        t.tm_name      AS territory_name,
        COALESCE(SUM(s.total_volume),  0) AS volume,
        COALESCE(SUM(s.total_revenue), 0) AS revenue,
        COALESCE(SUM(
          COALESCE(s.diesel_gain_loss, 0) +
          COALESCE(s.blend_gain_loss,  0) +
          COALESCE(s.ulp_gain_loss,    0)
        ), 0) AS gain_loss,
        COUNT(DISTINCT s.sale_date) AS days_traded,
        COALESCE(SUM(s.cash_sale_value), 0) AS cash_value,
        COALESCE(SUM(
          COALESCE(s.diesel_coupon_qty, 0) +
          COALESCE(s.blend_coupon_qty,  0) +
          COALESCE(s.ulp_coupon_qty,    0)
        ), 0) AS coupon_volume,
        COALESCE(SUM(
          COALESCE(s.diesel_card_qty, 0) +
          COALESCE(s.blend_card_qty,  0) +
          COALESCE(s.ulp_card_qty,    0)
        ), 0) AS card_volume,
        COALESCE(SUM(
          COALESCE(s.flex_diesel_volume, 0) +
          COALESCE(s.flex_blend_volume,  0)
        ), 0) AS flex_volume,
        (
          SELECT COALESCE(SUM(
            sm2.margin_per_litre * COALESCE((
              SELECT SUM(s2.total_volume)
              FROM sales s2
              WHERE s2.site_code = si.site_code
                AND DATE_TRUNC('month', s2.sale_date) = sm2.period_month
                AND s2.sale_date BETWEEN $1 AND $2
            ), 0)
          ), 0)
          FROM site_margins sm2
          WHERE sm2.site_code = si.site_code
            AND sm2.period_month >= DATE_TRUNC('month', $1::DATE)
            AND sm2.period_month <= DATE_TRUNC('month', $2::DATE)
        ) AS net_margin,
        (
          SELECT COALESCE(SUM(s3.total_volume), 0)
          FROM sales s3
          WHERE s3.site_code = si.site_code
            AND s3.sale_date BETWEEN $1 AND $2
        ) AS inv_volume,
        -- Pro-rated budget for the [dateFrom..dateTo] window. For each
        -- (site, month) overlapping the range, take overlap_days/calendar_days
        -- × monthly_budget. Stretch is locked at budget × 1.1.
        (
          SELECT COALESCE(SUM(
            vb.budget_volume / bc.calendar_days::NUMERIC *
            GREATEST(0,
              (LEAST((bc.period_month + INTERVAL '1 month' - INTERVAL '1 day')::DATE, $2::DATE)
               - GREATEST(bc.period_month, $1::DATE) + 1)::INTEGER
            )
          ), 0)
          FROM volume_budget vb
          JOIN budget_calendar bc ON vb.budget_month = bc.period_month
          WHERE vb.site_code = si.site_code
            AND bc.period_month <= $2::DATE
            AND (bc.period_month + INTERVAL '1 month')::DATE > $1::DATE
        ) AS budget_volume
      FROM sites si
      LEFT JOIN territories t ON si.territory_id = t.id
      LEFT JOIN sales s
        ON s.site_code = si.site_code
       AND s.sale_date BETWEEN $1 AND $2
      WHERE 1=1
      ${breakdownTerritory}
      GROUP BY si.site_code, si.budget_name, si.moso, t.tm_name
      HAVING COALESCE(SUM(s.total_volume), 0) > 0
      ORDER BY volume DESC
    `, breakdownParams);

    // Build HTML
    const html = buildReportHTML({
      meta: { dateFrom, dateTo, territory, generatedBy, reportName },
      kpis: kpisRes,
      topSites: topSitesRes.data || [],
      territories: territoriesRes.data || [],
      trend:     trendRes?.data || [],
      trendMonth: { year: refYear, month: refMonth, monthEndDay },
      margin:    marginRow,
      breakdown: breakdownRows,
      comments:  commentsRows,
      yearly:    yearlyRes && !yearlyRes.error    ? yearlyRes    : null,
      unmatched: unmatchedRes && !unmatchedRes.error ? unmatchedRes : null,
    });

    // Return HTML for client-side PDF printing (no Puppeteer dependency)
    return NextResponse.json({ reportId, html });

  } catch (err: any) {
    console.error('/api/report error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // List reports
  const rows = await query(
    `SELECT id, report_name, date_from, date_to, territory_filter, generated_by, created_at
     FROM reports ORDER BY created_at DESC LIMIT 50`
  );
  return NextResponse.json({ data: rows });
}
