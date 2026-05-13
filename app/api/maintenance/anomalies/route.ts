// app/api/maintenance/anomalies/route.ts
// Two flavors of anomalies:
//   (a) Invoice outliers: net_cost > mean + 2*stddev within (site, category)
//       — only flagged when ≥5 historical data points exist for that pair.
//   (b) Site-month spikes: a site's monthly net_cost > mean + 2*stddev over
//       its trailing-12-month history.

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom');
    const dateTo   = sp.get('dateTo');
    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
    }

    // (a) Invoice outliers within the requested date range.
    const outliers = await query<any>(
      `WITH historical AS (
         SELECT i.site_code, r.category_id,
                AVG(i.net_cost)    AS mean,
                STDDEV_SAMP(i.net_cost) AS sd,
                COUNT(*)            AS n
           FROM rm_invoices i
           JOIN rm_description_categories r ON i.description_norm = r.description_norm
          WHERE i.cost_center = 'retail'
          GROUP BY i.site_code, r.category_id
       )
       SELECT i.entry_no, i.site_code, si.budget_name AS site_name,
              i.service_date, i.description, i.net_cost,
              c.slug AS category_slug, c.display_name AS category_name,
              h.mean, h.sd
         FROM rm_invoices i
         JOIN sites si             ON i.site_code = si.site_code
         JOIN rm_description_categories r ON i.description_norm = r.description_norm
         JOIN rm_categories c       ON r.category_id = c.id
         JOIN historical h          ON h.site_code = i.site_code AND h.category_id = r.category_id
        WHERE i.cost_center = 'retail'
          AND i.service_date BETWEEN $1 AND $2
          AND h.n >= 5
          AND h.sd IS NOT NULL AND h.sd > 0
          AND i.net_cost > h.mean + 2 * h.sd
        ORDER BY i.net_cost DESC
        LIMIT 100`,
      [dateFrom, dateTo],
    );

    // (b) Site-month spikes: compare the month's total against the site's trailing-12-month mean.
    const spikes = await query<any>(
      `WITH monthly AS (
         SELECT i.site_code,
                DATE_TRUNC('month', i.service_date)::DATE AS month,
                SUM(i.net_cost) AS m_total
           FROM rm_invoices i
          WHERE i.cost_center = 'retail'
          GROUP BY i.site_code, DATE_TRUNC('month', i.service_date)
       ),
       windowed AS (
         SELECT site_code, month, m_total,
                AVG(m_total) OVER w  AS mean_12,
                STDDEV_SAMP(m_total) OVER w AS sd_12,
                COUNT(*)    OVER w  AS n_12
           FROM monthly
         WINDOW w AS (
           PARTITION BY site_code
           ORDER BY month
           ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
         )
       )
       SELECT w.site_code, si.budget_name AS site_name, w.month, w.m_total,
              w.mean_12, w.sd_12
         FROM windowed w
         JOIN sites si ON w.site_code = si.site_code
        WHERE w.month >= DATE_TRUNC('month', $1::DATE)
          AND w.month <= DATE_TRUNC('month', $2::DATE)
          AND w.n_12 >= 5
          AND w.sd_12 IS NOT NULL AND w.sd_12 > 0
          AND w.m_total > w.mean_12 + 2 * w.sd_12
        ORDER BY w.m_total DESC
        LIMIT 50`,
      [dateFrom, dateTo],
    );

    return NextResponse.json({
      outliers: outliers.map(r => ({
        entryNo:        Number(r.entry_no),
        siteCode:       r.site_code,
        siteName:       r.site_name,
        serviceDate:    r.service_date,
        description:    r.description,
        netCost:        parseFloat(r.net_cost),
        categorySlug:   r.category_slug,
        categoryName:   r.category_name,
        baselineMean:   parseFloat(r.mean),
        baselineStddev: parseFloat(r.sd),
      })),
      siteMonthSpikes: spikes.map(r => ({
        siteCode:    r.site_code,
        siteName:    r.site_name,
        month:       r.month,
        monthTotal:  parseFloat(r.m_total),
        baselineMean: parseFloat(r.mean_12),
        baselineStddev: parseFloat(r.sd_12),
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/anomalies error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
