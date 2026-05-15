// app/api/helpdesk/open/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const priority = sp.get('priority') || undefined;
    const siteCode = sp.get('siteCode') || undefined;
    const category = sp.get('category') || undefined;
    const limit    = Math.min(Math.max(1, parseInt(sp.get('limit') || '200')), 500);

    const clauses: string[] = [`t.status NOT IN ('Closed', 'Resolved')`];
    const params: any[] = [];
    let p = 1;
    if (priority) { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }
    if (category) { clauses.push(`c.slug = $${p++}`); params.push(category); }
    params.push(limit);

    const rows = await query<any>(
      `SELECT t.ticket_id, t.site_code, s.budget_name AS site_name,
              t.priority, t.created_time, t.subject,
              EXTRACT(EPOCH FROM (NOW() - t.created_time))::INT / 86400 AS days_open
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.created_time ASC
        LIMIT $${p}`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        ticketId:    r.ticket_id,
        siteCode:    r.site_code,
        siteName:    r.site_name,
        priority:    r.priority,
        createdTime: r.created_time,
        daysOpen:    r.days_open,
        subject:     r.subject,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/open error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
