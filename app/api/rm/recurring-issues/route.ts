// app/api/rm/recurring-issues/route.ts
// Top recurring helpdesk problems by normalized subject in last 90 days.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const periodEnd = new Date((sp.get('dateTo') || today) + 'T00:00:00Z');
    const ninetyAgo = new Date(periodEnd.getTime() - 90 * 86400000).toISOString().slice(0, 10);

    const territory = sp.get('territory') || '';
    const siteCode  = sp.get('siteCode')  || '';
    const category  = sp.get('category')  || '';
    const limit     = Math.min(parseInt(sp.get('limit') || '4', 10), 20);

    const rows = await query<{
      description_norm: string;
      sample_subject:   string | null;
      total:            string;
      site_count:       string;
      category_name:    string | null;
    }>(
      `SELECT tk.description_norm,
              MIN(tk.subject)                                 AS sample_subject,
              COUNT(*)::INT                                   AS total,
              COUNT(DISTINCT tk.site_code)::INT               AS site_count,
              c.display_name                                  AS category_name
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <= $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)
          AND tk.description_norm IS NOT NULL
          AND tk.description_norm <> ''
        GROUP BY tk.description_norm, c.display_name
       HAVING COUNT(*) >= 3
        ORDER BY total DESC, site_count DESC
        LIMIT $6`,
      [ninetyAgo, today, siteCode, territory, category, limit],
    );

    return NextResponse.json({
      data: rows.map(r => ({
        descriptionNorm: r.description_norm,
        sampleSubject:   r.sample_subject,
        count:           parseInt(r.total, 10),
        siteCount:       parseInt(r.site_count, 10),
        categoryName:    r.category_name,
      })),
    });
  } catch (err: any) {
    console.error('/api/rm/recurring-issues error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
