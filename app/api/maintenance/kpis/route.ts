// app/api/maintenance/kpis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface F {
  dateFrom?: string; dateTo?: string;
  territory?: string; category?: string; siteCode?: string;
}

function readFilters(req: NextRequest): F {
  const sp = req.nextUrl.searchParams;
  return {
    dateFrom:  sp.get('dateFrom')  || undefined,
    dateTo:    sp.get('dateTo')    || undefined,
    territory: sp.get('territory') || undefined,
    category:  sp.get('category')  || undefined,
    siteCode:  sp.get('siteCode')  || undefined,
  };
}

// Builds WHERE for `maintenance_costs m` joined to `sites si` + `territories t`.
function maintWhere(f: F, includeCategory = true) {
  const clauses: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (f.dateFrom)  { clauses.push(`m.service_date >= $${i++}`); params.push(f.dateFrom); }
  if (f.dateTo)    { clauses.push(`m.service_date <= $${i++}`); params.push(f.dateTo); }
  if (f.territory) { clauses.push(`t.tm_code = $${i++}`);        params.push(f.territory.toUpperCase()); }
  if (includeCategory && f.category) { clauses.push(`m.category = $${i++}`); params.push(f.category); }
  if (f.siteCode)  { clauses.push(`m.site_code = $${i++}`);      params.push(f.siteCode); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

// Builds WHERE for `sales s` joined to `sites si` + `territories t` (for cost-per-litre).
function salesWhere(f: F) {
  const clauses: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (f.dateFrom)  { clauses.push(`s.sale_date >= $${i++}`); params.push(f.dateFrom); }
  if (f.dateTo)    { clauses.push(`s.sale_date <= $${i++}`); params.push(f.dateTo); }
  if (f.territory) { clauses.push(`t.tm_code = $${i++}`);    params.push(f.territory.toUpperCase()); }
  if (f.siteCode)  { clauses.push(`s.site_code = $${i++}`);  params.push(f.siteCode); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function GET(req: NextRequest) {
  try {
    const f = readFilters(req);

    const mBase = `
      FROM maintenance_costs m
      JOIN sites si ON m.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;
    const sBase = `
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;

    // Total cost + sites with activity (honour all filters incl. category)
    const mw = maintWhere(f, true);
    const totals = await query<any>(
      `SELECT ROUND(SUM(m.cost)::NUMERIC, 2) AS total_cost,
              COUNT(DISTINCT m.site_code)    AS sites_with_activity
       ${mBase} ${mw.where}`,
      mw.params
    );

    // Top category — explicitly drop the category filter
    const mwNoCat = maintWhere(f, false);
    const topCat = await query<any>(
      `SELECT m.category, ROUND(SUM(m.cost)::NUMERIC, 2) AS total
       ${mBase} ${mwNoCat.where}
       GROUP BY m.category
       ORDER BY total DESC NULLS LAST
       LIMIT 1`,
      mwNoCat.params
    );

    // Cost per litre — sales volume over same filter scope (category does not apply)
    const sw = salesWhere(f);
    const vol = await query<any>(
      `SELECT SUM(s.total_volume) AS volume ${sBase} ${sw.where}`,
      sw.params
    );

    const totalCost = parseFloat(totals[0]?.total_cost || 0);
    const totalVolume = parseFloat(vol[0]?.volume || 0);
    const costPerLitre = totalVolume > 0 ? totalCost / totalVolume : null;

    return NextResponse.json({
      data: {
        totalCost,
        costPerLitre,
        topCategory: topCat[0]?.category ?? null,
        topCategoryCost: topCat[0]?.total ? parseFloat(topCat[0].total) : 0,
        sitesWithActivity: parseInt(totals[0]?.sites_with_activity || 0),
      },
    });
  } catch (err: any) {
    console.error('/api/maintenance/kpis error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
