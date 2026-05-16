// app/api/rm/tickets-pareto/route.ts
// Sorted descending Pareto over either ticket categories or sites by ticket
// count, with cumulative %. Mirrors the cost-pareto response shape so the
// frontend chart can stay structurally identical to CostParetoChart — only
// the metric (count vs cost) and labels differ.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

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
    const dimension = (sp.get('dimension') || 'category').toLowerCase();
    const dimBySite = dimension === 'site';

    const sql = dimBySite
      ? `SELECT tk.site_code AS label_key,
                COALESCE(s.budget_name, tk.site_code) AS label,
                COUNT(*)::INT AS count
           FROM rm_helpdesk_tickets tk
           JOIN sites s ON tk.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
           LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE tk.created_time::DATE >= $1::DATE
            AND tk.created_time::DATE <= $2::DATE
            AND ($3::TEXT = '' OR tk.site_code = $3)
            AND ($4::TEXT = '' OR t.tm_code   = $4)
            AND ($5::TEXT = '' OR c.slug      = $5)
          GROUP BY tk.site_code, s.budget_name
          ORDER BY count DESC NULLS LAST`
      : `SELECT COALESCE(c.slug, 'uncategorized')        AS label_key,
                COALESCE(c.display_name, 'Uncategorized') AS label,
                COUNT(*)::INT                             AS count
           FROM rm_helpdesk_tickets tk
           JOIN sites s ON tk.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
           LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE tk.created_time::DATE >= $1::DATE
            AND tk.created_time::DATE <= $2::DATE
            AND ($3::TEXT = '' OR tk.site_code = $3)
            AND ($4::TEXT = '' OR t.tm_code   = $4)
            AND ($5::TEXT = '' OR c.slug      = $5)
          GROUP BY c.slug, c.display_name
          ORDER BY count DESC NULLS LAST`;

    const rows = await query<{ label_key: string; label: string; count: number }>(
      sql, [dateFrom, dateTo, siteCode, territory, category],
    );

    const items = rows.map(r => ({ labelKey: r.label_key, label: r.label, count: r.count }));
    const total = items.reduce((a, b) => a + b.count, 0);
    let running = 0;
    const data = items.map(it => {
      const prevPct = total > 0 ? (running / total) * 100 : 0;
      running += it.count;
      const cumPct = total > 0 ? +((running / total) * 100).toFixed(1) : 0;
      const tier   = prevPct < 50 ? 1 : prevPct < 80 ? 2 : prevPct < 95 ? 3 : 4;
      return { ...it, cumulativePct: cumPct, tier };
    });

    const nFor80 = data.findIndex(d => d.cumulativePct >= 80);
    const itemsTo80 = nFor80 === -1 ? data.length : nFor80 + 1;

    return NextResponse.json({
      data: {
        dimension: dimBySite ? 'site' : 'category',
        total,
        items: data,
        itemsTo80,
      },
    });
  } catch (err: any) {
    console.error('/api/rm/tickets-pareto error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
