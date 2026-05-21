// app/api/helpdesk/sites/route.ts
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

    const clauses: string[] = [
      '1=1',
      `NOT EXISTS (SELECT 1 FROM rm_helpdesk_exclusions x WHERE x.ticket_id = t.ticket_id)`,
    ];
    const params: any[] = [];
    let p = 1;
    if (dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (priority) { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (category) { clauses.push(`c.slug = $${p++}`); params.push(category); }

    const rows = await query<any>(
      `SELECT t.site_code,
              s.budget_name AS site_name,
              COUNT(*)::INT AS total,
              COUNT(*) FILTER (WHERE t.status NOT IN ('Closed', 'Resolved'))::INT AS open,
              AVG(t.resolution_minutes) FILTER (WHERE t.resolution_minutes IS NOT NULL) AS avg_res
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY t.site_code, s.budget_name
        ORDER BY total DESC
        LIMIT 1000`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        siteCode: r.site_code,
        siteName: r.site_name,
        total:    r.total,
        open:     r.open,
        avgResolutionMinutes: r.avg_res != null ? Math.round(parseFloat(r.avg_res)) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/sites error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
