// app/api/territory-performance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query, buildSalesFilters, volumeExpr, revenueExpr, DashboardFilters } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filters: DashboardFilters = {
      dateFrom: sp.get('dateFrom') || undefined,
      dateTo:   sp.get('dateTo')   || undefined,
      product:  sp.get('product')  || undefined,
      moso:     sp.get('moso')     || undefined,
    };

    const volExpr = volumeExpr(filters.product);
    const revExpr = revenueExpr(filters.product);
    const { where, params, nextOffset } = buildSalesFilters(filters);

    const baseJoins = `
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;

    const rows = await query<any>(`
      WITH territory_totals AS (
        SELECT
          t.tm_code                                        AS territory_code,
          t.tm_name                                        AS territory_name,
          ROUND(SUM(${volExpr})::NUMERIC, 0)               AS volume,
          ROUND(SUM(${revExpr})::NUMERIC, 2)               AS revenue,
          COUNT(DISTINCT si.site_code)                     AS site_count,
          ROUND((SUM(${volExpr}) / NULLIF(COUNT(DISTINCT s.sale_date), 0))::NUMERIC, 0) AS avg_daily,
          ROUND(CASE WHEN SUM(${volExpr}) > 0
            THEN SUM(COALESCE(s.cash_sale_value,0)) / SUM(${revExpr}) * 100
            ELSE 0 END::NUMERIC, 1)                       AS cash_ratio_pct,
          -- product mix
          ROUND(SUM(COALESCE(s.diesel_sales_volume,0)+COALESCE(s.flex_diesel_volume,0))::NUMERIC,0) AS diesel_vol,
          ROUND(SUM(COALESCE(s.blend_sales_volume,0)+COALESCE(s.flex_blend_volume,0))::NUMERIC,0)  AS blend_vol,
          ROUND(SUM(COALESCE(s.ulp_sales_volume,0))::NUMERIC,0)   AS ulp_vol
        ${baseJoins}
        ${where}
        GROUP BY t.tm_code, t.tm_name
      ),
      grand AS (SELECT SUM(volume) AS grand_total FROM territory_totals),
      territory_budget AS (
        SELECT
          t.tm_code,
          ROUND(SUM(vb.budget_volume)::NUMERIC, 0)        AS budget_volume,
          ROUND(SUM(vb.stretch_volume)::NUMERIC, 0)       AS stretch_volume
        FROM volume_budget vb
        JOIN sites si ON vb.site_code = si.site_code
        JOIN territories t ON si.territory_id = t.id
        WHERE DATE_TRUNC('month', vb.budget_month) = DATE_TRUNC('month', COALESCE($${nextOffset + 1}::DATE, CURRENT_DATE))
        GROUP BY t.tm_code
      )
      SELECT
        tt.*,
        tb.budget_volume,
        tb.stretch_volume,
        ROUND((tt.volume / NULLIF(g.grand_total, 0) * 100)::NUMERIC, 2) AS contribution_pct,
        CASE WHEN tb.budget_volume > 0
          THEN ROUND((tt.volume / tb.budget_volume * 100)::NUMERIC, 1) END AS vs_budget_pct,
        CASE WHEN tb.stretch_volume > 0
          THEN ROUND((tt.volume / tb.stretch_volume * 100)::NUMERIC, 1) END AS vs_stretch_pct
      FROM territory_totals tt
      CROSS JOIN grand g
      LEFT JOIN territory_budget tb ON tt.territory_code = tb.tm_code
      ORDER BY tt.volume DESC
    `, [...params, filters.dateTo || new Date().toISOString().split('T')[0]]);

    const data = rows.map((r: any) => ({
      territoryCode:   r.territory_code,
      territoryName:   r.territory_name,
      volume:          parseFloat(r.volume || 0),
      revenue:         parseFloat(r.revenue || 0),
      siteCount:       parseInt(r.site_count || 0),
      avgDaily:        parseFloat(r.avg_daily || 0),
      cashRatioPct:    parseFloat(r.cash_ratio_pct || 0),
      dieselVol:       parseFloat(r.diesel_vol || 0),
      blendVol:        parseFloat(r.blend_vol || 0),
      ulpVol:          parseFloat(r.ulp_vol || 0),
      budgetVolume:    parseFloat(r.budget_volume || 0),
      stretchVolume:   parseFloat(r.stretch_volume || 0),
      contributionPct: parseFloat(r.contribution_pct || 0),
      vsBudgetPct:     r.vs_budget_pct ? parseFloat(r.vs_budget_pct) : null,
      vsStretchPct:    r.vs_stretch_pct ? parseFloat(r.vs_stretch_pct) : null,
    }));

    return NextResponse.json({ data });

  } catch (err: any) {
    console.error('/api/territory-performance error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
