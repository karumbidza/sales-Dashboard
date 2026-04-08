// app/api/report/route.ts
// Generates a structured PDF report using Puppeteer (headless Chrome)
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

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
  const dailyChartSVG = (rows: any[], info: { year: number; month: number; monthEndDay: number }): string => {
    const W = 720, H = 240, P = { l: 42, r: 12, t: 8, b: 22 };
    const innerW = W - P.l - P.r;
    const innerH = H - P.t - P.b;
    if (!rows || rows.length === 0) {
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMinYMid meet">
        <text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="11" fill="#9ca3af">No data for this month</text>
      </svg>`;
    }

    const monthlyBudget  = rows[0]?.budget_volume  ?? 0;
    const monthlyStretch = rows[0]?.stretch_volume ?? 0;
    const dailyRate      = info.monthEndDay > 0 ? monthlyBudget  / info.monthEndDay : 0;
    const dailyStretch   = info.monthEndDay > 0 ? monthlyStretch / info.monthEndDay : 0;

    // Map by day-of-month so days without data still get a slot
    const byDay: Record<number, any> = {};
    for (const r of rows) {
      const d = parseInt(String(r.date || r.period || '').slice(8, 10), 10);
      if (Number.isFinite(d)) byDay[d] = r;
    }

    const totals = Array.from({ length: info.monthEndDay }, (_, i) => {
      const r = byDay[i + 1];
      return Number(r?.actual_volume || 0);
    });
    const yMax = Math.max(...totals, dailyRate, dailyStretch) * 1.12 || 1;
    const xStep = innerW / info.monthEndDay;
    const barW  = Math.max(4, xStep * 0.7);
    const yScale = (v: number) => P.t + innerH - (v / yMax) * innerH;

    // Y-axis ticks (4)
    const ticks: string[] = [];
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4;
      const y = P.t + innerH - (innerH * i) / 4;
      const lbl = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
                : v >= 1_000     ? `${Math.round(v / 1_000)}K`
                : Math.round(v).toString();
      ticks.push(`
        <line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="#f0f0f0" stroke-width="1"/>
        <text x="${P.l - 6}" y="${y + 3}" text-anchor="end" font-size="8" fill="#9ca3af">${lbl}</text>
      `);
    }

    // Bars (stacked: diesel/blend/ulp)
    const bars: string[] = [];
    const dots: string[] = [];
    const xLbls: string[] = [];
    for (let day = 1; day <= info.monthEndDay; day++) {
      const r = byDay[day];
      const cx = P.l + xStep * (day - 0.5);
      const left = cx - barW / 2;
      let cumBottom = P.t + innerH;

      const segs: [number, string][] = [
        [Number(r?.diesel_volume || 0), '#1e40af'],
        [Number(r?.blend_volume  || 0), '#0891b2'],
        [Number(r?.ulp_volume    || 0), '#059669'],
      ];
      for (const [val, color] of segs) {
        if (val <= 0) continue;
        const h = (val / yMax) * innerH;
        cumBottom -= h;
        bars.push(`<rect x="${left}" y="${cumBottom}" width="${barW}" height="${h}" fill="${color}" />`);
      }

      // Total dot — colour by met budget/stretch
      const total = Number(r?.actual_volume || 0);
      if (total > 0) {
        const cy = yScale(total);
        const metStretch = dailyRate > 0 && total >= dailyRate * 1.10;
        const metBudget  = dailyRate > 0 && total >= dailyRate;
        const fill = metStretch ? '#16a34a' : metBudget ? '#84cc16' : '#ffffff';
        const stroke = metStretch || metBudget ? '#ffffff' : '#6366f1';
        const radius = metStretch ? 4 : metBudget ? 3.5 : 2.5;
        dots.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`);
      }

      // X labels every 2 days
      if (day === 1 || day % 2 === 0 || day === info.monthEndDay) {
        xLbls.push(`<text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="8" fill="#6b7280">${String(day).padStart(2,'0')}</text>`);
      }
    }

    // Total line (over the bars)
    const linePts = totals
      .map((v, i) => `${P.l + xStep * (i + 0.5)},${yScale(v)}`)
      .join(' ');

    // Daily budget + stretch reference lines
    const budgetLine = dailyRate > 0 ? `
      <line x1="${P.l}" x2="${W - P.r}" y1="${yScale(dailyRate)}" y2="${yScale(dailyRate)}"
            stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="5 4"/>
    ` : '';
    const stretchLine = dailyStretch > 0 ? `
      <line x1="${P.l}" x2="${W - P.r}" y1="${yScale(dailyStretch)}" y2="${yScale(dailyStretch)}"
            stroke="#dc2626" stroke-width="1.4" stroke-dasharray="3 3"/>
    ` : '';

    return `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
        ${ticks.join('')}
        ${bars.join('')}
        <polyline points="${linePts}" fill="none" stroke="#6366f1" stroke-width="2"/>
        ${budgetLine}
        ${stretchLine}
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
    const swatch = (color: string, dashed = false) =>
      dashed
        ? `<span style="display:inline-block;width:14px;height:0;border-top:2px dashed ${color};vertical-align:middle;margin-right:4px"></span>`
        : `<span style="display:inline-block;width:8px;height:8px;background:${color};border-radius:1px;margin-right:4px;vertical-align:middle"></span>`;
    return `
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:6px;font-size:9px;color:#374151">
        <span>${swatch('#1e40af')}Diesel</span>
        <span>${swatch('#0891b2')}Blend</span>
        <span>${swatch('#059669')}ULP</span>
        <span>${swatch('#6366f1')}Total line</span>
        <span>${swatch('#f59e0b', true)}Daily budget ${dailyRate > 0 ? `(${Math.round(dailyRate).toLocaleString('en')} L)` : ''}</span>
        <span>${swatch('#dc2626', true)}Daily stretch ${dailyStretch > 0 ? `(${Math.round(dailyStretch).toLocaleString('en')} L)` : ''}</span>
      </div>
    `;
  };

  // ── Inline SVG: territory donut ────────────────────────────────────────
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
    growth?: number | null;
    highlight?: boolean;
  }) => {
    const { icon, label, value, sub, badgePct, badgeText, growth, highlight } = opts;
    const badge =
      badgeText
        ? `<span class="kpi-badge ${badgeClass(badgePct)}">${esc(badgeText)}</span>`
        : badgePct != null
          ? `<span class="kpi-badge ${badgeClass(badgePct)}">${fmtVar(badgePct)}</span>`
          : '';
    const growthLine = growth != null
      ? `<p class="kpi-growth ${growthClass(growth)}">${growthArrow(growth)} ${Math.abs(growth).toFixed(1)}% vs prior</p>`
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
  .page { padding: 28px 36px; }

  /* ── Header ─────────────────────────────────────────────────── */
  .hdr { display: flex; justify-content: space-between; align-items: flex-end;
         padding-bottom: 12px; margin-bottom: 20px; border-bottom: 2px solid #1e3a5f; }
  .hdr h1 { font-size: 20px; font-weight: 700; color: #1e3a5f; letter-spacing: -0.2px; }
  .hdr .sub { font-size: 10px; color: #9ca3af; margin-top: 2px; }
  .hdr .meta { text-align: right; font-size: 9.5px; color: #6b7280; line-height: 1.55; }
  .hdr .meta strong { color: #111827; font-weight: 600; }
  .badge { display: inline-block; background: #1e3a5f; color: #fff;
           padding: 2px 8px; border-radius: 3px; font-size: 9px;
           font-weight: 600; letter-spacing: 0.4px; }

  /* ── Section title ──────────────────────────────────────────── */
  .stitle { font-size: 10px; font-weight: 700; color: #6b7280;
            text-transform: uppercase; letter-spacing: 1.2px;
            margin: 22px 0 10px; }

  /* ── KPI tiles (match dashboard KPICards.tsx exactly) ────────── */
  .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .kpi  { position: relative; background: #ffffff; border: 1px solid #e5e7eb;
          border-radius: 10px; padding: 10px 14px; overflow: hidden; }
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
  .kpi-label { font-size: 11px; font-weight: 600; color: #6b7280;
               text-transform: uppercase; letter-spacing: 0.5px;
               margin-bottom: 4px; }
  .kpi-value { font-size: 18px; font-weight: 700; color: #111827;
               line-height: 1.2; letter-spacing: -0.3px;
               font-variant-numeric: tabular-nums; }
  .kpi-sub { font-size: 11px; color: #9ca3af; margin-top: 4px;
             font-variant-numeric: tabular-nums; }
  .kpi-growth { font-size: 11px; font-weight: 600; margin-top: 8px;
                font-variant-numeric: tabular-nums; }
  .g-green { color: #16a34a; }
  .g-red   { color: #dc2626; }

  /* ── Tables ────────────────────────────────────────────────── */
  table { width: 100%; border-collapse: collapse; }
  th { background: #f3f4f6; color: #6b7280; font-size: 9px;
       text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
       text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  th.num { text-align: right; }
  td { font-size: 10px; padding: 7px 10px; border-bottom: 1px solid #f3f4f6;
       color: #111827; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.muted { color: #9ca3af; }
  tr:last-child td { border-bottom: none; }
  .rnk { display: inline-block; width: 16px; height: 16px; border-radius: 50%;
         background: #e5e7eb; color: #374151; font-size: 9px; font-weight: 700;
         text-align: center; line-height: 16px; }

  /* ── Comments ──────────────────────────────────────────────── */
  .cmt { border-left: 3px solid #1e3a5f; padding: 6px 10px; margin-bottom: 6px;
         background: #f9fafb; border-radius: 0 4px 4px 0; }
  .cmt .who { font-size: 9px; color: #6b7280; margin-bottom: 2px; }
  .cmt .who strong { color: #111827; }
  .cmt .txt { font-size: 10px; color: #374151; }

  /* ── Footer ────────────────────────────────────────────────── */
  .ftr { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb;
         display: flex; justify-content: space-between;
         font-size: 8.5px; color: #9ca3af; }

  /* ── Page breaks ───────────────────────────────────────────── */
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .pghdr { display: flex; justify-content: space-between; align-items: baseline;
           margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  .pghdr h2 { font-size: 14px; font-weight: 700; color: #1e3a5f; }
  .pghdr span { font-size: 9px; color: #9ca3af; }

  /* ── Long-table pagination (Full Site Breakdown) ─────────── */
  table.paged       { table-layout: auto; }
  table.paged thead { display: table-header-group; }
  table.paged tfoot { display: table-row-group; }
  table.paged tr    { page-break-inside: avoid; }
  table.compact th, table.compact td { padding: 5px 6px; font-size: 9px; }

  /* ── Charts row ────────────────────────────────────────────── */
  .charts-row { display: grid; grid-template-columns: 2fr 1fr;
                gap: 10px; margin-top: 10px; }
  .chart-card { background: #fff; border: 1px solid #e5e7eb;
                border-radius: 10px; padding: 10px 14px;
                display: flex; flex-direction: column; }
  .chart-card.daily { height: 240px; }
  .chart-card.donut { height: 240px; align-items: center; }
  .chart-title { font-size: 11px; font-weight: 700; color: #111827;
                 margin-bottom: 6px; align-self: flex-start; }
  .chart-card svg { display: block; flex: 1 1 auto; min-height: 0;
                    width: 100%; height: 100%; }
  .chart-card.donut svg { max-width: 200px; max-height: 200px; }
</style>
</head>
<body>

<!-- ─────────────────────────── PAGE 1 — KPIs ─────────────────────────── -->
<div class="page">

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

    ${tile({
      icon:  'barrel',
      label: 'MTD Volume',
      value: `${fmtVol(kpis.mtd?.volume)} L`,
      sub:   `Budget: ${fmtVol(kpis.budget?.mtdBudget)} L (${kpis.budget?.daysElapsed ?? '—'}/${kpis.budget?.daysInMonth ?? '—'} days)`,
      badgePct: kpis.budget?.vsBudgetPct,
      highlight: true,
    })}

    ${tile({
      icon:  'chart',
      label: 'YTD Volume',
      value: `${fmtVol(kpis.ytd?.volume)} L`,
      sub:   `YTD vs pro-rata budget: ${fmtVar(kpis.ytd?.vsBudgetPct)}`,
      badgePct: kpis.ytd?.vsBudgetPct,
      growth:   kpis.growth?.ytdGrowthPct ?? null,
    })}

    ${tile({
      icon:  'target',
      label: 'Vs Stretch',
      value: fmtVar(kpis.budget?.vsStretchPct),
      sub:   'vs pro-rated stretch target',
      badgePct: kpis.budget?.vsStretchPct,
      badgeText: (kpis.budget?.vsStretchPct ?? 0) >= 100 ? 'ACHIEVED' : undefined,
    })}

    ${tile({
      icon:  'trending',
      label: 'MTD Growth',
      value: kpis.growth?.mtdGrowthPct != null
              ? `${kpis.growth.mtdGrowthPct >= 0 ? '+' : ''}${kpis.growth.mtdGrowthPct.toFixed(1)}%`
              : '—',
      sub:   `Prior: ${fmtVol(kpis.growth?.priorMtdVolume)} L`,
      growth: kpis.growth?.mtdGrowthPct ?? null,
    })}

    ${tile({
      icon:  'lightning',
      label: 'Avg Daily',
      value: `${fmtVol(kpis.mtd?.avgDaily)} L`,
      sub:   `${kpis.mtd?.tradingDays ?? 0} days · ${kpis.mtd?.activeSites ?? 0} sites`,
    })}

    ${tile({
      icon:  'dollar',
      label: 'MTD Revenue',
      value: fmtRev(kpis.mtd?.revenue),
      sub:   'Total invoiced revenue',
    })}

    ${tile({
      icon:  'handshake',
      label: 'Petrotrade Vol',
      value: `${fmtVol(kpis.petrotrade?.mtdVolume)} L`,
      sub:   `Margin: ${fmtRev(kpis.petrotrade?.mtdMargin)}`,
    })}

    ${tile({
      icon:  'cash',
      label: 'Cash Ratio',
      value: kpis.mtd?.cashRatio != null
              ? `${(kpis.mtd.cashRatio * 100).toFixed(1)}%`
              : '—',
      sub:   'Cash / total revenue',
    })}

    ${tile({
      icon:  'store',
      label: 'Active Sites',
      value: String(kpis.mtd?.activeSites ?? '—'),
      sub:   `${kpis.mtd?.tradingDays ?? 0} days reporting`,
    })}

    ${tile({
      icon:  'calendar',
      label: 'Avg Margin / Site',
      value: kpis.margin?.avgCplPerSite != null
              ? `${kpis.margin.avgCplPerSite.toFixed(1)} ¢/L`
              : '—',
      sub:   kpis.margin?.sitesWithMargin
              ? `${kpis.margin.sitesWithMargin} sites · net gross margin`
              : 'Net gross margin',
    })}

  </div>

  <!-- Charts row: daily trend + territory donut -->
  <div class="charts-row">
    <div class="chart-card daily">
      <div class="chart-title">Daily Volume Trend
        <span style="font-size:9px;color:#9ca3af;font-weight:400">
          · ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(data.trendMonth?.month || 1) - 1]} ${data.trendMonth?.year || ''}
          ${(() => {
            const stats = dailyChartStats(data.trend || [], data.trendMonth || { monthEndDay: 30 });
            return stats ? ` · ${stats}` : '';
          })()}
        </span>
      </div>
      ${dailyChartSVG(data.trend || [], data.trendMonth || { year: new Date().getFullYear(), month: new Date().getMonth()+1, monthEndDay: 30 })}
      ${dailyChartLegend(data.trend || [], data.trendMonth || { monthEndDay: 30 })}
    </div>
    <div class="chart-card donut">
      <div class="chart-title">Territory Distribution</div>
      ${territoryDonutSVG(territories || [])}
    </div>
  </div>

  <div class="ftr">
    <span>Redan Sales Dashboard · Confidential</span>
    <span>Page 1 of 3 · ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
  </div>
</div>

<!-- ─────────────────────── PAGE 2 — Territory + Top 10 ─────────────────────── -->
<div class="page">

  <div class="pghdr">
    <h2>Territory &amp; Top Sites</h2>
    <span>${fmtPeriod(meta.dateFrom)} → ${fmtPeriod(meta.dateTo)}</span>
  </div>

  <div class="stitle">Territory Performance · Aggregated by Territory Manager</div>
  <table>
    <thead><tr>
      <th>Territory</th>
      <th class="num">Sites</th>
      <th class="num">Volume (L)</th>
      <th class="num">Revenue</th>
      <th class="num">Avg / Day</th>
      <th class="num">Budget (L)</th>
      <th class="num">Vs Budget</th>
      <th class="num">Vs Stretch</th>
      <th class="num">Net Margin</th>
      <th class="num">Share</th>
      <th class="num">Diesel</th>
      <th class="num">Blend</th>
      <th class="num">ULP</th>
    </tr></thead>
    <tbody>
      ${(territories || []).map((t: any) => `
        <tr>
          <td><strong>${esc(t.territoryName || t.territoryCode)}</strong></td>
          <td class="num muted">${t.siteCount ?? '—'}</td>
          <td class="num">${fmtVol(t.volume)}</td>
          <td class="num muted">${fmtRev(t.revenue)}</td>
          <td class="num muted">${fmtVol(t.avgDaily)}</td>
          <td class="num muted">${fmtVol(t.budgetVolume)}</td>
          <td class="num" style="color:${varColor(t.vsBudgetPct)};font-weight:600">${fmtVar(t.vsBudgetPct)}</td>
          <td class="num" style="color:${varColor(t.vsStretchPct)}">${fmtVar(t.vsStretchPct)}</td>
          <td class="num">${t.netMarginCpl != null ? `${t.netMarginCpl.toFixed(1)} ¢/L` : '—'}</td>
          <td class="num muted">${t.contributionPct != null ? t.contributionPct.toFixed(1) + '%' : '—'}</td>
          <td class="num muted">${fmtVol(t.dieselVol)}</td>
          <td class="num muted">${fmtVol(t.blendVol)}</td>
          <td class="num muted">${fmtVol(t.ulpVol)}</td>
        </tr>`).join('')}
    </tbody>
  </table>

  <div class="stitle" style="margin-top: 18px">Top 10 Sites · by Volume</div>
  <table>
    <thead><tr>
      <th style="width:24px">#</th>
      <th>Site</th>
      <th>Territory</th>
      <th>MOSO</th>
      <th class="num">Volume (L)</th>
      <th class="num">Avg Daily</th>
      <th class="num">Budget (L)</th>
      <th class="num">Vs Budget</th>
      <th class="num">Vs Stretch</th>
      <th class="num">Share</th>
    </tr></thead>
    <tbody>
      ${(topSites || []).map((s: any) => `
        <tr>
          <td><span class="rnk">${s.rank}</span></td>
          <td><strong>${esc(s.siteName)}</strong></td>
          <td class="muted">${esc(s.territoryName) || '—'}</td>
          <td class="muted">${esc(s.moso) || '—'}</td>
          <td class="num">${fmtVol(s.volume)}</td>
          <td class="num muted">${fmtVol(s.avgDaily)}</td>
          <td class="num muted">${fmtVol(s.budgetVolume)}</td>
          <td class="num" style="color:${varColor(s.vsBudgetPct)};font-weight:600">${fmtVar(s.vsBudgetPct)}</td>
          <td class="num" style="color:${varColor(s.vsStretchPct)}">${fmtVar(s.vsStretchPct)}</td>
          <td class="num muted">${s.contributionPct != null ? s.contributionPct.toFixed(1) + '%' : '—'}</td>
        </tr>`).join('')}
    </tbody>
  </table>

  ${comments && comments.length > 0 ? `
    <div class="stitle" style="margin-top: 18px">Analyst Notes</div>
    ${comments.map((c: any) => `
      <div class="cmt">
        <div class="who"><strong>${esc(c.author)}</strong> · ${new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}${c.ref_site_code ? ` · ${esc(c.ref_site_code)}` : ''}</div>
        <div class="txt">${esc(c.comment_text)}</div>
      </div>
    `).join('')}
  ` : ''}

  <div class="ftr">
    <span>Redan Sales Dashboard · Confidential</span>
    <span>Page 2 of 3</span>
  </div>
</div>

<!-- ─────────────────────── PAGE 3 — Full Site Breakdown ─────────────────────── -->
<div class="page">

  <div class="pghdr">
    <h2>Full Site Breakdown</h2>
    <span>${(breakdown || []).length} sites · ${fmtPeriod(meta.dateFrom)} → ${fmtPeriod(meta.dateTo)}</span>
  </div>

  <table class="paged compact">
    <thead><tr>
      <th>Site</th>
      <th>Territory</th>
      <th>MOSO</th>
      <th class="num">Volume (L)</th>
      <th class="num">Revenue</th>
      <th class="num">Avg / Day</th>
      <th class="num">Cum. Loss (L)</th>
      <th class="num">Cash %</th>
      <th class="num">Coupon (L)</th>
      <th class="num">Card (L)</th>
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
        return `
        <tr>
          <td><strong>${esc(r.site_name || r.site_code)}</strong></td>
          <td class="muted">${esc(r.territory_name) || '—'}</td>
          <td class="muted">${esc(r.moso) || '—'}</td>
          <td class="num">${fmtVol(vol)}</td>
          <td class="num muted">${fmtRev(rev)}</td>
          <td class="num muted">${fmtVol(avg)}</td>
          <td class="num" style="color:${lossColor}">${fmtVol(loss)}</td>
          <td class="num muted">${cashPct != null ? cashPct.toFixed(1) + '%' : '—'}</td>
          <td class="num muted">${couponVol > 0 ? fmtVol(couponVol) : '—'}</td>
          <td class="num muted">${cardVol   > 0 ? fmtVol(cardVol)   : '—'}</td>
          <td class="num muted">${flexVol   > 0 ? fmtVol(flexVol)   : '—'}</td>
          <td class="num">${cpl != null ? `${cpl.toFixed(1)} ¢/L` : '—'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  <div class="ftr">
    <span>Redan Sales Dashboard · Confidential</span>
    <span>Page 3 of 3</span>
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

    // Fetch all data for the report. Forward the inbound cookie so the
    // internal API calls survive middleware auth.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const params = new URLSearchParams({ dateFrom, dateTo, ...(territory && { territory }), ...(product && { product }) });
    const cookie = req.headers.get('cookie') || '';
    const fwd    = { headers: { cookie } };

    // Daily sales trend for the current month of the report's `dateTo` —
    // independent of dateFrom so the chart always shows a full month.
    const refDate     = new Date(dateTo);
    const refYear     = refDate.getFullYear();
    const refMonth    = refDate.getMonth() + 1;
    const monthStart  = `${refYear}-${String(refMonth).padStart(2,'0')}-01`;
    const monthEndDay = new Date(refYear, refMonth, 0).getDate();
    const monthEnd    = `${refYear}-${String(refMonth).padStart(2,'0')}-${String(monthEndDay).padStart(2,'0')}`;
    const trendParams = new URLSearchParams({
      dateFrom: monthStart, dateTo: monthEnd, granularity: 'daily',
      ...(territory && { territory }), ...(product && { product }),
    });

    const [kpisRes, topSitesRes, territoriesRes, trendRes] = await Promise.all([
      fetch(`${baseUrl}/api/kpis?${params}`,             fwd).then(r => r.json()),
      fetch(`${baseUrl}/api/top-sites?${params}&limit=10`, fwd).then(r => r.json()),
      fetch(`${baseUrl}/api/territory-performance?${params}`, fwd).then(r => r.json()),
      fetch(`${baseUrl}/api/sales-trend?${trendParams}`, fwd).then(r => r.json()),
    ]);

    if (kpisRes?.error || topSitesRes?.error || territoriesRes?.error) {
      console.error('Report data fetch failed:', { kpisRes, topSitesRes, territoriesRes });
      return NextResponse.json({
        error: 'Could not load report data — ' +
               (kpisRes?.error || topSitesRes?.error || territoriesRes?.error),
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
    // margin_data is keyed by (site_code, period_month). Sum the months that
    // intersect [dateFrom..dateTo].
    const marginParams: any[] = [dateFrom, dateTo];
    let marginTerritoryClause = '';
    if (territory) {
      marginParams.push(String(territory).toUpperCase());
      marginTerritoryClause = `AND t.tm_code = $${marginParams.length}`;
    }
    const marginRow = await queryOne<any>(`
      SELECT
        COALESCE(SUM(m.gross_margin),     0) AS gross_margin,
        COALESCE(SUM(m.net_gross_margin), 0) AS net_margin,
        COALESCE(SUM(m.inv_volume),       0) AS inv_volume
      FROM margin_data m
      JOIN sites si ON m.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE m.period_month >= DATE_TRUNC('month', $1::DATE)
        AND m.period_month <= DATE_TRUNC('month', $2::DATE)
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
          SELECT COALESCE(SUM(m2.net_gross_margin), 0)
          FROM margin_data m2
          WHERE m2.site_code = si.site_code
            AND m2.period_month >= DATE_TRUNC('month', $1::DATE)
            AND m2.period_month <= DATE_TRUNC('month', $2::DATE)
        ) AS net_margin,
        (
          SELECT COALESCE(SUM(m3.inv_volume), 0)
          FROM margin_data m3
          WHERE m3.site_code = si.site_code
            AND m3.period_month >= DATE_TRUNC('month', $1::DATE)
            AND m3.period_month <= DATE_TRUNC('month', $2::DATE)
        ) AS inv_volume
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
    });

    // Use Puppeteer to generate PDF (available via @sparticuz/chromium in serverless)
    let pdfBuffer: Buffer;
    try {
      const puppeteer = await import('puppeteer-core');
      const chromium  = await import('@sparticuz/chromium');
      const browser = await puppeteer.default.launch({
        args: chromium.default.args,
        defaultViewport: chromium.default.defaultViewport,
        executablePath: await chromium.default.executablePath(),
        headless: true,
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfRaw = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      await browser.close();
      pdfBuffer = Buffer.from(pdfRaw);
    } catch (puppeteerErr) {
      // Fallback: return HTML for client-side printing
      console.warn('Puppeteer unavailable, returning HTML:', puppeteerErr);
      return NextResponse.json({
        reportId,
        html,
        fallback: true,
        message: 'PDF engine unavailable — use browser print (Ctrl+P) on the HTML',
      });
    }

    // Return PDF
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="fuel-report-${dateFrom}-${dateTo}.pdf"`,
        'X-Report-Id': reportId,
      },
    });

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
