// app/api/helpdesk/trend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') || undefined;
    const dateTo   = sp.get('dateTo')   || undefined;
    const priority = sp.get('priority') || undefined;
    const status   = sp.get('status')   || undefined;
    const category = sp.get('category') || undefined;
    const siteCode = sp.get('siteCode') || undefined;
    const granularity = sp.get('granularity') === 'daily' ? 'daily' : 'monthly';

    const clauses: string[] = [
      '1=1',
      `NOT EXISTS (SELECT 1 FROM rm_helpdesk_exclusions x WHERE x.ticket_id = t.ticket_id)`,
    ];
    const params: any[] = [];
    let p = 1;
    if (dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (priority) { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (status)   { clauses.push(`t.status = $${p++}`); params.push(status); }
    if (siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }
    if (category) { clauses.push(`c.slug = $${p++}`); params.push(category); }

    const bucket = granularity === 'daily'
      ? `t.created_time::DATE`
      : `DATE_TRUNC('month', t.created_time)::DATE`;

    const rows = await query<any>(
      `SELECT ${bucket} AS bucket, COUNT(*)::INT AS count
         FROM rm_helpdesk_tickets t
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY bucket
        ORDER BY bucket`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        period: r.bucket,
        count: r.count,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/trend error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
