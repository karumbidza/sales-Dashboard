// app/api/helpdesk/contractors/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') || undefined;
    const dateTo   = sp.get('dateTo')   || undefined;
    const siteCode = sp.get('siteCode') || undefined;

    const clauses: string[] = [
      `t.service_provider IS NOT NULL`,
      `t.service_provider <> ''`,
      `NOT EXISTS (SELECT 1 FROM rm_helpdesk_exclusions x WHERE x.ticket_id = t.ticket_id)`,
    ];
    const params: any[] = [];
    let p = 1;
    if (dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }

    const rows = await query<any>(
      `SELECT t.service_provider AS provider,
              COUNT(*)::INT AS ticket_count,
              AVG(t.resolution_minutes) FILTER (WHERE t.resolution_minutes IS NOT NULL) AS avg_res,
              ROUND(
                COUNT(*) FILTER (WHERE t.resolution_status = 'Within SLA')::NUMERIC
                / NULLIF(COUNT(*) FILTER (WHERE t.resolution_status IS NOT NULL), 0)
                * 100, 1
              ) AS sla_hit_pct
         FROM rm_helpdesk_tickets t
        WHERE ${clauses.join(' AND ')}
        GROUP BY t.service_provider
        ORDER BY ticket_count DESC
        LIMIT 200`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        provider:             r.provider,
        ticketCount:          r.ticket_count,
        avgResolutionMinutes: r.avg_res != null ? Math.round(parseFloat(r.avg_res)) : null,
        slaHitPct:            r.sla_hit_pct != null ? parseFloat(r.sla_hit_pct) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/contractors error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
