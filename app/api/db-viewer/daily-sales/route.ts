// app/api/db-viewer/daily-sales/route.ts
// Pivoted daily sales for the Database Viewer:
//   rows = each calendar date in the selected month
//   columns = each site
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

function ymdLocal(d: any): string {
  if (d == null) return '';
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return String(d).slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const monthParam = sp.get('month'); // YYYY-MM
    const territory  = sp.get('territory');

    const today = new Date();
    let year:  number;
    let month: number; // 1-12
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number);
      year = y; month = m;
    } else {
      year = today.getFullYear();
      month = today.getMonth() + 1;
    }
    const monthStartIso = `${year}-${String(month).padStart(2,'0')}-01`;
    const calendarDays  = new Date(year, month, 0).getDate();
    const monthEndIso   = `${year}-${String(month).padStart(2,'0')}-${String(calendarDays).padStart(2,'0')}`;

    const params: any[] = [monthStartIso, monthEndIso];
    let whereTerritory = '';
    if (territory) {
      params.push(territory.toUpperCase());
      whereTerritory = `AND t.tm_code = $${params.length}`;
    }

    // ── Sites in scope (active in month OR have a budget for the month) ──
    const sitesRows = await query<any>(`
      WITH scope AS (
        SELECT DISTINCT s.site_code
        FROM sales s
        JOIN sites si ON s.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        WHERE s.sale_date BETWEEN $1 AND $2
        ${whereTerritory}
        UNION
        SELECT DISTINCT vb.site_code
        FROM volume_budget vb
        JOIN sites si ON vb.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        WHERE vb.budget_month = $1::DATE
        ${whereTerritory}
      )
      SELECT
        si.site_code,
        si.budget_name AS site_name,
        COALESCE(dr.daily_budget_rate, 0) AS daily_budget_rate
      FROM scope sc
      JOIN sites si ON sc.site_code = si.site_code
      LEFT JOIN vw_daily_budget_rate dr
        ON dr.site_code = si.site_code AND dr.budget_month = $1::DATE
      ORDER BY si.budget_name
    `, params);

    // ── Daily sales rows (one per site x date) ──
    const salesRows = await query<any>(`
      SELECT
        s.sale_date,
        s.site_code,
        SUM(s.total_volume) AS volume
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE s.sale_date BETWEEN $1 AND $2
      ${whereTerritory}
      GROUP BY s.sale_date, s.site_code
    `, params);

    // ── Build the matrix ──
    const sites = sitesRows.map((r: any) => ({
      siteCode:        r.site_code,
      siteName:        r.site_name || r.site_code,
      dailyBudgetRate: Number(r.daily_budget_rate || 0),
    }));

    const dates: string[] = [];
    for (let d = 1; d <= calendarDays; d++) {
      dates.push(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
    }

    const data: Record<string, Record<string, number>> = {};
    for (const d of dates) data[d] = { _total: 0 };
    const siteTotals: Record<string, number> = { _total: 0 };
    for (const s of sites) siteTotals[s.siteCode] = 0;

    for (const r of salesRows) {
      const dIso = ymdLocal(r.sale_date);
      const v    = Number(r.volume || 0);
      if (!data[dIso]) continue;
      data[dIso][r.site_code] = v;
      data[dIso]._total       = (data[dIso]._total || 0) + v;
      siteTotals[r.site_code] = (siteTotals[r.site_code] || 0) + v;
      siteTotals._total       += v;
    }

    return NextResponse.json({
      month: `${year}-${String(month).padStart(2,'0')}`,
      calendarDays,
      dates,
      sites,
      data,
      siteTotals,
    });
  } catch (err: any) {
    console.error('/api/db-viewer/daily-sales error:', err);
    return NextResponse.json({ error: err.message || 'failed' }, { status: 500 });
  }
}
