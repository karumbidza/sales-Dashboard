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
    const category  = sp.get('category')  || undefined;
    const siteCode  = sp.get('siteCode')  || undefined;
    const limit     = Math.min(Math.max(1, parseInt(sp.get('limit') || '500')), 5000);
    const sortBy    = sp.get('sortBy') || 'cost_per_litre';
    const sortDir   = (sp.get('sortDir') || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    if (!VALID_SORTS.has(sortBy)) {
      return NextResponse.json({ error: 'Invalid sortBy' }, { status: 400 });
    }

    // Build maintenance WHERE params (with category). Parameters start at $1.
    const mp: any[] = [];
    const mc: string[] = [];
    let mi = 1;
    if (dateFrom)  { mc.push(`m.service_date >= $${mi++}`); mp.push(dateFrom); }
    if (dateTo)    { mc.push(`m.service_date <= $${mi++}`); mp.push(dateTo); }
    if (territory) { mc.push(`t.tm_code = $${mi++}`);        mp.push(territory.toUpperCase()); }
    if (category)  { mc.push(`m.category = $${mi++}`);       mp.push(category); }
    if (siteCode)  { mc.push(`m.site_code = $${mi++}`);      mp.push(siteCode); }
    const mWhere = mc.length ? `WHERE ${mc.join(' AND ')}` : '';

    // Sales WHERE params (no category). Parameters are offset by mp.length so they
    // follow the maintenance params in the combined params array.
    const sp_: any[] = [];
    const sc: string[] = [];
    let si = mp.length + 1; // offset after maint params
    if (dateFrom)  { sc.push(`s.sale_date >= $${si++}`); sp_.push(dateFrom); }
    if (dateTo)    { sc.push(`s.sale_date <= $${si++}`); sp_.push(dateTo); }
    if (territory) { sc.push(`t.tm_code = $${si++}`);    sp_.push(territory.toUpperCase()); }
    if (siteCode)  { sc.push(`s.site_code = $${si++}`);  sp_.push(siteCode); }
    const sWhere = sc.length ? `WHERE ${sc.join(' AND ')}` : '';

    // maint_cats CTE also reuses the maintenance WHERE (same param indices as mWhere).
    // The top_category subquery runs against the already-grouped maint_cats CTE.

    // Combined params: maint first, then sales, then limit.
    const params: any[] = [...mp, ...sp_, limit];
    const limitIdx = params.length; // $N for LIMIT

    const orderCol =
      sortBy === 'cost'           ? 'cost' :
      sortBy === 'volume'         ? 'volume' :
      sortBy === 'site_name'      ? 'site_name' :
      sortBy === 'territory_code' ? 'territory_code' :
                                    'cost_per_litre';

    // maint_cats CTE computes per-(site,category) spend with the same maintenance
    // WHERE so we can safely reference it as a correlated lookup for top_category.
    const sql = `
      WITH maint_cats AS (
        SELECT m.site_code, m.category, SUM(m.cost) AS cat_cost,
               ROW_NUMBER() OVER (PARTITION BY m.site_code ORDER BY SUM(m.cost) DESC) AS rk
        FROM maintenance_costs m
        JOIN sites si ON m.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        ${mWhere}
        GROUP BY m.site_code, m.category
      ),
      maint AS (
        SELECT
          m.site_code,
          si.budget_name                 AS site_name,
          t.tm_code                      AS territory_code,
          ROUND(SUM(m.cost)::NUMERIC, 2) AS cost,
          (SELECT mc.category FROM maint_cats mc
           WHERE mc.site_code = m.site_code AND mc.rk = 1) AS top_category
        FROM maintenance_costs m
        JOIN sites si ON m.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        ${mWhere}
        GROUP BY m.site_code, si.budget_name, t.tm_code
      ),
      vol AS (
        SELECT s.site_code,
               SUM(s.total_volume) AS volume
        FROM sales s
        JOIN sites si ON s.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        ${sWhere}
        GROUP BY s.site_code
      )
      SELECT
        maint.site_code,
        maint.site_name,
        maint.territory_code,
        maint.cost,
        COALESCE(vol.volume, 0)::NUMERIC AS volume,
        maint.top_category,
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
      data: rows.map((r: any) => ({
        siteCode:      r.site_code,
        siteName:      r.site_name,
        territoryCode: r.territory_code,
        cost:          parseFloat(r.cost),
        volume:        parseFloat(r.volume),
        topCategory:   r.top_category,
        costPerLitre:  r.cost_per_litre != null ? parseFloat(r.cost_per_litre) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/sites error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
