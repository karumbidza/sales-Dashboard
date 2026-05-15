// app/api/rm/cost-trend/route.ts
// Monthly R&M cost series for current year + prior year. Always Jan-Dec.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const periodEnd = new Date((sp.get('dateTo') || today) + 'T00:00:00Z');
    const year = periodEnd.getUTCFullYear();
    const territory = sp.get('territory') || '';
    const siteCode  = sp.get('siteCode')  || '';
    const category  = sp.get('category')  || '';

    const yearStart       = `${year}-01-01`;
    const nextYearStart   = `${year + 1}-01-01`;
    const priorYearStart  = `${year - 1}-01-01`;

    const sql = `
      SELECT EXTRACT(YEAR  FROM i.service_date)::INT AS yr,
             EXTRACT(MONTH FROM i.service_date)::INT AS mo,
             SUM(i.net_cost)::NUMERIC AS cost
        FROM rm_invoices i
        JOIN sites s ON i.site_code = s.site_code
        LEFT JOIN territories t ON s.territory_id = t.id
        LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
        LEFT JOIN rm_categories c ON r.category_id = c.id
       WHERE i.cost_center='retail'
         AND i.service_date >= $1::DATE
         AND i.service_date <  $2::DATE
         AND ($3::TEXT = '' OR i.site_code = $3)
         AND ($4::TEXT = '' OR t.tm_code = $4)
         AND ($5::TEXT = '' OR c.slug = $5)
       GROUP BY 1, 2
    `;

    const rows = await query<{ yr: number; mo: number; cost: string }>(
      sql, [priorYearStart, nextYearStart, siteCode, territory, category],
    );

    // Monthly budget for current year (rm_budget VIEW: $1500/site/month from first sale)
    // Budget is fleet-wide (no category dim); category filter does not narrow it.
    const budgetRows = await query<{ mo: number; total: string }>(
      `SELECT EXTRACT(MONTH FROM b.budget_month)::INT AS mo,
              SUM(b.budget_amount)::NUMERIC AS total
         FROM rm_budget b
         JOIN sites s ON b.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
        WHERE b.budget_month >= $1::DATE
          AND b.budget_month <  $2::DATE
          AND ($3::TEXT = '' OR b.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code  = $4)
        GROUP BY 1`,
      [yearStart, nextYearStart, siteCode, territory],
    );

    // Build 12-month arrays for both years + the current-year budget
    const cy: { month: string; cost: number }[] = [];
    const py: { month: string; cost: number }[] = [];
    const bud: { month: string; cost: number }[] = [];
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (let m = 1; m <= 12; m++) {
      const cyRow  = rows.find(r => r.yr === year     && r.mo === m);
      const pyRow  = rows.find(r => r.yr === year - 1 && r.mo === m);
      const budRow = budgetRows.find(b => b.mo === m);
      cy.push({  month: MONTHS[m - 1], cost: cyRow  ? parseFloat(cyRow.cost)  : 0 });
      py.push({  month: MONTHS[m - 1], cost: pyRow  ? parseFloat(pyRow.cost)  : 0 });
      bud.push({ month: MONTHS[m - 1], cost: budRow ? parseFloat(budRow.total) : 0 });
    }

    return NextResponse.json({
      data: {
        year,
        priorYear: year - 1,
        currentYear:     cy,
        priorYearSeries: py,
        budgetSeries:    bud,
      },
    });
  } catch (err: any) {
    console.error('/api/rm/cost-trend error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
