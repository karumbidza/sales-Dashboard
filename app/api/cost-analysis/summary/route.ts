// app/api/cost-analysis/summary/route.ts
// Rolls up invoice + ticket data into KPI numbers for the Cost Analysis page.
// Shared CTE pattern with the matrix endpoint: FULL OUTER JOIN over
// (site, category, period) aggregates. Filters apply uniformly to both
// source tables so the comparison stays apples-to-apples in the date window.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface F {
  dateFrom?: string;
  dateTo?:   string;
  category?: string;
  siteCode?: string;
}

function readFilters(req: NextRequest): F {
  const sp = req.nextUrl.searchParams;
  return {
    dateFrom: sp.get('dateFrom') || undefined,
    dateTo:   sp.get('dateTo')   || undefined,
    category: sp.get('category') || undefined,
    siteCode: sp.get('siteCode') || undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    const f = readFilters(req);

    const ic: string[] = [`i.cost_center = 'retail'`];
    const tc: string[] = [`1=1`];
    const params: any[] = [];
    let p = 1;

    if (f.dateFrom) { ic.push(`i.service_date >= $${p}`); tc.push(`t.created_time::DATE >= $${p}`); params.push(f.dateFrom); p++; }
    if (f.dateTo)   { ic.push(`i.service_date <= $${p}`); tc.push(`t.created_time::DATE <= $${p}`); params.push(f.dateTo);   p++; }
    if (f.category) { ic.push(`c.slug = $${p}`);          tc.push(`c.slug = $${p}`);                params.push(f.category); p++; }
    if (f.siteCode) { ic.push(`i.site_code = $${p}`);     tc.push(`t.site_code = $${p}`);           params.push(f.siteCode); p++; }

    const sql = `
      WITH invoice_agg AS (
        SELECT i.site_code,
               c.slug AS category_slug,
               c.display_name AS category_name,
               DATE_TRUNC('month', i.service_date)::DATE AS period,
               SUM(i.net_cost)::NUMERIC AS invoice_cost,
               COUNT(*)::INT AS invoice_count
          FROM rm_invoices i
          LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
         WHERE ${ic.join(' AND ')}
         GROUP BY 1, 2, 3, 4
      ),
      ticket_agg AS (
        SELECT t.site_code,
               c.slug AS category_slug,
               c.display_name AS category_name,
               DATE_TRUNC('month', t.created_time)::DATE AS period,
               COUNT(*)::INT AS ticket_count
          FROM rm_helpdesk_tickets t
          LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
         WHERE ${tc.join(' AND ')}
         GROUP BY 1, 2, 3, 4
      ),
      cells AS (
        SELECT COALESCE(i.site_code, t.site_code)         AS site_code,
               COALESCE(i.category_slug, t.category_slug) AS category_slug,
               COALESCE(i.category_name, t.category_name) AS category_name,
               COALESCE(i.invoice_cost, 0)                AS invoice_cost,
               COALESCE(i.invoice_count, 0)               AS invoice_count,
               COALESCE(t.ticket_count, 0)                AS ticket_count
          FROM invoice_agg i
          FULL OUTER JOIN ticket_agg t
            ON i.site_code = t.site_code
           AND i.category_slug = t.category_slug
           AND i.period = t.period
      )
      SELECT
        SUM(invoice_cost)::NUMERIC                                AS total_invoice_cost,
        SUM(invoice_count)::INT                                   AS total_invoices,
        SUM(ticket_count)::INT                                    AS total_tickets,
        CASE WHEN SUM(ticket_count) > 0
             THEN ROUND(SUM(invoice_cost) / SUM(ticket_count), 2)
             ELSE NULL END                                        AS overall_cost_per_ticket,
        COUNT(DISTINCT site_code) FILTER (WHERE ticket_count > 0)::INT AS sites_with_tickets,
        COUNT(DISTINCT site_code) FILTER (WHERE invoice_cost > 0)::INT AS sites_with_invoices,
        COUNT(DISTINCT site_code) FILTER (
          WHERE ticket_count > 0 AND invoice_cost > 0
        )::INT                                                          AS sites_with_both
      FROM cells
    `;

    const rows = await query<any>(sql, params);
    const r = rows[0] || {};

    // Top category by spend — separate small query that uses the same `ic`
    // clauses (and therefore the same params array — every $N position
    // matches because the params were pushed in clause-build order).
    const topRows = await query<any>(
      `SELECT c.slug, c.display_name, SUM(i.net_cost) AS total_cost
         FROM rm_invoices i
         LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${ic.join(' AND ')}
        GROUP BY c.slug, c.display_name
       HAVING SUM(i.net_cost) > 0
        ORDER BY SUM(i.net_cost) DESC
        LIMIT 1`,
      params,
    );

    return NextResponse.json({
      data: {
        totalInvoiceCost:     parseFloat(r.total_invoice_cost || '0'),
        totalInvoices:        r.total_invoices ?? 0,
        totalTickets:         r.total_tickets ?? 0,
        overallCostPerTicket: r.overall_cost_per_ticket != null ? parseFloat(r.overall_cost_per_ticket) : null,
        sitesWithTickets:     r.sites_with_tickets ?? 0,
        sitesWithInvoices:    r.sites_with_invoices ?? 0,
        sitesWithBoth:        r.sites_with_both ?? 0,
        topSpendCategory:     topRows[0]?.display_name ?? null,
        topSpendCategorySlug: topRows[0]?.slug ?? null,
        topSpendCategoryCost: topRows[0]?.total_cost ? parseFloat(topRows[0].total_cost) : 0,
      },
    });
  } catch (err: any) {
    console.error('/api/cost-analysis/summary error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
