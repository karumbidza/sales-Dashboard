// app/api/sales-trend/route.ts
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
      siteCode:  sp.get('siteCode')  || undefined,
      moso:      sp.get('moso')      || undefined,
    };
    const granularity = sp.get('granularity') || 'daily'; // daily | monthly

    const volExpr = volumeExpr(filters.product);
    const revExpr = revenueExpr(filters.product);
    const { where, params } = buildSalesFilters(filters);

    const baseJoins = `
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;

    if (granularity === 'monthly') {
      // Monthly trend with budget overlay
      const rows = await query<any>(`
        SELECT
          DATE_TRUNC('month', s.sale_date)::DATE          AS period,
          TO_CHAR(DATE_TRUNC('month', s.sale_date), 'Mon YYYY') AS label,
          ROUND(SUM(${volExpr})::NUMERIC, 0)              AS actual_volume,
          ROUND(SUM(${revExpr})::NUMERIC, 2)              AS actual_revenue,
          ROUND(SUM(COALESCE(s.diesel_sales_volume,0) + COALESCE(s.flex_diesel_volume,0))::NUMERIC, 0) AS diesel_volume,
          ROUND(SUM(COALESCE(s.blend_sales_volume,0) + COALESCE(s.flex_blend_volume,0))::NUMERIC, 0)  AS blend_volume,
          ROUND(SUM(COALESCE(s.ulp_sales_volume,0))::NUMERIC, 0)  AS ulp_volume,
          COUNT(DISTINCT s.site_code)                     AS active_sites,
          COUNT(DISTINCT s.sale_date)                     AS trading_days,
          ROUND((SUM(${volExpr}) / NULLIF(COUNT(DISTINCT s.sale_date), 0))::NUMERIC, 0) AS avg_daily
        ${baseJoins}
        ${where}
        GROUP BY DATE_TRUNC('month', s.sale_date)
        ORDER BY period ASC
      `, params);

      // Fetch budget for same periods
      const periods = rows.map((r: any) => r.period);
      let budgetMap: Record<string, number> = {};
      let stretchMap: Record<string, number> = {};

      if (periods.length > 0) {
        const budgetParams = [...(filters.territory ? [filters.territory.toUpperCase()] : [])];
        const terrClause = filters.territory ? `AND t.tm_code = $${budgetParams.length}` : '';

        const budgetRows = await query<any>(`
          SELECT
            vb.budget_month::DATE AS period,
            ROUND(SUM(vb.budget_volume)::NUMERIC, 0)  AS budget_volume,
            ROUND(SUM(vb.budget_volume * 1.1)::NUMERIC, 0) AS stretch_volume
          FROM volume_budget vb
          JOIN sites si ON vb.site_code = si.site_code
          LEFT JOIN territories t ON si.territory_id = t.id
          WHERE vb.budget_month = ANY($${budgetParams.length + 1}::DATE[])
          ${terrClause}
          GROUP BY vb.budget_month
        `, [...budgetParams, periods]);

        budgetMap   = Object.fromEntries(budgetRows.map((r: any) => [r.period, parseFloat(r.budget_volume)]));
        stretchMap  = Object.fromEntries(budgetRows.map((r: any) => [r.period, parseFloat(r.stretch_volume)]));
      }

      // Merge
      const enriched = rows.map((r: any) => ({
        ...r,
        actual_volume:  parseFloat(r.actual_volume),
        actual_revenue: parseFloat(r.actual_revenue),
        diesel_volume:  parseFloat(r.diesel_volume),
        blend_volume:   parseFloat(r.blend_volume),
        ulp_volume:     parseFloat(r.ulp_volume),
        avg_daily:      parseFloat(r.avg_daily),
        budget_volume:  budgetMap[r.period]  ?? null,
        stretch_volume: stretchMap[r.period] ?? null,
        vs_budget_pct:  budgetMap[r.period]
          ? Math.round((parseFloat(r.actual_volume) / budgetMap[r.period]) * 100 * 10) / 10
          : null,
      }));

      return NextResponse.json({ granularity: 'monthly', data: enriched });
    }

    // ── DAILY TREND ─────────────────────────────────────────────────────────
    const rows = await query<any>(`
      SELECT
        s.sale_date::TEXT                                  AS date,
        s.sale_date::TEXT                                  AS period,
        TO_CHAR(s.sale_date, 'DD Mon')                    AS label,
        ROUND(SUM(${volExpr})::NUMERIC, 0)                AS actual_volume,
        ROUND(SUM(${revExpr})::NUMERIC, 2)                AS actual_revenue,
        ROUND(SUM(COALESCE(s.diesel_sales_volume,0) + COALESCE(s.flex_diesel_volume,0))::NUMERIC, 0) AS diesel_volume,
        ROUND(SUM(COALESCE(s.blend_sales_volume,0) + COALESCE(s.flex_blend_volume,0))::NUMERIC, 0)  AS blend_volume,
        ROUND(SUM(COALESCE(s.ulp_sales_volume,0))::NUMERIC, 0)  AS ulp_volume,
        COUNT(DISTINCT s.site_code)                       AS active_sites,
        ROUND(SUM(COALESCE(s.cash_sale_value,0))::NUMERIC, 2) AS cash_value
      ${baseJoins}
      ${where}
      GROUP BY s.sale_date
      ORDER BY s.sale_date ASC
    `, params);

    // Build a (month → monthly budget total) map for each month touched by the
    // result set, honouring the same territory / siteCode / moso filters.
    const months = Array.from(new Set(
      rows.map((r: any) => String(r.date).slice(0, 7) + '-01')
    ));
    const monthlyBudgetMap:  Record<string, number> = {};
    const monthlyStretchMap: Record<string, number> = {};
    if (months.length > 0) {
      const bp: any[] = [months];
      let bClause = '';
      if (filters.territory) {
        bp.push(filters.territory.toUpperCase());
        bClause += ` AND t.tm_code = $${bp.length}`;
      }
      if (filters.siteCode) {
        bp.push(filters.siteCode);
        bClause += ` AND vb.site_code = $${bp.length}`;
      }
      if (filters.moso) {
        bp.push(filters.moso.toUpperCase());
        bClause += ` AND si.moso = $${bp.length}`;
      }
      const budgetRows = await query<any>(`
        SELECT vb.budget_month::TEXT AS m,
               SUM(vb.budget_volume)  AS budget_volume,
               SUM(vb.budget_volume * 1.1) AS stretch_volume
        FROM volume_budget vb
        JOIN sites si ON vb.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        WHERE vb.budget_month = ANY($1::DATE[])
        ${bClause}
        GROUP BY vb.budget_month
      `, bp);
      for (const r of budgetRows) {
        const k = String(r.m).slice(0, 10);
        monthlyBudgetMap[k]  = parseFloat(r.budget_volume);
        monthlyStretchMap[k] = parseFloat(r.stretch_volume);
      }
    }

    const data = rows.map((r: any) => {
      const monthKey = String(r.date).slice(0, 7) + '-01';
      return {
        ...r,
        date:           String(r.date).slice(0, 10),
        actual_volume:  parseFloat(r.actual_volume),
        actual_revenue: parseFloat(r.actual_revenue),
        diesel_volume:  parseFloat(r.diesel_volume),
        blend_volume:   parseFloat(r.blend_volume),
        ulp_volume:     parseFloat(r.ulp_volume),
        cash_value:     parseFloat(r.cash_value),
        budget_volume:  monthlyBudgetMap[monthKey]  ?? null,  // monthly total
        stretch_volume: monthlyStretchMap[monthKey] ?? null,  // monthly total
      };
    });

    return NextResponse.json({ granularity: 'daily', data });

  } catch (err: any) {
    console.error('/api/sales-trend error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
