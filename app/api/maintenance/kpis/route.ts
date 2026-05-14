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

function maintWhere(f: F, includeCategory: boolean) {
  const clauses: string[] = [`i.cost_center = 'retail'`];
  const params: any[] = [];
  let p = 1;
  if (f.dateFrom)  { clauses.push(`i.service_date >= $${p++}`); params.push(f.dateFrom); }
  if (f.dateTo)    { clauses.push(`i.service_date <= $${p++}`); params.push(f.dateTo); }
  if (f.territory) { clauses.push(`t.tm_code = $${p++}`);       params.push(f.territory.toUpperCase()); }
  if (includeCategory && f.category) { clauses.push(`c.slug = $${p++}`); params.push(f.category); }
  if (f.siteCode)  { clauses.push(`i.site_code = $${p++}`);     params.push(f.siteCode); }
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

function salesWhere(f: F) {
  const clauses: string[] = [];
  const params: any[] = [];
  let p = 1;
  if (f.dateFrom)  { clauses.push(`s.sale_date >= $${p++}`); params.push(f.dateFrom); }
  if (f.dateTo)    { clauses.push(`s.sale_date <= $${p++}`); params.push(f.dateTo); }
  if (f.territory) { clauses.push(`t.tm_code = $${p++}`);    params.push(f.territory.toUpperCase()); }
  if (f.siteCode)  { clauses.push(`s.site_code = $${p++}`);  params.push(f.siteCode); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function GET(req: NextRequest) {
  try {
    const f = readFilters(req);

    const iBase = `
      FROM rm_invoices i
      JOIN sites si             ON i.site_code = si.site_code
      LEFT JOIN territories t   ON si.territory_id = t.id
      LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
      LEFT JOIN rm_categories c ON r.category_id = c.id
    `;
    const sBase = `
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;

    const mw = maintWhere(f, true);
    const totals = await query<any>(
      `SELECT ROUND(SUM(i.net_cost)::NUMERIC, 2) AS total_cost,
              COUNT(DISTINCT i.site_code)        AS sites_with_activity
       ${iBase} ${mw.where}`,
      mw.params,
    );

    const mwNoCat = maintWhere(f, false);
    const topCat = await query<any>(
      `SELECT c.slug, c.display_name, ROUND(SUM(i.net_cost)::NUMERIC, 2) AS total
       ${iBase} ${mwNoCat.where}
       GROUP BY c.slug, c.display_name
       ORDER BY total DESC NULLS LAST
       LIMIT 1`,
      mwNoCat.params,
    );

    const sw = salesWhere(f);
    const vol = await query<any>(
      `SELECT SUM(s.total_volume) AS volume ${sBase} ${sw.where}`,
      sw.params,
    );

    const totalCost = parseFloat(totals[0]?.total_cost || 0);
    const totalVolume = parseFloat(vol[0]?.volume || 0);
    const costPerLitre = totalVolume > 0 ? totalCost / totalVolume : null;

    const review = await query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM rm_description_categories WHERE needs_review = TRUE`,
    );

    return NextResponse.json({
      data: {
        totalCost,
        costPerLitre,
        topCategory:        topCat[0]?.display_name ?? null,
        topCategorySlug:    topCat[0]?.slug ?? null,
        topCategoryCost:    topCat[0]?.total ? parseFloat(topCat[0].total) : 0,
        sitesWithActivity:  parseInt(totals[0]?.sites_with_activity || 0),
        needsReviewCount:   parseInt(review[0].n, 10),
      },
    });
  } catch (err: any) {
    console.error('/api/maintenance/kpis error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
