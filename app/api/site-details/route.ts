// app/api/site-details/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const siteCode = sp.get('siteCode');
    const dateFrom = sp.get('dateFrom') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo   = sp.get('dateTo')   || new Date().toISOString().split('T')[0];

    if (!siteCode) {
      return NextResponse.json({ error: 'siteCode is required' }, { status: 400 });
    }

    // Site info
    const siteInfo = await queryOne<any>(`
      SELECT si.site_code, si.budget_name AS site_name, si.moso,
             t.tm_code AS territory_code, t.tm_name AS territory_name
      FROM sites si
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE si.site_code = $1
    `, [siteCode]);

    if (!siteInfo) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    // Period KPIs
    const kpis = await queryOne<any>(`
      SELECT
        ROUND(SUM(total_volume)::NUMERIC, 0)           AS total_volume,
        ROUND(SUM(total_revenue)::NUMERIC, 2)          AS total_revenue,
        ROUND(SUM(COALESCE(diesel_sales_volume,0)+COALESCE(flex_diesel_volume,0))::NUMERIC,0) AS diesel_volume,
        ROUND(SUM(COALESCE(blend_sales_volume,0)+COALESCE(flex_blend_volume,0))::NUMERIC,0)  AS blend_volume,
        ROUND(SUM(COALESCE(ulp_sales_volume,0))::NUMERIC,0) AS ulp_volume,
        COUNT(DISTINCT sale_date)                      AS days_traded,
        ROUND(AVG(total_volume)::NUMERIC, 0)           AS avg_daily,
        ROUND(CASE WHEN SUM(total_volume) > 0
          THEN SUM(COALESCE(cash_sale_value,0)) / SUM(total_revenue) * 100
          ELSE 0 END::NUMERIC, 1)                      AS cash_ratio_pct,
        -- gain/loss
        ROUND(SUM(COALESCE(diesel_gain_loss,0))::NUMERIC, 2) AS diesel_gain_loss,
        ROUND(SUM(COALESCE(blend_gain_loss,0))::NUMERIC, 2)  AS blend_gain_loss,
        ROUND(SUM(COALESCE(ulp_gain_loss,0))::NUMERIC, 2)    AS ulp_gain_loss
      FROM sales
      WHERE site_code = $1 AND sale_date BETWEEN $2 AND $3
    `, [siteCode, dateFrom, dateTo]);

    // Budget for the period
    const budget = await queryOne<any>(`
      SELECT
        ROUND(SUM(budget_volume)::NUMERIC, 0)  AS budget_volume,
        ROUND(SUM(budget_volume * 1.1)::NUMERIC, 0) AS stretch_volume,
        AVG(margin_budget)                     AS margin_budget
      FROM volume_budget
      WHERE site_code = $1
        AND budget_month BETWEEN DATE_TRUNC('month', $2::DATE)
                             AND DATE_TRUNC('month', $3::DATE)
    `, [siteCode, dateFrom, dateTo]);

    // Daily sales for charting
    const daily = await query<any>(`
      SELECT
        sale_date::TEXT                                                  AS date,
        ROUND(total_volume::NUMERIC, 0)                                  AS total,
        ROUND((COALESCE(diesel_sales_volume,0)+COALESCE(flex_diesel_volume,0))::NUMERIC,0) AS diesel,
        ROUND((COALESCE(blend_sales_volume,0)+COALESCE(flex_blend_volume,0))::NUMERIC,0)  AS blend,
        ROUND(COALESCE(ulp_sales_volume,0)::NUMERIC,0)                   AS ulp,
        ROUND(total_revenue::NUMERIC,2)                                  AS revenue,
        ROUND(COALESCE(cash_sale_value,0)::NUMERIC,2)                    AS cash_value,
        COALESCE(diesel_gain_loss,0)+COALESCE(blend_gain_loss,0)+COALESCE(ulp_gain_loss,0) AS dip_variance
      FROM sales
      WHERE site_code = $1 AND sale_date BETWEEN $2 AND $3
      ORDER BY sale_date
    `, [siteCode, dateFrom, dateTo]);

    // Petrotrade for this site
    const petrotrade = await queryOne<any>(`
      SELECT
        ROUND(SUM(volume_litres)::NUMERIC, 0) AS volume,
        ROUND(SUM(gross_margin)::NUMERIC, 2)  AS margin
      FROM petrotrade_sales
      WHERE site_code = $1 AND sale_date BETWEEN $2 AND $3
    `, [siteCode, dateFrom, dateTo]);

    // Margin (monthly $/L from site_margins, weighted by actual sales volume)
    const margin = await queryOne<any>(`
      WITH monthly_sales AS (
        SELECT DATE_TRUNC('month', sale_date)::DATE AS m,
               SUM(total_volume) AS volume
        FROM sales
        WHERE site_code = $1 AND sale_date BETWEEN $2 AND $3
        GROUP BY DATE_TRUNC('month', sale_date)
      )
      SELECT
        ROUND(SUM(COALESCE(ms.volume, 0))::NUMERIC, 0)                    AS inv_volume,
        ROUND(AVG(sm.margin_per_litre)::NUMERIC, 4)                       AS unit_margin,
        ROUND(SUM(sm.margin_per_litre * COALESCE(ms.volume, 0))::NUMERIC, 2) AS gross_margin,
        ROUND(AVG(sm.margin_per_litre)::NUMERIC, 4)                       AS net_margin
      FROM site_margins sm
      LEFT JOIN monthly_sales ms ON ms.m = sm.period_month
      WHERE sm.site_code = $1
        AND sm.period_month BETWEEN DATE_TRUNC('month', $2::DATE)
                                AND DATE_TRUNC('month', $3::DATE)
    `, [siteCode, dateFrom, dateTo]);

    // Reconciliation status
    const recon = await queryOne<any>(`
      SELECT variance, variance_pct, is_flagged, notes
      FROM reconciliation_log
      WHERE site_code = $1
        AND period_month = DATE_TRUNC('month', $2::DATE)
      LIMIT 1
    `, [siteCode, dateFrom]);

    // Rank vs peers in same territory
    const rank = await queryOne<any>(`
      WITH territory_sites AS (
        SELECT s.site_code,
               SUM(sl.total_volume) AS vol,
               RANK() OVER (ORDER BY SUM(sl.total_volume) DESC) AS rnk
        FROM sales sl
        JOIN sites s ON sl.site_code = s.site_code
        WHERE sl.sale_date BETWEEN $2 AND $3
          AND s.territory_id = (SELECT territory_id FROM sites WHERE site_code = $1)
        GROUP BY s.site_code
      )
      SELECT rnk AS territory_rank,
             COUNT(*) OVER () AS territory_site_count
      FROM territory_sites WHERE site_code = $1
    `, [siteCode, dateFrom, dateTo]);

    return NextResponse.json({
      siteInfo,
      kpis: {
        ...kpis,
        total_volume:  parseFloat(kpis?.total_volume || 0),
        total_revenue: parseFloat(kpis?.total_revenue || 0),
        diesel_volume: parseFloat(kpis?.diesel_volume || 0),
        blend_volume:  parseFloat(kpis?.blend_volume || 0),
        ulp_volume:    parseFloat(kpis?.ulp_volume || 0),
        avg_daily:     parseFloat(kpis?.avg_daily || 0),
        budget_volume: parseFloat(budget?.budget_volume || 0),
        stretch_volume: parseFloat(budget?.stretch_volume || 0),
        vs_budget_pct: budget?.budget_volume > 0
          ? Math.round(parseFloat(kpis?.total_volume || 0) / parseFloat(budget.budget_volume) * 100 * 10) / 10
          : null,
      },
      petrotrade: { volume: parseFloat(petrotrade?.volume || 0), margin: parseFloat(petrotrade?.margin || 0) },
      margin: margin ? {
        inv_volume:  parseFloat(margin.inv_volume || 0),
        avg_price:   null,
        unit_margin: parseFloat(margin.unit_margin || 0),
        gross_margin: parseFloat(margin.gross_margin || 0),
        net_margin:  parseFloat(margin.net_margin || 0),
      } : null,
      reconciliation: recon,
      rank: rank ? {
        territory_rank:       parseInt(rank.territory_rank),
        territory_site_count: parseInt(rank.territory_site_count),
      } : null,
      daily: daily.map((d: any) => ({
        ...d,
        total:       parseFloat(d.total),
        diesel:      parseFloat(d.diesel),
        blend:       parseFloat(d.blend),
        ulp:         parseFloat(d.ulp),
        revenue:     parseFloat(d.revenue),
        cash_value:  parseFloat(d.cash_value),
        dip_variance: parseFloat(d.dip_variance),
      })),
    });

  } catch (err: any) {
    console.error('/api/site-details error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
