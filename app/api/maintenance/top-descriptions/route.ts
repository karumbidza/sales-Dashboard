// app/api/maintenance/top-descriptions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom   = sp.get('dateFrom')  || undefined;
    const dateTo     = sp.get('dateTo')    || undefined;
    const territory  = sp.get('territory') || undefined;
    const categorySlug = sp.get('category') || undefined;
    const by         = sp.get('by') === 'count' ? 'count' : 'spend';
    const limit      = Math.min(Math.max(1, parseInt(sp.get('limit') || '20')), 200);

    const clauses: string[] = [`i.cost_center = 'retail'`];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)    { clauses.push(`i.service_date >= $${p++}`); params.push(dateFrom); }
    if (dateTo)      { clauses.push(`i.service_date <= $${p++}`); params.push(dateTo); }
    if (territory)   { clauses.push(`t.tm_code = $${p++}`);       params.push(territory.toUpperCase()); }
    if (categorySlug){ clauses.push(`c.slug = $${p++}`);          params.push(categorySlug); }
    const where = `WHERE ${clauses.join(' AND ')}`;

    params.push(limit);
    const limitIdx = params.length;

    const orderBy = by === 'count' ? 'occurrences DESC, total_spend DESC'
                                    : 'total_spend DESC, occurrences DESC';

    const sql = `
      SELECT i.description_norm,
             MIN(i.description)            AS sample_description,
             COUNT(*)::INT                 AS occurrences,
             ROUND(SUM(i.net_cost)::NUMERIC, 2) AS total_spend,
             ROUND(AVG(i.net_cost)::NUMERIC, 2) AS avg_spend,
             c.slug                        AS category_slug,
             c.display_name                AS category_name
        FROM rm_invoices i
        JOIN sites si             ON i.site_code = si.site_code
        LEFT JOIN territories t   ON si.territory_id = t.id
        LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
        LEFT JOIN rm_categories c ON r.category_id = c.id
        ${where}
        GROUP BY i.description_norm, c.slug, c.display_name
        ORDER BY ${orderBy}
        LIMIT $${limitIdx}
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      by,
      data: rows.map(r => ({
        descriptionNorm:    r.description_norm,
        sampleDescription:  r.sample_description,
        occurrences:        r.occurrences,
        totalSpend:         parseFloat(r.total_spend),
        avgSpend:           parseFloat(r.avg_spend),
        categorySlug:       r.category_slug,
        categoryName:       r.category_name,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/top-descriptions error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
