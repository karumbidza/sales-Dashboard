// app/api/rm/kpis-cost/route.ts
// 4 Cost KPIs: YTD cost (vs LY + vs Budget), MTD cost (vs prior month + vs Budget),
// Cost per Litre (vs fleet median), Top Category (with % of total).
//
// All KPIs respect global filters: dateFrom, dateTo, territory, siteCode, category.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Filters {
  dateFrom:  string;
  dateTo:    string;
  territory: string;
  siteCode:  string;
  category:  string;
}

function parseFilters(req: NextRequest): Filters {
  const sp = req.nextUrl.searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getUTCFullYear();
  return {
    dateFrom:  sp.get('dateFrom') || `${year}-01-01`,
    dateTo:    sp.get('dateTo')   || today,
    territory: sp.get('territory') || '',
    siteCode:  sp.get('siteCode')  || '',
    category:  sp.get('category')  || '',
  };
}

function pctDelta(curr: number, prior: number): number | null {
  if (!prior || prior === 0) return null;
  return +(((curr - prior) / prior) * 100).toFixed(1);
}

export async function GET(req: NextRequest) {
  try {
    const f = parseFilters(req);

    // Derive date windows from period_end (dateTo) ----------
    const periodEnd  = new Date(f.dateTo + 'T00:00:00Z');
    const periodEndY = periodEnd.getUTCFullYear();
    const periodEndM = periodEnd.getUTCMonth();    // 0-indexed
    const periodEndD = periodEnd.getUTCDate();

    const yearStart  = `${periodEndY}-01-01`;
    const monthStart = `${periodEndY}-${String(periodEndM + 1).padStart(2, '0')}-01`;

    // Same-days-elapsed prior-year window (Jan 1 of prior year through periodEndY-1 with same M/D)
    const priorYearStart = `${periodEndY - 1}-01-01`;
    const priorYearEnd   = `${periodEndY - 1}-${String(periodEndM + 1).padStart(2, '0')}-${String(periodEndD).padStart(2, '0')}`;

    // Days into the current month and total days in the current month
    const daysElapsedInMonth = periodEndD;
    const daysInMonth = new Date(Date.UTC(periodEndY, periodEndM + 1, 0)).getUTCDate();

    // Prior-month same-days window
    const priorMonthY = periodEndM === 0 ? periodEndY - 1 : periodEndY;
    const priorMonthM = periodEndM === 0 ? 12 : periodEndM;  // 1-indexed for output
    const priorMonthStart = `${priorMonthY}-${String(priorMonthM).padStart(2, '0')}-01`;
    const priorMonthDaysIn = new Date(Date.UTC(priorMonthY, priorMonthM, 0)).getUTCDate();
    const priorMonthDay = Math.min(daysElapsedInMonth, priorMonthDaysIn);
    const priorMonthEnd = `${priorMonthY}-${String(priorMonthM).padStart(2, '0')}-${String(priorMonthDay).padStart(2, '0')}`;

    // Last complete month (for whole-month budget sum) — month BEFORE period_end's month
    const lastCompleteMonthStartY = priorMonthY;
    const lastCompleteMonthStartM = priorMonthM;
    const lastCompleteMonthEnd    = `${lastCompleteMonthStartY}-${String(lastCompleteMonthStartM).padStart(2, '0')}-01`;

    // Shared invoice filter clause + params
    // $1 = dateFrom (start of period for that KPI), $2 = dateTo (end), $3 = siteCode (or null), $4 = territory (or null), $5 = category (or null)
    const invoiceSumSQL = `
      SELECT COALESCE(SUM(i.net_cost), 0)::NUMERIC AS total
        FROM rm_invoices i
        JOIN sites s ON i.site_code = s.site_code
        LEFT JOIN territories t ON s.territory_id = t.id
        LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
        LEFT JOIN rm_categories c ON r.category_id = c.id
       WHERE i.cost_center = 'retail'
         AND i.service_date >= $1::DATE
         AND i.service_date <= $2::DATE
         AND ($3::TEXT = '' OR i.site_code = $3)
         AND ($4::TEXT = '' OR t.tm_code = $4)
         AND ($5::TEXT = '' OR c.slug = $5)
    `;

    // 1. YTD current
    const [ytdRow] = await query<{ total: string }>(invoiceSumSQL,
      [yearStart, f.dateTo, f.siteCode, f.territory, f.category]);
    const ytdCurrent = parseFloat(ytdRow.total);

    // 2. YTD prior year same-window
    const [ytdPriorRow] = await query<{ total: string }>(invoiceSumSQL,
      [priorYearStart, priorYearEnd, f.siteCode, f.territory, f.category]);
    const ytdPriorYear = parseFloat(ytdPriorRow.total);

    // 3. MTD current
    const [mtdRow] = await query<{ total: string }>(invoiceSumSQL,
      [monthStart, f.dateTo, f.siteCode, f.territory, f.category]);
    const mtdCurrent = parseFloat(mtdRow.total);

    // 4. MTD prior-month same-days
    const [mtdPriorRow] = await query<{ total: string }>(invoiceSumSQL,
      [priorMonthStart, priorMonthEnd, f.siteCode, f.territory, f.category]);
    const mtdPriorMonth = parseFloat(mtdPriorRow.total);

    // 5. YTD budget = sum of budget rows where budget_month BETWEEN year_start AND last_complete_month_start
    // (budget is fleet-wide — no category filter; if a site filter is set we narrow to that site)
    const [ytdBudgetRow] = await query<{ total: string }>(
      `SELECT COALESCE(SUM(budget_amount), 0)::NUMERIC AS total
         FROM rm_budget b
         JOIN sites s ON b.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
        WHERE b.budget_month >= $1::DATE
          AND b.budget_month <= $2::DATE
          AND ($3::TEXT = '' OR b.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)`,
      [yearStart, lastCompleteMonthEnd, f.siteCode, f.territory],
    );
    const ytdBudget = parseFloat(ytdBudgetRow.total);

    // 6. MTD budget pro-rated = (sum of budget for current month rows) * days_elapsed / days_in_month
    const [mtdBudgetMonthRow] = await query<{ total: string }>(
      `SELECT COALESCE(SUM(budget_amount), 0)::NUMERIC AS total
         FROM rm_budget b
         JOIN sites s ON b.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
        WHERE b.budget_month = $1::DATE
          AND ($2::TEXT = '' OR b.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)`,
      [monthStart, f.siteCode, f.territory],
    );
    const mtdBudgetFull = parseFloat(mtdBudgetMonthRow.total);
    const mtdBudget = mtdBudgetFull * daysElapsedInMonth / daysInMonth;

    // 7. Cost per Litre (YTD) and fleet median
    const [volumeRow] = await query<{ total: string }>(
      `SELECT COALESCE(SUM(s.total_volume), 0)::NUMERIC AS total
         FROM sales s
         JOIN sites si ON s.site_code = si.site_code
         LEFT JOIN territories t ON si.territory_id = t.id
        WHERE s.sale_date >= $1::DATE AND s.sale_date <= $2::DATE
          AND ($3::TEXT = '' OR s.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)`,
      [yearStart, f.dateTo, f.siteCode, f.territory],
    );
    const ytdVolume = parseFloat(volumeRow.total);
    const costPerLitre = ytdVolume > 0 ? ytdCurrent / ytdVolume : null;

    const perSiteRatios = await query<{ ratio: string }>(
      `SELECT (SUM(i.net_cost) / NULLIF(sa.volume, 0))::NUMERIC AS ratio
         FROM rm_invoices i
         JOIN sites s ON i.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         JOIN (
           SELECT site_code, SUM(total_volume) AS volume
             FROM sales
            WHERE sale_date >= $1::DATE AND sale_date <= $2::DATE
            GROUP BY site_code
         ) sa ON sa.site_code = i.site_code
        WHERE i.cost_center='retail'
          AND i.service_date >= $1::DATE AND i.service_date <= $2::DATE
          AND ($3::TEXT = '' OR t.tm_code = $3)
        GROUP BY i.site_code, sa.volume
       HAVING sa.volume > 0`,
      [yearStart, f.dateTo, f.territory],
    );
    const ratios = perSiteRatios
      .map(r => parseFloat(r.ratio))
      .filter(n => !isNaN(n) && isFinite(n))
      .sort((a, b) => a - b);
    const fleetMedian = ratios.length > 0
      ? (ratios.length % 2 === 1
          ? ratios[Math.floor(ratios.length / 2)]
          : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2)
      : null;

    // 8. Top category (YTD)
    const topCats = await query<{ slug: string; display_name: string; total: string }>(
      `SELECT c.slug, c.display_name, SUM(i.net_cost)::NUMERIC AS total
         FROM rm_invoices i
         JOIN sites s ON i.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE i.cost_center='retail'
          AND i.service_date >= $1::DATE AND i.service_date <= $2::DATE
          AND ($3::TEXT = '' OR i.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND c.slug IS NOT NULL
        GROUP BY c.slug, c.display_name
        ORDER BY total DESC NULLS LAST
        LIMIT 1`,
      [yearStart, f.dateTo, f.siteCode, f.territory],
    );
    const topCat = topCats[0];
    const topCategory = topCat
      ? {
          displayName: topCat.display_name,
          total: parseFloat(topCat.total),
          pctOfTotal: ytdCurrent > 0 ? +(parseFloat(topCat.total) / ytdCurrent * 100).toFixed(1) : null,
        }
      : null;

    return NextResponse.json({
      data: {
        ytd: {
          current:        ytdCurrent,
          priorYear:      ytdPriorYear,
          deltaPctLY:     pctDelta(ytdCurrent, ytdPriorYear),
          budget:         ytdBudget,
          deltaPctBudget: pctDelta(ytdCurrent, ytdBudget),
        },
        mtd: {
          current:        mtdCurrent,
          priorMonth:     mtdPriorMonth,
          deltaPctMoM:    pctDelta(mtdCurrent, mtdPriorMonth),
          budget:         mtdBudget,
          deltaPctBudget: pctDelta(mtdCurrent, mtdBudget),
        },
        costPerLitre: {
          current:     costPerLitre,
          fleetMedian: fleetMedian,
        },
        topCategory,
      },
    });
  } catch (err: any) {
    console.error('/api/rm/kpis-cost error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
