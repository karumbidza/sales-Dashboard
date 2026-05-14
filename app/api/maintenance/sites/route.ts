// app/api/maintenance/sites/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const VALID_SORTS = new Set(['cost', 'volume', 'cost_per_litre', 'site_name', 'territory_code']);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom  = sp.get('dateFrom')  || undefined;
    const dateTo    = sp.get('dateTo')    || undefined;
    const territory = sp.get('territory') || undefined;
    const categorySlug = sp.get('category') || undefined;
    const siteCode  = sp.get('siteCode')  || undefined;
    const limit     = Math.min(Math.max(1, parseInt(sp.get('limit') || '500')), 5000);
    const sortBy    = sp.get('sortBy') || 'cost_per_litre';
    const sortDir   = (sp.get('sortDir') || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    if (!VALID_SORTS.has(sortBy)) {
      return NextResponse.json({ error: 'Invalid sortBy' }, { status: 400 });
    }

    // ── invoices WHERE (includes category) ──
    const ip: any[] = [];
    const ic: string[] = [`i.cost_center = 'retail'`];
    let iidx = 1;
    if (dateFrom)     { ic.push(`i.service_date >= $${iidx++}`); ip.push(dateFrom); }
    if (dateTo)       { ic.push(`i.service_date <= $${iidx++}`); ip.push(dateTo); }
    if (territory)    { ic.push(`t.tm_code = $${iidx++}`);       ip.push(territory.toUpperCase()); }
    if (categorySlug) { ic.push(`c.slug = $${iidx++}`);          ip.push(categorySlug); }
    if (siteCode)     { ic.push(`i.site_code = $${iidx++}`);     ip.push(siteCode); }
    const iWhere = `WHERE ${ic.join(' AND ')}`;

    // ── sales WHERE (no category) ──
    const sp_: any[] = [];
    const sc: string[] = [];
    let sidx = ip.length + 1;
    if (dateFrom)  { sc.push(`s.sale_date >= $${sidx++}`); sp_.push(dateFrom); }
    if (dateTo)    { sc.push(`s.sale_date <= $${sidx++}`); sp_.push(dateTo); }
    if (territory) { sc.push(`t.tm_code = $${sidx++}`);    sp_.push(territory.toUpperCase()); }
    if (siteCode)  { sc.push(`s.site_code = $${sidx++}`);  sp_.push(siteCode); }
    const sWhere = sc.length ? `WHERE ${sc.join(' AND ')}` : '';

    const params: any[] = [...ip, ...sp_, limit];
    const limitIdx = params.length;

    const orderCol =
      sortBy === 'cost'           ? 'cost' :
      sortBy === 'volume'         ? 'volume' :
      sortBy === 'site_name'      ? 'site_name' :
      sortBy === 'territory_code' ? 'territory_code' :
                                    'cost_per_litre';

    const sql = `
      WITH inv_cats AS (
        SELECT i.site_code, c.slug AS category_slug, c.display_name AS category_name,
               SUM(i.net_cost) AS cat_cost,
               ROW_NUMBER() OVER (PARTITION BY i.site_code ORDER BY SUM(i.net_cost) DESC) AS rk
          FROM rm_invoices i
          JOIN sites si             ON i.site_code = si.site_code
          LEFT JOIN territories t   ON si.territory_id = t.id
          LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
          ${iWhere}
         GROUP BY i.site_code, c.slug, c.display_name
      ),
      maint AS (
        SELECT i.site_code,
               si.budget_name                  AS site_name,
               t.tm_code                       AS territory_code,
               ROUND(SUM(i.net_cost)::NUMERIC, 2) AS cost,
               (SELECT ic.category_name FROM inv_cats ic
                 WHERE ic.site_code = i.site_code AND ic.rk = 1) AS top_category,
               (SELECT ic.category_slug FROM inv_cats ic
                 WHERE ic.site_code = i.site_code AND ic.rk = 1) AS top_category_slug
          FROM rm_invoices i
          JOIN sites si             ON i.site_code = si.site_code
          LEFT JOIN territories t   ON si.territory_id = t.id
          LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
          ${iWhere}
         GROUP BY i.site_code, si.budget_name, t.tm_code
      ),
      vol AS (
        SELECT s.site_code, SUM(s.total_volume) AS volume
          FROM sales s
          JOIN sites si ON s.site_code = si.site_code
          LEFT JOIN territories t ON si.territory_id = t.id
          ${sWhere}
         GROUP BY s.site_code
      )
      SELECT maint.site_code, maint.site_name, maint.territory_code,
             maint.cost,
             COALESCE(vol.volume, 0)::NUMERIC AS volume,
             maint.top_category, maint.top_category_slug,
             CASE WHEN COALESCE(vol.volume, 0) > 0
                  THEN ROUND((maint.cost / vol.volume)::NUMERIC, 4)
                  ELSE NULL END AS cost_per_litre
        FROM maint
        LEFT JOIN vol ON vol.site_code = maint.site_code
       ORDER BY ${orderCol} ${sortDir} NULLS LAST
       LIMIT $${limitIdx}
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      data: rows.map(r => ({
        siteCode:        r.site_code,
        siteName:        r.site_name,
        territoryCode:   r.territory_code,
        cost:            parseFloat(r.cost),
        volume:          parseFloat(r.volume),
        topCategory:     r.top_category,
        topCategorySlug: r.top_category_slug,
        costPerLitre:    r.cost_per_litre != null ? parseFloat(r.cost_per_litre) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/sites error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
