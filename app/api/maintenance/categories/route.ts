// app/api/maintenance/categories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom  = sp.get('dateFrom')  || undefined;
    const dateTo    = sp.get('dateTo')    || undefined;
    const territory = sp.get('territory') || undefined;
    const siteCode  = sp.get('siteCode')  || undefined;

    const clauses: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (dateFrom)  { clauses.push(`m.service_date >= $${i++}`); params.push(dateFrom); }
    if (dateTo)    { clauses.push(`m.service_date <= $${i++}`); params.push(dateTo); }
    if (territory) { clauses.push(`t.tm_code = $${i++}`);        params.push(territory.toUpperCase()); }
    if (siteCode)  { clauses.push(`m.site_code = $${i++}`);      params.push(siteCode); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await query<any>(
      `WITH per_cat AS (
         SELECT m.category, SUM(m.cost) AS total_cost
         FROM maintenance_costs m
         JOIN sites si ON m.site_code = si.site_code
         LEFT JOIN territories t ON si.territory_id = t.id
         ${where}
         GROUP BY m.category
       ),
       total AS (SELECT SUM(total_cost) AS sum_all FROM per_cat)
       SELECT p.category,
              ROUND(p.total_cost::NUMERIC, 2) AS total_cost,
              ROUND((p.total_cost / NULLIF(t.sum_all, 0) * 100)::NUMERIC, 1) AS pct_of_total
       FROM per_cat p, total t
       ORDER BY p.total_cost DESC NULLS LAST`,
      params
    );

    return NextResponse.json({
      data: rows.map((r: any) => ({
        category: r.category,
        totalCost: parseFloat(r.total_cost),
        pctOfTotal: r.pct_of_total ? parseFloat(r.pct_of_total) : 0,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/categories error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
