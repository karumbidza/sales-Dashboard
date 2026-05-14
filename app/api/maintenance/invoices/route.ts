// app/api/maintenance/invoices/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom    = sp.get('dateFrom')    || undefined;
    const dateTo      = sp.get('dateTo')      || undefined;
    const territory   = sp.get('territory')   || undefined;
    const siteCode    = sp.get('siteCode')    || undefined;
    const categorySlug = sp.get('category')   || undefined;
    const description = sp.get('description') || undefined;   // exact description_norm match
    const needsReview = sp.get('needsReview') === 'true';
    const minCost     = sp.get('minCost') ? parseFloat(sp.get('minCost')!) : undefined;
    const limit       = Math.min(Math.max(1, parseInt(sp.get('limit') || '200')), 1000);
    const offset      = Math.max(0, parseInt(sp.get('offset') || '0'));

    const clauses: string[] = [`i.cost_center = 'retail'`];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)     { clauses.push(`i.service_date >= $${p++}`); params.push(dateFrom); }
    if (dateTo)       { clauses.push(`i.service_date <= $${p++}`); params.push(dateTo); }
    if (territory)    { clauses.push(`t.tm_code = $${p++}`);       params.push(territory.toUpperCase()); }
    if (siteCode)     { clauses.push(`i.site_code = $${p++}`);     params.push(siteCode); }
    if (categorySlug) { clauses.push(`c.slug = $${p++}`);          params.push(categorySlug); }
    if (description)  { clauses.push(`i.description_norm = $${p++}`); params.push(description); }
    if (needsReview)  { clauses.push(`r.needs_review = TRUE`); }
    if (minCost !== undefined) { clauses.push(`i.net_cost >= $${p++}`); params.push(minCost); }
    const where = `WHERE ${clauses.join(' AND ')}`;

    params.push(limit, offset);
    const limitIdx  = params.length - 1;
    const offsetIdx = params.length;

    const sql = `
      SELECT i.entry_no, i.site_code, si.budget_name AS site_name,
             i.service_date, i.description, i.document_no, i.external_doc_no,
             i.net_cost, i.cost_center,
             c.slug AS category_slug, c.display_name AS category_name,
             r.confidence, r.needs_review, r.source AS category_source
        FROM rm_invoices i
        JOIN sites si              ON i.site_code = si.site_code
        LEFT JOIN territories t    ON si.territory_id = t.id
        LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
        LEFT JOIN rm_categories c  ON r.category_id = c.id
        ${where}
        ORDER BY i.service_date DESC, i.entry_no DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      data: rows.map(r => ({
        entryNo:         Number(r.entry_no),
        siteCode:        r.site_code,
        siteName:        r.site_name,
        serviceDate:     r.service_date,
        description:     r.description,
        documentNo:      r.document_no,
        externalDocNo:   r.external_doc_no,
        netCost:         parseFloat(r.net_cost),
        categorySlug:    r.category_slug,
        categoryName:    r.category_name,
        confidence:      r.confidence,
        needsReview:     r.needs_review,
        categorySource:  r.category_source,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/invoices error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
