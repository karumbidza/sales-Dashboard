// app/api/helpdesk/tickets/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom    = sp.get('dateFrom')    || undefined;
    const dateTo      = sp.get('dateTo')      || undefined;
    const priority    = sp.get('priority')    || undefined;
    const status      = sp.get('status')      || undefined;
    const category    = sp.get('category')    || undefined;
    const siteCode    = sp.get('siteCode')    || undefined;
    const provider    = sp.get('provider')    || undefined;
    const description = sp.get('description') || undefined;
    const ticketId    = sp.get('ticketId')    || undefined;
    const openOnly    = sp.get('openOnly') === 'true';
    const limit       = Math.min(Math.max(1, parseInt(sp.get('limit') || '200')), 500);

    const clauses: string[] = ['1=1'];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)    { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)      { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (priority)    { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (status)      { clauses.push(`t.status = $${p++}`); params.push(status); }
    if (category)    { clauses.push(`c.slug = $${p++}`); params.push(category); }
    if (siteCode)    { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }
    if (provider)    { clauses.push(`t.service_provider = $${p++}`); params.push(provider); }
    if (description) { clauses.push(`t.description_norm = $${p++}`); params.push(description); }
    if (openOnly)    { clauses.push(`t.status NOT IN ('Closed','Resolved')`); }
    if (ticketId) {
      const tid = parseInt(ticketId, 10);
      if (Number.isFinite(tid) && tid > 0) {
        clauses.push(`t.ticket_id = $${p++}`);
        params.push(tid);
      }
    }
    params.push(limit);

    const rows = await query<any>(
      `SELECT t.ticket_id, t.site_code, s.budget_name AS site_name,
              t.subject, t.status, t.priority, t.equipment,
              t.service_provider, t.created_time, t.resolved_time, t.closed_time,
              t.resolution_minutes, t.resolution_status,
              c.slug AS category_slug, c.display_name AS category_name,
              r.source AS category_source, r.needs_review,
              t.description_norm
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.created_time DESC
        LIMIT $${p}`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        ticketId:           r.ticket_id,
        siteCode:           r.site_code,
        siteName:           r.site_name,
        subject:            r.subject,
        descriptionNorm:    r.description_norm,
        status:             r.status,
        priority:           r.priority,
        equipment:          r.equipment,
        serviceProvider:    r.service_provider,
        createdTime:        r.created_time,
        resolvedTime:       r.resolved_time,
        closedTime:         r.closed_time,
        resolutionMinutes:  r.resolution_minutes,
        resolutionStatus:   r.resolution_status,
        categorySlug:       r.category_slug,
        categoryName:       r.category_name,
        categorySource:     r.category_source,
        needsReview:        r.needs_review,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/tickets error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
