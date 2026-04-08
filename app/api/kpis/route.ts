// app/api/kpis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, buildSalesFilters, volumeExpr, revenueExpr, DashboardFilters } from '@/lib/db';

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

    const volExpr = volumeExpr(filters.product);
    const revExpr = revenueExpr(filters.product);

    // ── Reference dates ─────────────────────────────────────────────────────
    const today = filters.dateTo ? new Date(filters.dateTo) : new Date();
    const isoToday = today.toISOString().split('T')[0];
    const currentYear  = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const mtdFrom  = `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`;
    const ytdFrom  = `${currentYear}-01-01`;
    const priorMtdFrom = currentMonth === 1
      ? `${currentYear - 1}-12-01`
      : `${currentYear}-${String(currentMonth - 1).padStart(2,'0')}-01`;
    const priorMtdTo = currentMonth === 1
      ? `${currentYear - 1}-12-31`
      : new Date(currentYear, currentMonth - 1, 0).toISOString().split('T')[0];
    const priorYtdFrom = `${currentYear - 1}-01-01`;
    const priorYtdTo   = `${currentYear - 1}-${String(currentMonth).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    const baseJoins = `
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;

    // ── MTD ACTUAL ──────────────────────────────────────────────────────────
    const mtdFilters = buildSalesFilters({ ...filters, dateFrom: mtdFrom, dateTo: isoToday });
    const mtdRow = await queryOne<any>(`
      SELECT
        COALESCE(SUM(${volExpr}), 0)    AS volume,
        COALESCE(SUM(${revExpr}), 0)    AS revenue,
        COUNT(DISTINCT s.site_code)     AS active_sites,
        COUNT(DISTINCT s.sale_date)     AS trading_days,
        CASE WHEN COUNT(DISTINCT s.sale_date) > 0
          THEN SUM(${volExpr}) / COUNT(DISTINCT s.sale_date)
          ELSE 0 END                    AS avg_daily,
        CASE WHEN SUM(${volExpr}) > 0
          THEN SUM(COALESCE(s.cash_sale_value,0)) / SUM(${revExpr})
          ELSE 0 END                   AS cash_ratio
      ${baseJoins}
      ${mtdFilters.where}
    `, mtdFilters.params);

    // ── YTD ACTUAL ──────────────────────────────────────────────────────────
    const ytdFilters = buildSalesFilters({ ...filters, dateFrom: ytdFrom, dateTo: isoToday });
    const ytdRow = await queryOne<any>(`
      SELECT COALESCE(SUM(${volExpr}), 0) AS volume, COALESCE(SUM(${revExpr}), 0) AS revenue
      ${baseJoins}
      ${ytdFilters.where}
    `, ytdFilters.params);

    // ── PRIOR PERIOD MTD (for growth) ───────────────────────────────────────
    const priorMtdFilters = buildSalesFilters({ ...filters, dateFrom: priorMtdFrom, dateTo: priorMtdTo });
    const priorMtdRow = await queryOne<any>(`
      SELECT COALESCE(SUM(${volExpr}), 0) AS volume
      ${baseJoins}
      ${priorMtdFilters.where}
    `, priorMtdFilters.params);

    // ── PRIOR YTD ───────────────────────────────────────────────────────────
    const priorYtdFilters = buildSalesFilters({ ...filters, dateFrom: priorYtdFrom, dateTo: priorYtdTo });
    const priorYtdRow = await queryOne<any>(`
      SELECT COALESCE(SUM(${volExpr}), 0) AS volume
      ${baseJoins}
      ${priorYtdFilters.where}
    `, priorYtdFilters.params);

    // ── PRO-RATA BUDGET (MTD + YTD) ─────────────────────────────────────────
    // $1 = "today" (drives the calendar CTE)
    // optional territory / siteCode filters appended dynamically
    const budgetParams: any[] = [isoToday];
    let budgetFilterClause = '';
    if (filters.territory) {
      budgetParams.push(filters.territory.toUpperCase());
      budgetFilterClause += ` AND t.tm_code = $${budgetParams.length}`;
    }
    if (filters.siteCode) {
      budgetParams.push(filters.siteCode);
      budgetFilterClause += ` AND vb.site_code = $${budgetParams.length}`;
    }
    if (filters.moso) {
      budgetParams.push(filters.moso.toUpperCase());
      budgetFilterClause += ` AND si.moso = $${budgetParams.length}`;
    }

    const budgetRow = await queryOne<any>(`
      WITH calendar AS (
        SELECT
          $1::DATE                                                    AS today,
          DATE_TRUNC('month', $1::DATE)::DATE                         AS month_start,
          EXTRACT(DAY FROM $1::DATE)::INTEGER                         AS days_elapsed,
          EXTRACT(DAY FROM
            (DATE_TRUNC('month', $1::DATE) + INTERVAL '1 month' - INTERVAL '1 day')
          )::INTEGER                                                  AS days_in_month
      ),
      mtd_budget AS (
        SELECT
          COALESCE(SUM(vb.budget_volume / c.days_in_month * c.days_elapsed), 0)  AS mtd_budget_volume,
          COALESCE(SUM(
            COALESCE(vb.stretch_volume, vb.budget_volume * 1.1)
            / c.days_in_month * c.days_elapsed
          ), 0)                                                                  AS mtd_stretch_volume,
          COALESCE(SUM(vb.budget_volume), 0)                                     AS full_month_budget,
          COALESCE(SUM(COALESCE(vb.stretch_volume, vb.budget_volume * 1.1)), 0)  AS full_month_stretch
        FROM volume_budget vb
        JOIN sites si ON vb.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        CROSS JOIN calendar c
        WHERE vb.budget_month = c.month_start
        ${budgetFilterClause}
      ),
      ytd_budget AS (
        SELECT
          COALESCE(SUM(
            CASE
              WHEN vb.budget_month < c.month_start THEN vb.budget_volume
              ELSE vb.budget_volume / c.days_in_month * c.days_elapsed
            END
          ), 0) AS ytd_budget_volume,
          COALESCE(SUM(
            CASE
              WHEN vb.budget_month < c.month_start
                THEN COALESCE(vb.stretch_volume, vb.budget_volume * 1.1)
              ELSE COALESCE(vb.stretch_volume, vb.budget_volume * 1.1)
                   / c.days_in_month * c.days_elapsed
            END
          ), 0) AS ytd_stretch_volume
        FROM volume_budget vb
        JOIN sites si ON vb.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        CROSS JOIN calendar c
        WHERE vb.budget_month >= DATE_TRUNC('year', c.today)::DATE
          AND vb.budget_month <= c.month_start
          ${budgetFilterClause}
      )
      SELECT
        c.days_elapsed,
        c.days_in_month,
        m.mtd_budget_volume,
        m.mtd_stretch_volume,
        m.full_month_budget,
        m.full_month_stretch,
        y.ytd_budget_volume,
        y.ytd_stretch_volume
      FROM calendar c, mtd_budget m, ytd_budget y
    `, budgetParams);

    // ── MARGIN (avg cents-per-litre across sites) ────────────────────────────
    // Per-site cpl is SUM(net_gross_margin) / SUM(inv_volume) * 100 across all
    // months overlapping the requested range, then averaged across sites.
    const marginParams: any[] = [mtdFrom, isoToday];
    let marginTerritoryClause = '';
    if (filters.territory) {
      marginParams.push(filters.territory.toUpperCase());
      marginTerritoryClause += ` AND t.tm_code = $${marginParams.length}`;
    }
    if (filters.siteCode) {
      marginParams.push(filters.siteCode);
      marginTerritoryClause += ` AND m.site_code = $${marginParams.length}`;
    }
    const marginRow = await queryOne<any>(`
      WITH per_site AS (
        SELECT m.site_code,
               SUM(m.net_gross_margin) / NULLIF(SUM(m.inv_volume), 0) * 100 AS cpl,
               SUM(m.net_gross_margin) AS net_margin,
               SUM(m.inv_volume)       AS inv_volume
        FROM margin_data m
        JOIN sites si ON m.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        WHERE m.period_month >= DATE_TRUNC('month', $1::DATE)
          AND m.period_month <= DATE_TRUNC('month', $2::DATE)
        ${marginTerritoryClause}
        GROUP BY m.site_code
      )
      SELECT
        AVG(cpl)               AS avg_cpl_per_site,
        SUM(net_margin)        AS total_net_margin,
        SUM(inv_volume)        AS total_inv_volume,
        COUNT(*) FILTER (WHERE cpl IS NOT NULL) AS sites_with_margin
      FROM per_site
    `, marginParams);

    // ── PETROTRADE CONTRIBUTION ─────────────────────────────────────────────
    const petroRow = await queryOne<any>(`
      SELECT COALESCE(SUM(pt.volume_litres), 0) AS petrotrade_volume,
             COALESCE(SUM(pt.gross_margin), 0)  AS petrotrade_margin
      FROM petrotrade_sales pt
      JOIN sites si ON pt.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE pt.sale_date >= $1 AND pt.sale_date <= $2
      ${filters.territory ? `AND t.tm_code = $3` : ''}
    `, [mtdFrom, isoToday, ...(filters.territory ? [filters.territory.toUpperCase()] : [])]);

    // ── ASSEMBLE ────────────────────────────────────────────────────────────
    const mtdVolume    = parseFloat(mtdRow?.volume   || 0);
    const ytdVolume    = parseFloat(ytdRow?.volume   || 0);
    const priorMtd     = parseFloat(priorMtdRow?.volume || 0);
    const priorYtd     = parseFloat(priorYtdRow?.volume || 0);

    const daysElapsed  = parseInt(budgetRow?.days_elapsed  || 0);
    const daysInMonth  = parseInt(budgetRow?.days_in_month || 0);
    const mtdBudget    = parseFloat(budgetRow?.mtd_budget_volume   || 0);
    const mtdStretch   = parseFloat(budgetRow?.mtd_stretch_volume  || 0);
    const fullBudget   = parseFloat(budgetRow?.full_month_budget   || 0);
    const fullStretch  = parseFloat(budgetRow?.full_month_stretch  || 0);
    const ytdBudget    = parseFloat(budgetRow?.ytd_budget_volume   || 0);
    const ytdStretch   = parseFloat(budgetRow?.ytd_stretch_volume  || 0);

    const growthPct    = priorMtd > 0 ? ((mtdVolume - priorMtd) / priorMtd) * 100 : null;
    const ytdGrowthPct = priorYtd > 0 ? ((ytdVolume - priorYtd) / priorYtd) * 100 : null;
    const vsBudgetPct  = mtdBudget  > 0 ? (mtdVolume / mtdBudget)  * 100 : null;
    const vsStretchPct = mtdStretch > 0 ? (mtdVolume / mtdStretch) * 100 : null;
    const ytdVsBudget  = ytdBudget  > 0 ? (ytdVolume / ytdBudget)  * 100 : null;
    const ytdVsStretch = ytdStretch > 0 ? (ytdVolume / ytdStretch) * 100 : null;

    return NextResponse.json({
      mtd: {
        volume:       round2(mtdVolume),
        revenue:      round2(parseFloat(mtdRow?.revenue || 0)),
        avgDaily:     round2(parseFloat(mtdRow?.avg_daily || 0)),
        activeSites:  parseInt(mtdRow?.active_sites || 0),
        tradingDays:  parseInt(mtdRow?.trading_days || 0),
        cashRatio:    round4(parseFloat(mtdRow?.cash_ratio || 0)),
      },
      ytd: {
        volume:       round2(ytdVolume),
        revenue:      round2(parseFloat(ytdRow?.revenue || 0)),
        budget:       round2(ytdBudget),
        stretch:      round2(ytdStretch),
        vsBudgetPct:  ytdVsBudget  ? round2(ytdVsBudget)  : null,
        vsStretchPct: ytdVsStretch ? round2(ytdVsStretch) : null,
      },
      budget: {
        // pro-rated MTD targets
        mtdBudget:    round2(mtdBudget),
        mtdStretch:   round2(mtdStretch),
        // full-month figures (for reference / tooltips)
        fullMonthBudget:  round2(fullBudget),
        fullMonthStretch: round2(fullStretch),
        // pro-rata pace
        daysElapsed,
        daysInMonth,
        vsBudgetPct:  vsBudgetPct  ? round2(vsBudgetPct)  : null,
        vsStretchPct: vsStretchPct ? round2(vsStretchPct) : null,
      },
      growth: {
        mtdGrowthPct:  growthPct    ? round2(growthPct)    : null,
        ytdGrowthPct:  ytdGrowthPct ? round2(ytdGrowthPct) : null,
        priorMtdVolume: round2(priorMtd),
        priorYtdVolume: round2(priorYtd),
      },
      petrotrade: {
        mtdVolume:  round2(parseFloat(petroRow?.petrotrade_volume || 0)),
        mtdMargin:  round2(parseFloat(petroRow?.petrotrade_margin  || 0)),
      },
      margin: {
        avgCplPerSite:    marginRow?.avg_cpl_per_site != null ? round2(parseFloat(marginRow.avg_cpl_per_site)) : null,
        totalNetMargin:   round2(parseFloat(marginRow?.total_net_margin || 0)),
        totalInvVolume:   round2(parseFloat(marginRow?.total_inv_volume || 0)),
        sitesWithMargin:  parseInt(marginRow?.sites_with_margin || 0),
      },
      asOf: isoToday,
      budgetCoverage: fullBudget === 0
        ? `No budget records found for ${mtdFrom.slice(0, 7)} — upload current-year budgets to see vs-budget metrics.`
        : null,
    });

  } catch (err: any) {
    console.error('/api/kpis error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function round4(n: number) { return Math.round(n * 10000) / 10000; }
