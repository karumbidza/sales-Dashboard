// app/api/maintenance/trend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom  = sp.get('dateFrom')  || undefined;
    const dateTo    = sp.get('dateTo')    || undefined;
    const territory = sp.get('territory') || undefined;
    const category  = sp.get('category')  || undefined;
    const siteCode  = sp.get('siteCode')  || undefined;
    const granularity = sp.get('granularity') === 'daily' ? 'daily' : 'monthly';

    const clauses: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (dateFrom)  { clauses.push(`m.service_date >= $${i++}`); params.push(dateFrom); }
    if (dateTo)    { clauses.push(`m.service_date <= $${i++}`); params.push(dateTo); }
    if (territory) { clauses.push(`t.tm_code = $${i++}`);        params.push(territory.toUpperCase()); }
    if (category)  { clauses.push(`m.category = $${i++}`);       params.push(category); }
    if (siteCode)  { clauses.push(`m.site_code = $${i++}`);      params.push(siteCode); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const bucket   = granularity === 'daily' ? 'm.service_date' : `DATE_TRUNC('month', m.service_date)::DATE`;
    const labelFmt = granularity === 'daily'
      ? `TO_CHAR(m.service_date, 'DD Mon')`
      : `TO_CHAR(DATE_TRUNC('month', m.service_date), 'Mon YYYY')`;

    const rows = await query<any>(
      `SELECT ${bucket}::TEXT AS period,
              ${labelFmt}     AS label,
              ROUND(SUM(m.cost)::NUMERIC, 2) AS cost,
              COUNT(*)                       AS events
       FROM maintenance_costs m
       JOIN sites si ON m.site_code = si.site_code
       LEFT JOIN territories t ON si.territory_id = t.id
       ${where}
       GROUP BY ${bucket}, ${labelFmt}
       ORDER BY ${bucket} ASC`,
      params
    );

    return NextResponse.json({
      granularity,
      data: rows.map((r: any) => ({
        period: String(r.period).slice(0, 10),
        label:  r.label,
        cost:   parseFloat(r.cost),
        events: parseInt(r.events),
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/trend error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
