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
    // Same day-of-month as today, in the prior month, so we compare like for
    // like (e.g. Apr 1–9 vs Mar 1–9). Clamp to the prior month's last day so
    // we don't overflow when today is the 31st and the prior month has 30.
    const priorMonthYear  = currentMonth === 1 ? currentYear - 1 : currentYear;
    const priorMonthIndex = currentMonth === 1 ? 11 : currentMonth - 2; // 0-based
    const priorMonthLastDay = new Date(priorMonthYear, priorMonthIndex + 1, 0).getDate();
    const priorMtdToDay = Math.min(today.getDate(), priorMonthLastDay);
    const priorMtdTo = `${priorMonthYear}-${String(priorMonthIndex + 1).padStart(2, '0')}-${String(priorMtdToDay).padStart(2, '0')}`;
    // Same elapsed window in the prior calendar year. Clamp the day to the
    // prior month's last day so leap-year edges (e.g. dateTo = 29 Feb) don't
    // overflow into March of the prior year.
    const priorYtdFrom    = `${currentYear - 1}-01-01`;
    const priorYearMonthLast = new Date(currentYear - 1, currentMonth, 0).getDate();
    const priorYtdToDay   = Math.min(today.getDate(), priorYearMonthLast);
    const priorYtdTo      = `${currentYear - 1}-${String(currentMonth).padStart(2,'0')}-${String(priorYtdToDay).padStart(2,'0')}`;

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
          ELSE 0 END                   AS cash_ratio,
        COALESCE(SUM(s.flex_blend_volume + s.flex_diesel_volume), 0) AS flex_volume,
        COALESCE(SUM(
          COALESCE(s.diesel_coupon_qty, 0) + COALESCE(s.blend_coupon_qty, 0) + COALESCE(s.ulp_coupon_qty, 0)
        ), 0)                                                          AS coupon_volume,
        COALESCE(SUM(
          COALESCE(s.diesel_card_qty, 0) + COALESCE(s.blend_card_qty, 0) + COALESCE(s.ulp_card_qty, 0)
        ), 0)                                                          AS card_volume
      ${baseJoins}
      ${mtdFilters.where}
    `, mtdFilters.params);

    // ── YTD ACTUAL ──────────────────────────────────────────────────────────
    const ytdFilters = buildSalesFilters({ ...filters, dateFrom: ytdFrom, dateTo: isoToday });
    const ytdRow = await queryOne<any>(`
      SELECT COALESCE(SUM(${volExpr}), 0) AS volume,
             COALESCE(SUM(${revExpr}), 0) AS revenue,
             COUNT(DISTINCT s.site_code) AS active_sites
      ${baseJoins}
      ${ytdFilters.where}
    `, ytdFilters.params);

    // ── PRIOR PERIOD MTD (for growth) ───────────────────────────────────────
    const priorMtdFilters = buildSalesFilters({ ...filters, dateFrom: priorMtdFrom, dateTo: priorMtdTo });
    const priorMtdRow = await queryOne<any>(`
      SELECT COALESCE(SUM(${volExpr}), 0) AS volume,
             COUNT(DISTINCT s.site_code) AS active_sites,
             COALESCE(SUM(s.flex_blend_volume + s.flex_diesel_volume), 0) AS flex_volume
      ${baseJoins}
      ${priorMtdFilters.where}
    `, priorMtdFilters.params);

    // ── PRIOR YTD ───────────────────────────────────────────────────────────
    const priorYtdFilters = buildSalesFilters({ ...filters, dateFrom: priorYtdFrom, dateTo: priorYtdTo });
    const priorYtdRow = await queryOne<any>(`
      SELECT COALESCE(SUM(${volExpr}), 0) AS volume,
             COUNT(DISTINCT s.site_code) AS active_sites
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
            (vb.budget_volume * 1.1)
            / c.days_in_month * c.days_elapsed
          ), 0)                                                                  AS mtd_stretch_volume,
          COALESCE(SUM(vb.budget_volume), 0)                                     AS full_month_budget,
          COALESCE(SUM((vb.budget_volume * 1.1)), 0)  AS full_month_stretch
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
                THEN (vb.budget_volume * 1.1)
              ELSE (vb.budget_volume * 1.1)
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

    // ── MARGIN (volume-weighted $/L from monthly site_margins) ──────────────
    // Net margin $ = margin_per_litre × actual monthly volume from sales.
    const marginParams: any[] = [mtdFrom, isoToday];
    let marginTerritoryClause = '';
    if (filters.territory) {
      marginParams.push(filters.territory.toUpperCase());
      marginTerritoryClause += ` AND t.tm_code = $${marginParams.length}`;
    }
    if (filters.siteCode) {
      marginParams.push(filters.siteCode);
      marginTerritoryClause += ` AND sm.site_code = $${marginParams.length}`;
    }
    const marginRow = await queryOne<any>(`
      WITH monthly_sales AS (
        SELECT s.site_code,
               DATE_TRUNC('month', s.sale_date)::DATE AS m,
               SUM(s.total_volume) AS volume
        FROM sales s
        WHERE s.sale_date >= $1 AND s.sale_date <= $2
        GROUP BY s.site_code, DATE_TRUNC('month', s.sale_date)
      ),
      per_site AS (
        SELECT sm.site_code,
               SUM(sm.margin_per_litre * COALESCE(ms.volume, 0)) AS net_margin,
               SUM(COALESCE(ms.volume, 0)) AS inv_volume,
               CASE WHEN SUM(COALESCE(ms.volume, 0)) > 0
                 THEN SUM(sm.margin_per_litre * COALESCE(ms.volume, 0))
                      / SUM(COALESCE(ms.volume, 0)) * 100
                 ELSE NULL END AS cpl
        FROM site_margins sm
        JOIN sites si ON sm.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        LEFT JOIN monthly_sales ms
          ON ms.site_code = sm.site_code AND ms.m = sm.period_month
        WHERE sm.period_month >= DATE_TRUNC('month', $1::DATE)
          AND sm.period_month <= DATE_TRUNC('month', $2::DATE)
        ${marginTerritoryClause}
        GROUP BY sm.site_code
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

    // ── PRIOR MONTH PETROTRADE ─────────────────────────────────────────────
    const priorPetroRow = await queryOne<any>(`
      SELECT COALESCE(SUM(pt.volume_litres), 0) AS petrotrade_volume
      FROM petrotrade_sales pt
      JOIN sites si ON pt.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE pt.sale_date >= $1 AND pt.sale_date <= $2
      ${filters.territory ? `AND t.tm_code = $3` : ''}
    `, [priorMtdFrom, priorMtdTo, ...(filters.territory ? [filters.territory.toUpperCase()] : [])]);

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

    // ── PROJECTION (day-of-week weighted run-rate from last 90 days) ────────
    const daysElapsedNum = today.getDate();
    const daysInMonthNum = new Date(currentYear, currentMonth, 0).getDate();
    const daysRemainingNum = daysInMonthNum - daysElapsedNum;
    const isLastDay = daysRemainingNum === 0;

    const ninetyAgo = new Date(today);
    ninetyAgo.setDate(ninetyAgo.getDate() - 90);
    const ninetyFrom = ninetyAgo.toISOString().split('T')[0];

    const dailyFilters = buildSalesFilters({ ...filters, dateFrom: ninetyFrom, dateTo: isoToday });
    const dailyRows = await query<any>(`
      SELECT s.sale_date, COALESCE(SUM(${volExpr}), 0) AS volume
      ${baseJoins}
      ${dailyFilters.where}
      GROUP BY s.sale_date
      ORDER BY s.sale_date
    `, dailyFilters.params);

    const dowSum = [0,0,0,0,0,0,0];
    const dowCount = [0,0,0,0,0,0,0];
    let total90 = 0, total90Count = 0;
    for (const r of dailyRows) {
      const v = parseFloat(r.volume) || 0;
      const d = new Date(r.sale_date).getDay();
      dowSum[d] += v;
      dowCount[d] += 1;
      total90 += v;
      total90Count += 1;
    }
    const overallAvg = total90Count > 0 ? total90 / total90Count : 0;
    const dowWeight = dowSum.map((s, i) => {
      const avg = dowCount[i] > 0 ? s / dowCount[i] : overallAvg;
      return overallAvg > 0 ? avg / overallAvg : 1;
    });

    let projection: any = null;
    if (isLastDay) {
      // Next-month forecast: current month's daily average × days in next month
      const currentDailyAvg = daysElapsedNum > 0 ? mtdVolume / daysElapsedNum : 0;
      const nextMonthDays = new Date(currentYear, currentMonth + 1, 0).getDate();
      const value = currentDailyAvg * nextMonthDays;
      const nextLabel = new Date(currentYear, currentMonth, 1)
        .toLocaleString('en', { month: 'short', year: 'numeric' });
      projection = {
        value: round2(value),
        confidenceLow:  round2(value * 0.95),
        confidenceHigh: round2(value * 1.05),
        method: 'next_month_forecast',
        daysElapsed: daysElapsedNum,
        daysRemaining: 0,
        isNextMonth: true,
        label: `${nextLabel} forecast`,
      };
    } else {
      const dailyAvg = daysElapsedNum > 0 ? mtdVolume / daysElapsedNum : 0;
      let value: number;
      let method: string;
      if (daysElapsedNum < 3) {
        value = mtdVolume + dailyAvg * daysRemainingNum;
        method = 'run_rate';
      } else {
        let projectedRemaining = 0;
        for (let d = daysElapsedNum + 1; d <= daysInMonthNum; d++) {
          const dow = new Date(currentYear, currentMonth - 1, d).getDay();
          projectedRemaining += dailyAvg * dowWeight[dow];
        }
        value = mtdVolume + projectedRemaining;
        method = 'dow_weighted';
      }
      const monthLabel = new Date(currentYear, currentMonth - 1, 1)
        .toLocaleString('en', { month: 'short', year: 'numeric' });
      projection = {
        value: round2(value),
        confidenceLow:  round2(value * 0.95),
        confidenceHigh: round2(value * 1.05),
        method,
        daysElapsed: daysElapsedNum,
        daysRemaining: daysRemainingNum,
        isNextMonth: false,
        label: `Projected ${monthLabel}`,
      };
    }

    return NextResponse.json({
      mtd: {
        volume:       round2(mtdVolume),
        revenue:      round2(parseFloat(mtdRow?.revenue || 0)),
        avgDaily:     round2(parseFloat(mtdRow?.avg_daily || 0)),
        activeSites:  parseInt(mtdRow?.active_sites || 0),
        tradingDays:  parseInt(mtdRow?.trading_days || 0),
        cashRatio:    round4(parseFloat(mtdRow?.cash_ratio || 0)),
        flexVolume:   round2(parseFloat(mtdRow?.flex_volume   || 0)),
        couponVolume: round2(parseFloat(mtdRow?.coupon_volume || 0)),
        cardVolume:   round2(parseFloat(mtdRow?.card_volume   || 0)),
      },
      ytd: {
        volume:       round2(ytdVolume),
        revenue:      round2(parseFloat(ytdRow?.revenue || 0)),
        activeSites:  parseInt(ytdRow?.active_sites || 0),
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
        priorMtdVolume:      round2(priorMtd),
        priorYtdVolume:      round2(priorYtd),
        priorMtdActiveSites: parseInt(priorMtdRow?.active_sites || 0),
        priorYtdActiveSites: parseInt(priorYtdRow?.active_sites || 0),
        priorMtdFlexVolume:  round2(parseFloat(priorMtdRow?.flex_volume || 0)),
      },
      petrotrade: {
        mtdVolume:  round2(parseFloat(petroRow?.petrotrade_volume || 0)),
        mtdMargin:  round2(parseFloat(petroRow?.petrotrade_margin  || 0)),
        priorMtdVolume: round2(parseFloat(priorPetroRow?.petrotrade_volume || 0)),
      },
      margin: {
        avgCplPerSite:    marginRow?.avg_cpl_per_site != null ? round2(parseFloat(marginRow.avg_cpl_per_site)) : null,
        totalNetMargin:   round2(parseFloat(marginRow?.total_net_margin || 0)),
        totalInvVolume:   round2(parseFloat(marginRow?.total_inv_volume || 0)),
        sitesWithMargin:  parseInt(marginRow?.sites_with_margin || 0),
      },
      projection,
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
