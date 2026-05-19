// app/api/rm/territory-snapshot/route.ts
// MTD spend by Territory Manager + YoY delta + relative bar width.
// Used by Page 1 of the R&M print report.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = sp.get('dateFrom') || today;
    const dateTo   = sp.get('dateTo')   || today;
    // siteCode/category filters intentionally ignored: this strip
    // shows territory-level rollup. Territory filter, if present,
    // would degenerate to a single-row report so we ignore it too.

    const rows = await query<{
      tm_name:        string;
      mtd_spend:      string;
      yoy_pct:        string | null;
      bar_pct_of_max: number | null;
    }>(
      `WITH current AS (
         SELECT COALESCE(t.tm_name, 'UNASSIGNED') AS tm_name,
                SUM(i.net_cost)::NUMERIC AS mtd_spend
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
          WHERE i.cost_center = 'retail'
            AND i.service_date BETWEEN $1::DATE AND $2::DATE
          GROUP BY COALESCE(t.tm_name, 'UNASSIGNED')
       ),
       prior AS (
         SELECT COALESCE(t.tm_name, 'UNASSIGNED') AS tm_name,
                SUM(i.net_cost)::NUMERIC AS prior_spend
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
          WHERE i.cost_center = 'retail'
            AND i.service_date BETWEEN $1::DATE - INTERVAL '1 year'
                                   AND $2::DATE - INTERVAL '1 year'
          GROUP BY COALESCE(t.tm_name, 'UNASSIGNED')
       ),
       max_spend AS (SELECT MAX(mtd_spend) AS m FROM current)
       SELECT
         c.tm_name,
         c.mtd_spend,
         CASE
           WHEN p.prior_spend IS NULL OR p.prior_spend = 0 THEN NULL
           ELSE ROUND(((c.mtd_spend - p.prior_spend) / p.prior_spend) * 100, 1)
         END AS yoy_pct,
         CASE
           WHEN m.m IS NULL OR m.m = 0 THEN NULL
           ELSE ROUND((c.mtd_spend / m.m) * 100)::int
         END AS bar_pct_of_max
       FROM current c
       LEFT JOIN prior p USING (tm_name)
       CROSS JOIN max_spend m
       ORDER BY c.mtd_spend DESC NULLS LAST`,
      [dateFrom, dateTo],
    );

    const snapshot = rows.map(r => ({
      tmName:       r.tm_name,
      mtdSpend:     parseFloat(r.mtd_spend),
      yoyPct:       r.yoy_pct === null ? null : parseFloat(r.yoy_pct),
      barPctOfMax:  r.bar_pct_of_max ?? 0,
    }));

    return NextResponse.json({ data: { snapshot } });
  } catch (err: any) {
    console.error('/api/rm/territory-snapshot error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
