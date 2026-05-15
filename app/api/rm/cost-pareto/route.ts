// app/api/rm/cost-pareto/route.ts
// Sorted descending Pareto over either categories or sites, with cumulative %.
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
      ? `SELECT s.site_code AS label_key, COALESCE(s.budget_name, s.site_code) AS label,
                SUM(i.net_cost)::NUMERIC AS cost
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE i.cost_center='retail'
            AND i.service_date >= $1::DATE AND i.service_date <= $2::DATE
            AND ($3::TEXT = '' OR i.site_code = $3)
            AND ($4::TEXT = '' OR t.tm_code = $4)
            AND ($5::TEXT = '' OR c.slug = $5)
          GROUP BY s.site_code, s.budget_name
          ORDER BY cost DESC NULLS LAST`
      : `SELECT COALESCE(c.slug, 'uncategorized') AS label_key,
                COALESCE(c.display_name, 'Uncategorized') AS label,
                SUM(i.net_cost)::NUMERIC AS cost
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories t ON s.territory_id = t.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE i.cost_center='retail'
            AND i.service_date >= $1::DATE AND i.service_date <= $2::DATE
            AND ($3::TEXT = '' OR i.site_code = $3)
            AND ($4::TEXT = '' OR t.tm_code = $4)
            AND ($5::TEXT = '' OR c.slug = $5)
          GROUP BY c.slug, c.display_name
          ORDER BY cost DESC NULLS LAST`;

    const rows = await query<{ label_key: string; label: string; cost: string }>(
      sql, [dateFrom, dateTo, siteCode, territory, category],
    );

    const items = rows.map(r => ({ labelKey: r.label_key, label: r.label, cost: parseFloat(r.cost) }));
    const total = items.reduce((a, b) => a + b.cost, 0);
    let running = 0;
    const data = items.map((it, i) => {
      running += it.cost;
      const cumPct = total > 0 ? +(running / total * 100).toFixed(1) : 0;
      // Tier 1: top contributors covering first 50%; 2: 50-80%; 3: 80-95%; 4: 95-100%
      const prevPct = total > 0 ? (running - it.cost) / total * 100 : 0;
      const tier = prevPct < 50 ? 1 : prevPct < 80 ? 2 : prevPct < 95 ? 3 : 4;
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
    console.error('/api/rm/cost-pareto error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
