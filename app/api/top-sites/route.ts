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
    const limit = Math.min(Math.max(1, parseInt(sp.get('limit') || '10')), 1000);
    const rawSort = sp.get('sortBy') || 'volume';
    const VALID_SORTS = ['volume', 'revenue', 'vs_budget', 'budget'] as const;
    if (!VALID_SORTS.includes(rawSort as any)) {
      return NextResponse.json({ error: 'Invalid sortBy value' }, { status: 400 });
    }
    const sortBy = rawSort;

    const volExpr = volumeExpr(filters.product);
    const revExpr = revenueExpr(filters.product);
    const { where, params, nextOffset } = buildSalesFilters(filters);

    // Effective date range for pro-rata budget calc.
    const rangeFrom = filters.dateFrom || `${new Date().getFullYear()}-01-01`;
    const rangeTo   = filters.dateTo   || new Date().toISOString().split('T')[0];

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
          ROUND(CASE WHEN SUM(${revExpr}) > 0
            THEN SUM(COALESCE(s.cash_sale_value,0)) / SUM(${revExpr}) * 100
            ELSE 0 END::NUMERIC, 1)                      AS cash_ratio_pct,
          ROUND(SUM(
            COALESCE(s.diesel_coupon_qty, 0) +
            COALESCE(s.blend_coupon_qty,  0) +
            COALESCE(s.ulp_coupon_qty,    0)
          )::NUMERIC, 0)                                 AS coupon_volume,
          ROUND(SUM(
            COALESCE(s.diesel_card_qty, 0) +
            COALESCE(s.blend_card_qty,  0) +
            COALESCE(s.ulp_card_qty,    0)
          )::NUMERIC, 0)                                 AS card_volume,
          ROUND(SUM(
            COALESCE(s.flex_diesel_volume, 0) +
            COALESCE(s.flex_blend_volume,  0)
          )::NUMERIC, 0)                                 AS flex_volume
        ${baseJoins}
        ${where}
        GROUP BY si.site_code, si.budget_name, si.moso, t.tm_code, t.tm_name
      ),
      grand_total AS (
        SELECT SUM(volume) AS total FROM site_totals
      ),
      -- Net margin (cents per litre) per site from monthly site_margins,
      -- volume-weighted by actual sales volume in each overlapping month.
      site_margin_monthly_sales AS (
        SELECT site_code,
               DATE_TRUNC('month', sale_date)::DATE AS m,
               SUM(total_volume) AS volume
        FROM sales
        WHERE sale_date >= $${nextOffset + 1}::DATE
          AND sale_date <= $${nextOffset + 2}::DATE
        GROUP BY site_code, DATE_TRUNC('month', sale_date)
      ),
      site_margin AS (
        SELECT
          sm.site_code,
          ROUND((SUM(sm.margin_per_litre * COALESCE(ms.volume, 0))
                 / NULLIF(SUM(COALESCE(ms.volume, 0)), 0) * 100)::NUMERIC, 2) AS net_margin_cpl
        FROM site_margins sm
        LEFT JOIN site_margin_monthly_sales ms
          ON ms.site_code = sm.site_code AND ms.m = sm.period_month
        WHERE sm.period_month >= DATE_TRUNC('month', $${nextOffset + 1}::DATE)
          AND sm.period_month <= DATE_TRUNC('month', $${nextOffset + 2}::DATE)
        GROUP BY sm.site_code
      ),
      -- Pro-rated budget for the queried date range: for each (site, month)
      -- overlapping the range, take (overlap_days / calendar_days * monthly_budget).
      site_budget AS (
        SELECT
          vb.site_code,
          SUM(
            vb.budget_volume / bc.calendar_days::NUMERIC *
            GREATEST(0,
              (LEAST((bc.period_month + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
                     $${nextOffset + 2}::DATE)
               - GREATEST(bc.period_month, $${nextOffset + 1}::DATE) + 1)::INTEGER
            )
          ) AS budget_volume,
          SUM(
            (vb.budget_volume * 1.1) / bc.calendar_days::NUMERIC *
            GREATEST(0,
              (LEAST((bc.period_month + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
                     $${nextOffset + 2}::DATE)
               - GREATEST(bc.period_month, $${nextOffset + 1}::DATE) + 1)::INTEGER
            )
          ) AS stretch_volume
        FROM volume_budget vb
        JOIN budget_calendar bc ON vb.budget_month = bc.period_month
        WHERE bc.period_month <= $${nextOffset + 2}::DATE
          AND (bc.period_month + INTERVAL '1 month')::DATE > $${nextOffset + 1}::DATE
        GROUP BY vb.site_code
      ),
      with_budget AS (
        SELECT
          st.*,
          COALESCE(sb.budget_volume, 0)  AS budget_volume,
          COALESCE(sb.stretch_volume, 0) AS stretch_volume,
          sm.net_margin_cpl
        FROM site_totals st
        LEFT JOIN site_budget sb ON st.site_code = sb.site_code
        LEFT JOIN site_margin sm ON st.site_code = sm.site_code
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
                : sortBy === 'budget'   ? 'budget_volume DESC NULLS LAST'
                : 'volume DESC'}
      LIMIT $${nextOffset + 3}
    `, [...params, rangeFrom, rangeTo, limit]);

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
      couponVolume:    parseFloat(r.coupon_volume || 0),
      cardVolume:      parseFloat(r.card_volume   || 0),
      flexVolume:      parseFloat(r.flex_volume   || 0),
      netMarginCpl:    r.net_margin_cpl != null ? parseFloat(r.net_margin_cpl) : null,
    }));

    return NextResponse.json({ data, total: data.length });

  } catch (err: any) {
    console.error('/api/top-sites error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
