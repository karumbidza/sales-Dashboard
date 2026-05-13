// app/api/maintenance/categories/route.ts
// Chart breakdown — spend per category over the filter range, retail only.
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

    const clauses: string[] = [`i.cost_center = 'retail'`];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)  { clauses.push(`i.service_date >= $${p++}`); params.push(dateFrom); }
    if (dateTo)    { clauses.push(`i.service_date <= $${p++}`); params.push(dateTo); }
    if (territory) { clauses.push(`t.tm_code = $${p++}`);       params.push(territory.toUpperCase()); }
    if (siteCode)  { clauses.push(`i.site_code = $${p++}`);     params.push(siteCode); }
    const where = `WHERE ${clauses.join(' AND ')}`;

    const rows = await query<any>(
      `WITH per_cat AS (
         SELECT c.slug, c.display_name, SUM(i.net_cost) AS total_cost
           FROM rm_invoices i
           JOIN sites si             ON i.site_code = si.site_code
           LEFT JOIN territories t   ON si.territory_id = t.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
           ${where}
          GROUP BY c.slug, c.display_name
       ),
       total AS (SELECT SUM(total_cost) AS sum_all FROM per_cat)
       SELECT p.slug, p.display_name,
              ROUND(p.total_cost::NUMERIC, 2) AS total_cost,
              ROUND((p.total_cost / NULLIF(t.sum_all, 0) * 100)::NUMERIC, 1) AS pct_of_total
         FROM per_cat p, total t
        ORDER BY p.total_cost DESC NULLS LAST`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        categorySlug: r.slug,
        // `category` key kept for backwards compatibility with the existing chart component
        category:     r.display_name,
        totalCost:    parseFloat(r.total_cost),
        pctOfTotal:   r.pct_of_total ? parseFloat(r.pct_of_total) : 0,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/categories error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
