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
  const { meta, kpis, topSites, territories, comments } = data;
  const fmtVol  = (n: number) => n?.toLocaleString('en', { maximumFractionDigits: 0 }) ?? '—';
  const fmtRev  = (n: number) => n != null ? `$${n.toLocaleString('en', { maximumFractionDigits: 0 })}` : '—';
  const fmtPct  = (n: number | null) => n != null ? `${n.toFixed(1)}%` : '—';
  const kpiColor = (pct: number | null) => {
    if (pct == null) return '#6b7280';
    return pct >= 100 ? '#16a34a' : pct >= 85 ? '#d97706' : '#dc2626';
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #111; background: white; }
  .page { padding: 24px 32px; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 3px solid #1e3a5f; padding-bottom: 12px; margin-bottom: 20px; }
  .header-left h1 { font-size: 22px; color: #1e3a5f; font-weight: 700; }
  .header-left p  { color: #6b7280; font-size: 10px; margin-top: 2px; }
  .header-right   { text-align: right; color: #374151; font-size: 10px; line-height: 1.6; }
  .badge { display: inline-block; background: #1e3a5f; color: white;
           padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 600; }

  /* Section titles */
  .section-title { font-size: 13px; font-weight: 700; color: #1e3a5f;
                   border-left: 4px solid #f59e0b; padding-left: 8px;
                   margin: 20px 0 12px; }

  /* KPI grid */
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px;
              background: #f8fafc; }
  .kpi-label { font-size: 9px; color: #6b7280; text-transform: uppercase;
               letter-spacing: 0.5px; margin-bottom: 4px; }
  .kpi-value { font-size: 18px; font-weight: 700; color: #111; }
  .kpi-sub   { font-size: 9px; color: #6b7280; margin-top: 2px; }
  .kpi-pct   { font-size: 12px; font-weight: 600; margin-top: 4px; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead tr { background: #1e3a5f; color: white; }
  thead th { padding: 7px 8px; text-align: left; font-size: 9px;
             text-transform: uppercase; letter-spacing: 0.4px; }
  thead th.num { text-align: right; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  tbody tr:hover { background: #eff6ff; }
  tbody td { padding: 6px 8px; font-size: 10px; border-bottom: 1px solid #e5e7eb; }
  tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .rank-badge { display: inline-block; background: #1e3a5f; color: white;
                width: 18px; height: 18px; border-radius: 50%;
                text-align: center; line-height: 18px; font-size: 9px; }
  .rank-1 { background: #f59e0b; }
  .rank-2 { background: #9ca3af; }
  .rank-3 { background: #cd7c3a; }

  .pct-pill { padding: 1px 6px; border-radius: 10px; font-size: 9px; font-weight: 600; }
  .pct-green { background: #d1fae5; color: #065f46; }
  .pct-amber { background: #fef3c7; color: #92400e; }
  .pct-red   { background: #fee2e2; color: #991b1b; }

  /* Territory table */
  .territory-section { margin-top: 16px; }

  /* Comments */
  .comment { border-left: 3px solid #f59e0b; padding: 8px 10px;
             background: #fffbeb; margin-bottom: 8px; border-radius: 0 4px 4px 0; }
  .comment-meta { font-size: 9px; color: #6b7280; margin-bottom: 3px; }
  .comment-text { font-size: 10px; color: #111; }

  /* Footer */
  .footer { margin-top: 30px; border-top: 1px solid #e5e7eb;
            padding-top: 10px; display: flex; justify-content: space-between;
            font-size: 9px; color: #9ca3af; }

  /* Executive summary */
  .exec-summary { background: #f0f4ff; border: 1px solid #c7d2fe;
                  border-radius: 6px; padding: 14px; margin-bottom: 16px; }
  .exec-summary p { font-size: 11px; line-height: 1.7; color: #374151; }

  .tag { display: inline-block; background: #e0e7ff; color: #3730a3;
         padding: 1px 6px; border-radius: 3px; font-size: 9px; margin-right: 4px; }
  .flag-red { color: #dc2626; font-weight: 600; }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div class="header-left">
      <h1>⛽ Fuel Sales Intelligence Report</h1>
      <p>Confidential — Internal Use Only</p>
    </div>
    <div class="header-right">
      <span class="badge">${esc(meta.territory) || 'ALL TERRITORIES'}</span><br/>
      <strong>Period:</strong> ${esc(meta.dateFrom)} → ${esc(meta.dateTo)}<br/>
      <strong>Generated:</strong> ${new Date().toLocaleString('en-GB')}<br/>
      <strong>Prepared by:</strong> ${esc(meta.generatedBy) || 'System'}
    </div>
  </div>

  <!-- EXECUTIVE SUMMARY -->
  <div class="section-title">1. Executive Summary</div>
  <div class="exec-summary">
    <p>
      For the period <strong>${esc(meta.dateFrom)}</strong> to <strong>${esc(meta.dateTo)}</strong>,
      the network achieved total volume of <strong>${fmtVol(kpis.mtd?.volume)} litres</strong>
      against a budget of <strong>${fmtVol(kpis.budget?.mtdBudget)} litres</strong>
      (<strong style="color: ${kpiColor(kpis.budget?.vsBudgetPct)}">${fmtPct(kpis.budget?.vsBudgetPct)} of budget</strong>).
      YTD volume stands at <strong>${fmtVol(kpis.ytd?.volume)} litres</strong>
      (${fmtPct(kpis.ytd?.vsBudgetPct)} of YTD budget).
      ${kpis.growth?.mtdGrowthPct != null
        ? `Volume growth vs prior period is <strong>${fmtPct(kpis.growth.mtdGrowthPct)}</strong>.`
        : ''}
      Average daily sales are <strong>${fmtVol(kpis.mtd?.avgDaily)} L/day</strong>
      across <strong>${kpis.mtd?.activeSites}</strong> active sites.
      Petrotrade volumes contributed <strong>${fmtVol(kpis.petrotrade?.mtdVolume)} litres</strong>
      (fixed margin: $${((kpis.petrotrade?.mtdMargin || 0)).toLocaleString('en', {maximumFractionDigits: 0})}).
    </p>
  </div>

  <!-- KPI SECTION -->
  <div class="section-title">2. Key Performance Indicators</div>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">MTD Volume</div>
      <div class="kpi-value">${fmtVol(kpis.mtd?.volume)}</div>
      <div class="kpi-sub">Litres | Budget: ${fmtVol(kpis.budget?.mtdBudget)}</div>
      <div class="kpi-pct" style="color:${kpiColor(kpis.budget?.vsBudgetPct)}">
        ${fmtPct(kpis.budget?.vsBudgetPct)} of budget
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">YTD Volume</div>
      <div class="kpi-value">${fmtVol(kpis.ytd?.volume)}</div>
      <div class="kpi-sub">Litres YTD</div>
      <div class="kpi-pct" style="color:${kpiColor(kpis.ytd?.vsBudgetPct)}">
        ${fmtPct(kpis.ytd?.vsBudgetPct)} of YTD budget
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Growth vs Prior Period</div>
      <div class="kpi-value" style="color:${(kpis.growth?.mtdGrowthPct || 0) >= 0 ? '#16a34a' : '#dc2626'}">
        ${kpis.growth?.mtdGrowthPct != null ? ((kpis.growth.mtdGrowthPct >= 0 ? '+' : '') + fmtPct(kpis.growth.mtdGrowthPct)) : '—'}
      </div>
      <div class="kpi-sub">Prior: ${fmtVol(kpis.growth?.priorMtdVolume)} L</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Avg Daily Sales</div>
      <div class="kpi-value">${fmtVol(kpis.mtd?.avgDaily)}</div>
      <div class="kpi-sub">Litres/day | ${kpis.mtd?.tradingDays} days</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Vs Stretch Target</div>
      <div class="kpi-value" style="color:${kpiColor(kpis.budget?.vsStretchPct)}">
        ${fmtPct(kpis.budget?.vsStretchPct)}
      </div>
      <div class="kpi-sub">Stretch: ${fmtVol(kpis.budget?.mtdStretch)} L</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Cash Ratio</div>
      <div class="kpi-value">${kpis.mtd?.cashRatio != null ? (kpis.mtd.cashRatio * 100).toFixed(1) + '%' : '—'}</div>
      <div class="kpi-sub">Cash / Total Revenue</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Petrotrade Volume</div>
      <div class="kpi-value">${fmtVol(kpis.petrotrade?.mtdVolume)}</div>
      <div class="kpi-sub">Margin: ${fmtRev(kpis.petrotrade?.mtdMargin)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Active Sites</div>
      <div class="kpi-value">${kpis.mtd?.activeSites ?? '—'}</div>
      <div class="kpi-sub">Reporting sites</div>
    </div>
  </div>

  <!-- TOP SITES TABLE -->
  <div class="section-title">3. Top 10 Sites by Volume</div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Site Name</th>
        <th>Territory</th>
        <th>MOSO</th>
        <th class="num">Volume (L)</th>
        <th class="num">Avg Daily</th>
        <th class="num">Budget (L)</th>
        <th class="num">Vs Budget</th>
        <th class="num">Contribution</th>
      </tr>
    </thead>
    <tbody>
      ${topSites.map((s: any) => {
        const pctClass = (s.vsBudgetPct || 0) >= 100 ? 'pct-green' : (s.vsBudgetPct || 0) >= 85 ? 'pct-amber' : 'pct-red';
        return `<tr>
          <td><span class="rank-badge rank-${s.rank}">${s.rank}</span></td>
          <td>${esc(s.siteName)}</td>
          <td>${esc(s.territoryName) || '—'}</td>
          <td><span class="tag">${esc(s.moso) || '—'}</span></td>
          <td class="num">${fmtVol(s.volume)}</td>
          <td class="num">${fmtVol(s.avgDaily)}</td>
          <td class="num">${fmtVol(s.budgetVolume)}</td>
          <td class="num"><span class="pct-pill ${pctClass}">${fmtPct(s.vsBudgetPct)}</span></td>
          <td class="num">${fmtPct(s.contributionPct)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  <!-- TERRITORY BREAKDOWN -->
  <div class="section-title">4. Territory Performance</div>
  <div class="territory-section">
    <table>
      <thead>
        <tr>
          <th>Territory</th>
          <th class="num">Sites</th>
          <th class="num">Volume (L)</th>
          <th class="num">Revenue ($)</th>
          <th class="num">Avg Daily</th>
          <th class="num">Budget (L)</th>
          <th class="num">Vs Budget</th>
          <th class="num">Vs Stretch</th>
          <th class="num">Contribution</th>
        </tr>
      </thead>
      <tbody>
        ${territories.map((t: any) => {
          const pctClass = (t.vsBudgetPct || 0) >= 100 ? 'pct-green' : (t.vsBudgetPct || 0) >= 85 ? 'pct-amber' : 'pct-red';
          return `<tr>
            <td><strong>${esc(t.territoryName || t.territoryCode)}</strong></td>
            <td class="num">${t.siteCount}</td>
            <td class="num">${fmtVol(t.volume)}</td>
            <td class="num">${fmtRev(t.revenue)}</td>
            <td class="num">${fmtVol(t.avgDaily)}</td>
            <td class="num">${fmtVol(t.budgetVolume)}</td>
            <td class="num"><span class="pct-pill ${pctClass}">${fmtPct(t.vsBudgetPct)}</span></td>
            <td class="num">${fmtPct(t.vsStretchPct)}</td>
            <td class="num">${fmtPct(t.contributionPct)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <!-- COMMENTS -->
  ${comments.length > 0 ? `
  <div class="section-title">5. Analyst Comments & Notes</div>
  ${comments.map((c: any) => `
    <div class="comment">
      <div class="comment-meta">
        <strong>${esc(c.author)}</strong> · ${new Date(c.created_at).toLocaleString('en-GB')}
        ${c.ref_site_code ? ` · Site: ${esc(c.ref_site_code)}` : ''}
        ${c.comment_type !== 'general' ? ` · <span class="tag">${esc(c.comment_type)}</span>` : ''}
      </div>
      <div class="comment-text">${esc(c.comment_text)}</div>
    </div>
  `).join('')}
  ` : ''}

  <!-- FOOTER -->
  <div class="footer">
    <span>Fuel Sales Intelligence Platform © ${new Date().getFullYear()}</span>
    <span>CONFIDENTIAL — For internal distribution only</span>
    <span>Generated: ${new Date().toLocaleString('en-GB')}</span>
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
    const { dateFrom, dateTo, territory, product, generatedBy, reportName } = body;

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
    }

    // Fetch all data for the report
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const params = new URLSearchParams({ dateFrom, dateTo, ...(territory && { territory }), ...(product && { product }) });

    const [kpisRes, topSitesRes, territoriesRes] = await Promise.all([
      fetch(`${baseUrl}/api/kpis?${params}`).then(r => r.json()),
      fetch(`${baseUrl}/api/top-sites?${params}&limit=10`).then(r => r.json()),
      fetch(`${baseUrl}/api/territory-performance?${params}`).then(r => r.json()),
    ]);

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

    // Build HTML
    const html = buildReportHTML({
      meta: { dateFrom, dateTo, territory, generatedBy, reportName },
      kpis: kpisRes,
      topSites: topSitesRes.data || [],
      territories: territoriesRes.data || [],
      comments: commentsRows,
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
        printBackground: true,
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
