// app/api/yearly-volume-vs-budget/route.ts
//
// Returns 12 months × {actual current year, budget current year, actual prior
// year} broken down by product. The chart that consumes this is intentionally
// independent of the dashboard's date filters — its scope is always the year
// containing the most recent sale_date in the DB. Non-date filters (territory,
// MOSO, product, siteCode) are still honored.
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RowOut {
  month: string;          // 'YYYY-MM-01'
  monthLabel: string;     // 'Jan'
  isFuture: boolean;
  isCurrent: boolean;
  actualCY: { diesel: number; blend: number; ulp: number; total: number } | null;
  actualPY: { diesel: number; blend: number; ulp: number; total: number } | null;
  budgetCY: number | null;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const territory = sp.get('territory') || undefined;
    const moso      = sp.get('moso')      || undefined;
    const siteCode  = sp.get('siteCode')  || undefined;

    // Anchor on the latest sale_date so test data with a future-year corpus
    // still produces meaningful "current year" output.
    const anchor = await queryOne<any>(`SELECT MAX(sale_date) AS d FROM sales`);
    const latest: Date = anchor?.d ? new Date(anchor.d) : new Date();
    const cy = latest.getUTCFullYear();
    const py = cy - 1;
    const latestMonth = latest.getUTCMonth() + 1; // 1-12
    const cyStart = `${cy}-01-01`;
    const cyEnd   = `${cy}-12-31`;
    const pyStart = `${py}-01-01`;
    const pyEnd   = `${py}-12-31`;

    // Build dynamic WHERE for non-date filters
    const filterClauses: string[] = [];
    const filterParams: any[] = [];
    if (territory) {
      filterParams.push(territory.toUpperCase());
      filterClauses.push(`t.tm_code = $${filterParams.length}`);
    }
    if (moso) {
      filterParams.push(moso.toUpperCase());
      filterClauses.push(`si.moso = $${filterParams.length}`);
    }
    if (siteCode) {
      filterParams.push(siteCode);
      filterClauses.push(`s.site_code = $${filterParams.length}`);
    }
    const filterSql = filterClauses.length ? `AND ${filterClauses.join(' AND ')}` : '';

    // Sales aggregated by (month, year) and product. We do both years in one
    // query for efficiency.
    const salesRows = await query<any>(`
      SELECT EXTRACT(YEAR  FROM s.sale_date)::INT AS yr,
             EXTRACT(MONTH FROM s.sale_date)::INT AS mo,
             COALESCE(SUM(s.diesel_sales_volume + s.flex_diesel_volume), 0) AS diesel,
             COALESCE(SUM(s.blend_sales_volume  + s.flex_blend_volume),  0) AS blend,
             COALESCE(SUM(s.ulp_sales_volume),                            0) AS ulp,
             COALESCE(SUM(s.total_volume),                                0) AS total
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE s.sale_date BETWEEN $1::DATE AND $2::DATE
      ${filterSql}
      GROUP BY 1, 2
    `, [pyStart, cyEnd, ...filterParams]);

    // Budget for current year, aggregated by month. Same filter parameters
    // apply but referenced from volume_budget so the param indexes are reused.
    const budgetFilterClauses: string[] = [];
    const budgetParams: any[] = [];
    if (territory) {
      budgetParams.push(territory.toUpperCase());
      budgetFilterClauses.push(`t.tm_code = $${budgetParams.length}`);
    }
    if (moso) {
      budgetParams.push(moso.toUpperCase());
      budgetFilterClauses.push(`si.moso = $${budgetParams.length}`);
    }
    if (siteCode) {
      budgetParams.push(siteCode);
      budgetFilterClauses.push(`vb.site_code = $${budgetParams.length}`);
    }
    const budgetFilterSql = budgetFilterClauses.length ? `AND ${budgetFilterClauses.join(' AND ')}` : '';

    const budgetRows = await query<any>(`
      SELECT EXTRACT(MONTH FROM vb.budget_month)::INT AS mo,
             COALESCE(SUM(vb.budget_volume), 0) AS budget
      FROM volume_budget vb
      JOIN sites si ON vb.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE vb.budget_month >= $1::DATE AND vb.budget_month <= $2::DATE
      ${budgetFilterSql}
      GROUP BY 1
    `, [cyStart, cyEnd, ...budgetParams]);

    // Build a 12-row table indexed by month
    const cyByMonth = new Map<number, any>();
    const pyByMonth = new Map<number, any>();
    for (const r of salesRows) {
      const bucket = r.yr === cy ? cyByMonth : pyByMonth;
      bucket.set(r.mo, {
        diesel: parseFloat(r.diesel) || 0,
        blend:  parseFloat(r.blend)  || 0,
        ulp:    parseFloat(r.ulp)    || 0,
        total:  parseFloat(r.total)  || 0,
      });
    }
    const budgetByMonth = new Map<number, number>();
    for (const r of budgetRows) {
      budgetByMonth.set(r.mo, parseFloat(r.budget) || 0);
    }

    const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const data: RowOut[] = [];
    for (let m = 1; m <= 12; m++) {
      data.push({
        month:       `${cy}-${String(m).padStart(2,'0')}-01`,
        monthLabel:  MONTH_LABELS[m - 1],
        isFuture:    m > latestMonth,
        isCurrent:   m === latestMonth,
        actualCY:    cyByMonth.get(m) || null,
        actualPY:    pyByMonth.get(m) || null,
        budgetCY:    budgetByMonth.has(m) ? budgetByMonth.get(m)! : null,
      });
    }

    return NextResponse.json({
      year: cy,
      priorYear: py,
      latestSaleDate: latest.toISOString().split('T')[0],
      data,
    });
  } catch (err: any) {
    console.error('/api/yearly-volume-vs-budget error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
