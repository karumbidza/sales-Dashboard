// app/api/cost-analysis/matrix/route.ts
// Per-cell breakdown for the Cost Analysis site x category pivot table.
// Same CTE pattern as summary; aggregates by (site_code, category_slug)
// collapsing across periods within the filter window.
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
      SELECT cells.site_code,
             s.budget_name AS site_name,
             cells.category_slug,
             cells.category_name,
             SUM(cells.invoice_cost)::NUMERIC AS invoice_cost,
             SUM(cells.invoice_count)::INT    AS invoice_count,
             SUM(cells.ticket_count)::INT     AS ticket_count,
             CASE WHEN SUM(cells.ticket_count) > 0
                  THEN ROUND(SUM(cells.invoice_cost) / SUM(cells.ticket_count), 2)
                  ELSE NULL END               AS cost_per_ticket
        FROM cells
        JOIN sites s ON cells.site_code = s.site_code
       GROUP BY cells.site_code, s.budget_name, cells.category_slug, cells.category_name
       ORDER BY invoice_cost DESC NULLS LAST
       LIMIT 2000
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      data: rows.map(r => ({
        siteCode:        r.site_code,
        siteName:        r.site_name,
        categorySlug:    r.category_slug,
        categoryName:    r.category_name,
        invoiceCost:     parseFloat(r.invoice_cost),
        invoiceCount:    r.invoice_count,
        ticketCount:     r.ticket_count,
        costPerTicket:   r.cost_per_ticket != null ? parseFloat(r.cost_per_ticket) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/cost-analysis/matrix error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
