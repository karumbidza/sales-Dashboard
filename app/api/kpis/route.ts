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

    // Determine reference dates
    const today = filters.dateTo ? new Date(filters.dateTo) : new Date();
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

    // Build the joins / filter
    const baseJoins = `
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;

    // ── MTD ACTUAL ──────────────────────────────────────────────────────────
    const mtdFilters = buildSalesFilters({ ...filters, dateFrom: mtdFrom, dateTo: filters.dateTo || today.toISOString().split('T')[0] });
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
    const ytdFilters = buildSalesFilters({ ...filters, dateFrom: ytdFrom, dateTo: filters.dateTo || today.toISOString().split('T')[0] });
    const ytdRow = await queryOne<any>(`
      SELECT COALESCE(SUM(${volExpr}), 0) AS volume, COALESCE(SUM(${revExpr}), 0) AS revenue
      ${baseJoins}
      ${ytdFilters.where}
    `, ytdFilters.params);

    // ── PRIOR PERIOD MTD (for growth) ────────────────────────────────────────
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

    // ── BUDGET (MTD) ─────────────────────────────────────────────────────────
    const budgetParams: any[] = [mtdFrom];
    let budgetTerritoryClause = '';
    if (filters.territory) {
      budgetParams.push(filters.territory.toUpperCase());
      budgetTerritoryClause = `AND t.tm_code = $${budgetParams.length}`;
    }
    if (filters.siteCode) {
      budgetParams.push(filters.siteCode);
      budgetTerritoryClause += ` AND vb.site_code = $${budgetParams.length}`;
    }
    const budgetRow = await queryOne<any>(`
      SELECT
        COALESCE(SUM(vb.budget_volume), 0)  AS budget_volume,
        COALESCE(SUM(vb.stretch_volume), 0) AS stretch_volume
      FROM volume_budget vb
      JOIN sites si ON vb.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE DATE_TRUNC('month', vb.budget_month) = DATE_TRUNC('month', $1::DATE)
      ${budgetTerritoryClause}
    `, budgetParams);

    // ── YTD BUDGET ──────────────────────────────────────────────────────────
    const ytdBudgetParams: any[] = [ytdFrom, filters.dateTo || today.toISOString().split('T')[0]];
    let ytdBudgetTerritory = '';
    if (filters.territory) {
      ytdBudgetParams.push(filters.territory.toUpperCase());
      ytdBudgetTerritory = `AND t.tm_code = $${ytdBudgetParams.length}`;
    }
    const ytdBudgetRow = await queryOne<any>(`
      SELECT COALESCE(SUM(vb.budget_volume), 0) AS budget_volume
      FROM volume_budget vb
      JOIN sites si ON vb.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE vb.budget_month >= DATE_TRUNC('month', $1::DATE)
        AND vb.budget_month <= DATE_TRUNC('month', $2::DATE)
      ${ytdBudgetTerritory}
    `, ytdBudgetParams);

    // ── PETROTRADE CONTRIBUTION ──────────────────────────────────────────────
    const petroRow = await queryOne<any>(`
      SELECT COALESCE(SUM(pt.volume_litres), 0) AS petrotrade_volume,
             COALESCE(SUM(pt.gross_margin), 0)  AS petrotrade_margin
      FROM petrotrade_sales pt
      JOIN sites si ON pt.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE pt.sale_date >= $1 AND pt.sale_date <= $2
      ${filters.territory ? `AND t.tm_code = $3` : ''}
    `, [mtdFrom, filters.dateTo || today.toISOString().split('T')[0], ...(filters.territory ? [filters.territory.toUpperCase()] : [])]);

    // ── ASSEMBLE ─────────────────────────────────────────────────────────────
    const mtdVolume    = parseFloat(mtdRow?.volume   || 0);
    const ytdVolume    = parseFloat(ytdRow?.volume   || 0);
    const priorMtd     = parseFloat(priorMtdRow?.volume || 0);
    const priorYtd     = parseFloat(priorYtdRow?.volume || 0);
    const mtdBudget    = parseFloat(budgetRow?.budget_volume  || 0);
    const mtdStretch   = parseFloat(budgetRow?.stretch_volume || 0);
    const ytdBudget    = parseFloat(ytdBudgetRow?.budget_volume || 0);

    const growthPct    = priorMtd > 0 ? ((mtdVolume - priorMtd) / priorMtd) * 100 : null;
    const ytdGrowthPct = priorYtd > 0 ? ((ytdVolume - priorYtd) / priorYtd) * 100 : null;
    const vsBudgetPct  = mtdBudget > 0 ? (mtdVolume / mtdBudget) * 100 : null;
    const vsStretchPct = mtdStretch > 0 ? (mtdVolume / mtdStretch) * 100 : null;
    const ytdVsBudget  = ytdBudget > 0 ? (ytdVolume / ytdBudget) * 100 : null;

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
        vsBudgetPct:  ytdVsBudget ? round2(ytdVsBudget) : null,
      },
      budget: {
        mtdBudget:    round2(mtdBudget),
        mtdStretch:   round2(mtdStretch),
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
      asOf: today.toISOString().split('T')[0],
    });

  } catch (err: any) {
    console.error('/api/kpis error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function round4(n: number) { return Math.round(n * 10000) / 10000; }
