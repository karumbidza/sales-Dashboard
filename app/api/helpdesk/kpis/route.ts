// app/api/helpdesk/kpis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface F { dateFrom?: string; dateTo?: string; priority?: string; status?: string; category?: string; siteCode?: string; }

function readFilters(req: NextRequest): F {
  const sp = req.nextUrl.searchParams;
  return {
    dateFrom: sp.get('dateFrom') || undefined,
    dateTo:   sp.get('dateTo')   || undefined,
    priority: sp.get('priority') || undefined,
    status:   sp.get('status')   || undefined,
    category: sp.get('category') || undefined,
    siteCode: sp.get('siteCode') || undefined,
  };
}

function whereClause(f: F, includeCategory: boolean) {
  const clauses: string[] = ['1=1'];
  const params: any[] = [];
  let p = 1;
  if (f.dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(f.dateFrom); }
  if (f.dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(f.dateTo); }
  if (f.priority) { clauses.push(`t.priority = $${p++}`); params.push(f.priority); }
  if (f.status)   { clauses.push(`t.status = $${p++}`); params.push(f.status); }
  if (f.siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(f.siteCode); }
  if (includeCategory && f.category) { clauses.push(`c.slug = $${p++}`); params.push(f.category); }
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

export async function GET(req: NextRequest) {
  try {
    const f = readFilters(req);
    const base = `
      FROM rm_helpdesk_tickets t
      LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
      LEFT JOIN rm_categories c ON r.category_id = c.id
    `;
    const w = whereClause(f, true);

    const totals = await query<any>(
      `SELECT
         COUNT(*)::INT                                                            AS total,
         COUNT(*) FILTER (WHERE t.status NOT IN ('Closed', 'Resolved'))::INT       AS open_count,
         COUNT(*) FILTER (WHERE t.resolution_status = 'SLA Violated')::INT         AS sla_violated,
         AVG(t.resolution_minutes) FILTER (WHERE t.resolution_minutes IS NOT NULL) AS avg_resolution_minutes
       ${base} ${w.where}`,
      w.params,
    );

    const openByPriority = await query<{ priority: string; n: string }>(
      `SELECT COALESCE(t.priority, 'Unspecified') AS priority, COUNT(*)::TEXT AS n
       ${base} ${w.where} AND t.status NOT IN ('Closed', 'Resolved')
       GROUP BY 1 ORDER BY 2 DESC`,
      w.params,
    );

    const topEquip = await query<{ equipment: string; n: string }>(
      `SELECT COALESCE(t.equipment, 'Unspecified') AS equipment, COUNT(*)::TEXT AS n
       ${base} ${w.where}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
      w.params,
    );

    const total = parseInt(totals[0]?.total || 0);
    const slaViolated = parseInt(totals[0]?.sla_violated || 0);
    const slaViolatedPct = total > 0 ? +(slaViolated * 100 / total).toFixed(1) : 0;
    const avgResMins = totals[0]?.avg_resolution_minutes != null
      ? Math.round(parseFloat(totals[0].avg_resolution_minutes))
      : null;

    const openByPriorityMap: Record<string, number> = {};
    for (const r of openByPriority) openByPriorityMap[r.priority] = parseInt(r.n, 10);

    return NextResponse.json({
      data: {
        openCount:            parseInt(totals[0]?.open_count || 0),
        openByPriority:       openByPriorityMap,
        slaViolatedCount:     slaViolated,
        slaViolatedPct,
        avgResolutionMinutes: avgResMins,
        topEquipment:         topEquip[0]?.equipment ?? null,
        topEquipmentCount:    topEquip[0]?.n ? parseInt(topEquip[0].n, 10) : 0,
      },
    });
  } catch (err: any) {
    console.error('/api/helpdesk/kpis error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
