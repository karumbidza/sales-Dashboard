// app/api/helpdesk/recurring/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') || undefined;
    const dateTo   = sp.get('dateTo')   || undefined;
    const priority = sp.get('priority') || undefined;
    const category = sp.get('category') || undefined;
    const siteCode = sp.get('siteCode') || undefined;
    const limit    = Math.min(Math.max(1, parseInt(sp.get('limit') || '20')), 100);

    const clauses: string[] = ['1=1'];
    const params: any[] = [];
    let p = 1;
    if (dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (priority) { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }
    if (category) { clauses.push(`c.slug = $${p++}`); params.push(category); }
    params.push(limit);

    const rows = await query<any>(
      `SELECT t.description_norm,
              MIN(t.subject) AS sample_subject,
              COUNT(*)::INT  AS count,
              c.slug         AS category_slug,
              c.display_name AS category_name
         FROM rm_helpdesk_tickets t
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY t.description_norm, c.slug, c.display_name
        ORDER BY count DESC
        LIMIT $${p}`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        descriptionNorm: r.description_norm,
        sampleSubject:   r.sample_subject,
        count:           r.count,
        categorySlug:    r.category_slug,
        categoryName:    r.category_name,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/recurring error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
