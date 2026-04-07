// app/api/top-sites/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query, buildSalesFilters, volumeExpr, revenueExpr, DashboardFilters } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filters: DashboardFilters = {
      dateFrom:  sp.get('dateFrom')  || undefined,
      dateTo:    sp.get('dateTo')    || undefined,
      territory: sp.get('territory') || undefined,
      product:   sp.get('product')   || undefined,
      moso:      sp.get('moso')      || undefined,
    };
    const limit = Math.min(Math.max(1, parseInt(sp.get('limit') || '10')), 100);
    const rawSort = sp.get('sortBy') || 'volume';
    const VALID_SORTS = ['volume', 'revenue', 'vs_budget'] as const;
    if (!VALID_SORTS.includes(rawSort as any)) {
      return NextResponse.json({ error: 'Invalid sortBy value' }, { status: 400 });
    }
    const sortBy = rawSort;

    const volExpr = volumeExpr(filters.product);
    const revExpr = revenueExpr(filters.product);
    const { where, params, nextOffset } = buildSalesFilters(filters);

    const baseJoins = `
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;

    // Current period totals per site
    const rows = await query<any>(`
      WITH site_totals AS (
        SELECT
          si.site_code,
          si.budget_name                                  AS site_name,
          si.moso,
          t.tm_code                                       AS territory_code,
          t.tm_name                                       AS territory_name,
          ROUND(SUM(${volExpr})::NUMERIC, 0)              AS volume,
          ROUND(SUM(${revExpr})::NUMERIC, 2)              AS revenue,
          COUNT(DISTINCT s.sale_date)                     AS days_traded,
          ROUND((SUM(${volExpr}) / NULLIF(COUNT(DISTINCT s.sale_date),0))::NUMERIC, 0) AS avg_daily,
          ROUND(CASE WHEN SUM(${volExpr}) > 0
            THEN SUM(COALESCE(s.cash_sale_value,0)) / SUM(${revExpr}) * 100
            ELSE 0 END::NUMERIC, 1)                      AS cash_ratio_pct
        ${baseJoins}
        ${where}
        GROUP BY si.site_code, si.budget_name, si.moso, t.tm_code, t.tm_name
      ),
      grand_total AS (
        SELECT SUM(volume) AS total FROM site_totals
      ),
      with_budget AS (
        SELECT
          st.*,
          COALESCE(vb.budget_volume, 0)                 AS budget_volume,
          COALESCE(vb.stretch_volume, 0)                AS stretch_volume
        FROM site_totals st
        LEFT JOIN volume_budget vb
          ON st.site_code = vb.site_code
          AND DATE_TRUNC('month', vb.budget_month) = DATE_TRUNC('month', COALESCE($${nextOffset + 1}::DATE, CURRENT_DATE))
      )
      SELECT
        wb.*,
        ROUND((wb.volume / NULLIF(gt.total, 0) * 100)::NUMERIC, 2) AS contribution_pct,
        CASE WHEN wb.budget_volume > 0
          THEN ROUND((wb.volume / wb.budget_volume * 100)::NUMERIC, 1)
          ELSE NULL END                                 AS vs_budget_pct,
        CASE WHEN wb.stretch_volume > 0
          THEN ROUND((wb.volume / wb.stretch_volume * 100)::NUMERIC, 1)
          ELSE NULL END                                 AS vs_stretch_pct,
        ROW_NUMBER() OVER (ORDER BY wb.volume DESC)     AS rank
      FROM with_budget wb, grand_total gt
      ORDER BY ${sortBy === 'vs_budget' ? 'vs_budget_pct DESC NULLS LAST'
                : sortBy === 'revenue'  ? 'revenue DESC'
                : 'volume DESC'}
      LIMIT $${nextOffset + 2}
    `, [...params, filters.dateTo || new Date().toISOString().split('T')[0], limit]);

    const data = rows.map((r: any) => ({
      rank:            parseInt(r.rank),
      siteCode:        r.site_code,
      siteName:        r.site_name,
      moso:            r.moso,
      territoryCode:   r.territory_code,
      territoryName:   r.territory_name,
      volume:          parseFloat(r.volume),
      revenue:         parseFloat(r.revenue),
      avgDaily:        parseFloat(r.avg_daily),
      daysTrade:       parseInt(r.days_traded),
      budgetVolume:    parseFloat(r.budget_volume),
      stretchVolume:   parseFloat(r.stretch_volume),
      contributionPct: parseFloat(r.contribution_pct),
      vsBudgetPct:     r.vs_budget_pct ? parseFloat(r.vs_budget_pct) : null,
      vsStretchPct:    r.vs_stretch_pct ? parseFloat(r.vs_stretch_pct) : null,
      cashRatioPct:    parseFloat(r.cash_ratio_pct),
    }));

    return NextResponse.json({ data, total: data.length });

  } catch (err: any) {
    console.error('/api/top-sites error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
