// app/api/rm/cost-heatmap/route.ts
// Site × Category matrix: cost, ticket count, z-score per cell.
// Sites ranked by total cost desc; categories ranked by total cost desc.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface CellRaw {
  site_code:     string;
  site_name:     string;
  category_slug: string | null;
  category_name: string | null;
  cost:          string;
  invoice_count: number;
  ticket_count:  number;
  volume:        string | null;
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
    const dimension = (sp.get('dimension') || 'cost') === 'tickets' ? 'tickets' : 'cost';

    const rows = await query<CellRaw>(
      `WITH inv AS (
         SELECT i.site_code,
                COALESCE(c.slug, 'uncategorized')           AS category_slug,
                COALESCE(c.display_name, 'Uncategorized')   AS category_name,
                SUM(i.net_cost)::NUMERIC                    AS cost,
                COUNT(*)::INT                               AS invoice_count
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE i.cost_center='retail'
            AND i.service_date >= $1::DATE
            AND i.service_date <= $2::DATE
            AND ($3::TEXT = '' OR i.site_code = $3)
            AND ($4::TEXT = '' OR t.tm_code  = $4)
            AND ($5::TEXT = '' OR c.slug     = $5)
          GROUP BY 1, 2, 3
       ),
       tkt AS (
         SELECT tk.site_code,
                COALESCE(c.slug, 'uncategorized') AS category_slug,
                COUNT(*)::INT                     AS ticket_count
           FROM rm_helpdesk_tickets_active tk
           JOIN sites s ON tk.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
           LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE tk.created_time::DATE >= $1::DATE
            AND tk.created_time::DATE <= $2::DATE
            AND ($3::TEXT = '' OR tk.site_code = $3)
            AND ($4::TEXT = '' OR t.tm_code   = $4)
            AND ($5::TEXT = '' OR c.slug      = $5)
          GROUP BY 1, 2
       ),
       vol AS (
         SELECT site_code, SUM(total_volume)::NUMERIC AS volume
           FROM sales
          WHERE sale_date >= $1::DATE AND sale_date <= $2::DATE
            AND ($3::TEXT = '' OR site_code = $3)
          GROUP BY 1
       )
       SELECT inv.site_code,
              s.budget_name                                 AS site_name,
              inv.category_slug,
              inv.category_name,
              inv.cost,
              inv.invoice_count,
              COALESCE(tkt.ticket_count, 0)::INT            AS ticket_count,
              vol.volume
         FROM inv
         JOIN sites s ON inv.site_code = s.site_code
         LEFT JOIN tkt ON tkt.site_code = inv.site_code AND tkt.category_slug = inv.category_slug
         LEFT JOIN vol ON vol.site_code = inv.site_code
        ORDER BY inv.cost DESC NULLS LAST`,
      [dateFrom, dateTo, siteCode, territory, category],
    );

    // Pure ticket-driven per-site × category breakdown — independent of
    // invoices. This is the source of truth for the Ticket heatmap's
    // Category view; the invoice-driven matrix above stays the source of
    // truth for the Cost heatmap. Decoupling them lets tickets that have
    // no matching invoice in the window still appear.
    const ticketCatRows = await query<{ site_code: string; site_name: string; category_slug: string; category_name: string; ticket_count: number }>(
      `SELECT tk.site_code,
              s.budget_name                              AS site_name,
              COALESCE(c.slug, 'uncategorized')          AS category_slug,
              COALESCE(c.display_name, 'Uncategorized')  AS category_name,
              COUNT(*)::INT                              AS ticket_count
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <= $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code   = $4)
          AND ($5::TEXT = '' OR c.slug      = $5)
        GROUP BY 1, 2, 3, 4`,
      [dateFrom, dateTo, siteCode, territory, category],
    );

    // Per-site status breakdown — same window/filters as the ticket count in
    // the matrix, but sliced by ticket status instead of category. Includes
    // closed/resolved tickets so per-site status totals tie out to the
    // category-view row total.
    const statusRows = await query<{ site_code: string; status: string; ticket_count: number }>(
      `SELECT tk.site_code,
              COALESCE(NULLIF(tk.status, ''), 'Unspecified') AS status,
              COUNT(*)::INT                                  AS ticket_count
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <= $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code   = $4)
          AND ($5::TEXT = '' OR c.slug      = $5)
        GROUP BY 1, 2`,
      [dateFrom, dateTo, siteCode, territory, category],
    );

    // Build site totals and category totals for ordering
    const siteTotals = new Map<string, { siteCode: string; siteName: string; volume: number; total: number; tickets: number }>();
    const catTotals  = new Map<string, { slug: string; name: string; total: number }>();
    for (const r of rows) {
      const cost = parseFloat(r.cost);
      const vol  = r.volume ? parseFloat(r.volume) : 0;
      const tcnt = r.ticket_count || 0;
      const sEntry = siteTotals.get(r.site_code) || {
        siteCode: r.site_code, siteName: r.site_name, volume: vol, total: 0, tickets: 0,
      };
      sEntry.total   += cost;
      sEntry.tickets += tcnt;
      sEntry.volume   = vol;
      siteTotals.set(r.site_code, sEntry);

      const catKey = r.category_slug || 'uncategorized';
      const cEntry = catTotals.get(catKey) || { slug: catKey, name: r.category_name || 'Uncategorized', total: 0 };
      cEntry.total += cost;
      catTotals.set(catKey, cEntry);
    }

    const sites = Array.from(siteTotals.values()).sort((a, b) =>
      dimension === 'tickets'
        ? b.tickets - a.tickets
        : b.total - a.total
    );
    const categories = Array.from(catTotals.values()).sort((a, b) => b.total - a.total);

    // Compute per-category mean and stddev for z-score
    const catStats: Record<string, { mean: number; std: number }> = {};
    for (const cat of categories) {
      const values: number[] = [];
      for (const s of sites) {
        const row = rows.find(r => r.site_code === s.siteCode && (r.category_slug || 'uncategorized') === cat.slug);
        if (row) values.push(parseFloat(row.cost));
      }
      if (values.length < 2) { catStats[cat.slug] = { mean: 0, std: 0 }; continue; }
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
      catStats[cat.slug] = { mean, std: Math.sqrt(variance) };
    }

    // Build matrix
    const matrix: Record<string, Record<string, { cost: number; perLitre: number | null; zScore: number | null; ticketCount: number; invoiceCount: number; anomaly: 0 | 1 | 2 }>> = {};
    for (const s of sites) {
      matrix[s.siteCode] = {};
      for (const c of categories) {
        const row = rows.find(r => r.site_code === s.siteCode && (r.category_slug || 'uncategorized') === c.slug);
        if (!row) continue;
        const cost = parseFloat(row.cost);
        const perLitre = s.volume > 0 ? cost / s.volume : null;
        const stats = catStats[c.slug];
        const z = stats.std > 0 ? +((cost - stats.mean) / stats.std).toFixed(2) : null;
        let anomaly: 0 | 1 | 2 = 0;
        if (z !== null && z > 2) anomaly = row.ticket_count === 0 ? 2 : 1;
        matrix[s.siteCode][c.slug] = {
          cost,
          perLitre,
          zScore: z,
          ticketCount: row.ticket_count,
          invoiceCount: row.invoice_count,
          anomaly,
        };
      }
    }

    // byStatus: per-site map of status → count, plus an ordered list of
    // statuses present in the window (so the client can render columns
    // without hard-coding an enum). Order mirrors the aging-chart palette
    // so the most actionable buckets appear left.
    const STATUS_ORDER = [
      'Open',
      'Pending',
      'Waiting on Customer',
      'Waiting on Third Party',
      'In Progress',
      'Resolved',
      'Closed',
      'Unspecified',
    ];
    const byStatus: Record<string, Record<string, number>> = {};
    const statusSeen = new Set<string>();
    for (const r of statusRows) {
      const st = r.status || 'Unspecified';
      statusSeen.add(st);
      if (!byStatus[r.site_code]) byStatus[r.site_code] = {};
      byStatus[r.site_code][st] = (byStatus[r.site_code][st] || 0) + r.ticket_count;
    }
    const statuses = Array.from(statusSeen).sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a);
      const bi = STATUS_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    // Ticket-driven category list + matrix + site list, independent of
    // invoices. ticketSites includes any site with at least one ticket in
    // the window, ranked by ticket count — sites with tickets but zero
    // invoices appear here even though they wouldn't appear in `sites`.
    const ticketCatTotals  = new Map<string, { slug: string; name: string; total: number }>();
    const ticketSiteTotals = new Map<string, { siteCode: string; siteName: string; total: number }>();
    const ticketMatrix: Record<string, Record<string, number>> = {};
    for (const r of ticketCatRows) {
      const slug = r.category_slug || 'uncategorized';
      const name = r.category_name || 'Uncategorized';
      const e    = ticketCatTotals.get(slug) || { slug, name, total: 0 };
      e.total += r.ticket_count;
      ticketCatTotals.set(slug, e);

      const se = ticketSiteTotals.get(r.site_code) || {
        siteCode: r.site_code, siteName: r.site_name, total: 0,
      };
      se.total += r.ticket_count;
      ticketSiteTotals.set(r.site_code, se);

      if (!ticketMatrix[r.site_code]) ticketMatrix[r.site_code] = {};
      ticketMatrix[r.site_code][slug] = (ticketMatrix[r.site_code][slug] || 0) + r.ticket_count;
    }
    const ticketCategories = Array.from(ticketCatTotals.values()).sort((a, b) => b.total - a.total);
    const ticketSites      = Array.from(ticketSiteTotals.values()).sort((a, b) => b.total - a.total);

    return NextResponse.json({
      data: {
        sites:      sites.map(s => ({ siteCode: s.siteCode, siteName: s.siteName, total: s.total, volume: s.volume })),
        categories: categories.map(c => ({ slug: c.slug, name: c.name, total: c.total })),
        matrix,
        statuses,
        byStatus,
        ticketCategories,
        ticketMatrix,
        ticketSites,
      },
    });
  } catch (err: any) {
    console.error('/api/rm/cost-heatmap error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
