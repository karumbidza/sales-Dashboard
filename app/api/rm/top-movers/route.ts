// app/api/rm/top-movers/route.ts
// Sites with the largest period-over-period R&M cost deltas.
// "Prior period" = same length as the current period, immediately before it.
// Returns top 3 rising and top 3 falling.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Row {
  site_code: string;
  site_name: string;
  current_cost: string;
  prior_cost:   string;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const year  = new Date().getUTCFullYear();
    const dateFrom = sp.get('dateFrom') || `${year}-01-01`;
    const dateTo   = sp.get('dateTo')   || today;
    const territory = sp.get('territory') || '';
    const siteCode  = sp.get('siteCode')  || '';
    const category  = sp.get('category')  || '';

    // Compute prior-period window: same length immediately before current.
    const start = new Date(dateFrom + 'T00:00:00Z');
    const end   = new Date(dateTo   + 'T00:00:00Z');
    const lengthDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    const priorEnd   = new Date(start.getTime() - 86_400_000);                       // day before current start
    const priorStart = new Date(priorEnd.getTime() - lengthDays * 86_400_000);       // shift by length
    const priorFrom  = priorStart.toISOString().slice(0, 10);
    const priorTo    = priorEnd.toISOString().slice(0, 10);

    // One CTE per period, FULL JOIN on site so we don't lose sites that
    // only existed in one of the two windows.
    const rows = await query<Row>(
      `WITH curr AS (
         SELECT i.site_code, SUM(i.net_cost)::NUMERIC AS cost
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE i.cost_center='retail'
            AND i.service_date >= $1::DATE AND i.service_date <= $2::DATE
            AND ($5::TEXT = '' OR i.site_code = $5)
            AND ($6::TEXT = '' OR t.tm_code   = $6)
            AND ($7::TEXT = '' OR c.slug      = $7)
          GROUP BY i.site_code
       ),
       prev AS (
         SELECT i.site_code, SUM(i.net_cost)::NUMERIC AS cost
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE i.cost_center='retail'
            AND i.service_date >= $3::DATE AND i.service_date <= $4::DATE
            AND ($5::TEXT = '' OR i.site_code = $5)
            AND ($6::TEXT = '' OR t.tm_code   = $6)
            AND ($7::TEXT = '' OR c.slug      = $7)
          GROUP BY i.site_code
       )
       SELECT COALESCE(curr.site_code, prev.site_code)              AS site_code,
              s.budget_name                                          AS site_name,
              COALESCE(curr.cost, 0)::NUMERIC                        AS current_cost,
              COALESCE(prev.cost, 0)::NUMERIC                        AS prior_cost
         FROM curr
         FULL OUTER JOIN prev ON curr.site_code = prev.site_code
         JOIN sites s ON COALESCE(curr.site_code, prev.site_code) = s.site_code`,
      [dateFrom, dateTo, priorFrom, priorTo, siteCode, territory, category],
    );

    const enriched = rows.map(r => {
      const current = parseFloat(r.current_cost);
      const prior   = parseFloat(r.prior_cost);
      return {
        siteCode:    r.site_code,
        siteName:    r.site_name,
        currentCost: current,
        priorCost:   prior,
        delta:       +(current - prior).toFixed(2),
      };
    });

    const rising  = [...enriched].sort((a, b) => b.delta - a.delta).slice(0, 3);
    const falling = [...enriched].sort((a, b) => a.delta - b.delta).slice(0, 3);

    return NextResponse.json({
      data: {
        rising,
        falling,
        currentWindow: { dateFrom, dateTo },
        priorWindow:   { dateFrom: priorFrom, dateTo: priorTo },
      },
    });
  } catch (err: any) {
    console.error('/api/rm/top-movers error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
