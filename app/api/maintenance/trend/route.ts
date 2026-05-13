// app/api/maintenance/trend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom    = sp.get('dateFrom')    || undefined;
    const dateTo      = sp.get('dateTo')      || undefined;
    const territory   = sp.get('territory')   || undefined;
    const categorySlug = sp.get('category')   || undefined;
    const siteCode    = sp.get('siteCode')    || undefined;
    const granularity = sp.get('granularity') === 'daily' ? 'daily' : 'monthly';

    const clauses: string[] = [`i.cost_center = 'retail'`];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)     { clauses.push(`i.service_date >= $${p++}`); params.push(dateFrom); }
    if (dateTo)       { clauses.push(`i.service_date <= $${p++}`); params.push(dateTo); }
    if (territory)    { clauses.push(`t.tm_code = $${p++}`);       params.push(territory.toUpperCase()); }
    if (categorySlug) { clauses.push(`c.slug = $${p++}`);          params.push(categorySlug); }
    if (siteCode)     { clauses.push(`i.site_code = $${p++}`);     params.push(siteCode); }
    const where = `WHERE ${clauses.join(' AND ')}`;

    const bucket = granularity === 'daily'
      ? `i.service_date`
      : `DATE_TRUNC('month', i.service_date)::DATE`;

    const sql = `
      SELECT ${bucket} AS bucket,
             ROUND(SUM(i.net_cost)::NUMERIC, 2) AS total_cost,
             COUNT(*)::INT                       AS invoice_count
        FROM rm_invoices i
        JOIN sites si             ON i.site_code = si.site_code
        LEFT JOIN territories t   ON si.territory_id = t.id
        LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
        LEFT JOIN rm_categories c ON r.category_id = c.id
        ${where}
        GROUP BY bucket
        ORDER BY bucket
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      data: rows.map(r => ({
        period:       r.bucket,
        totalCost:    parseFloat(r.total_cost),
        invoiceCount: r.invoice_count,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/trend error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
