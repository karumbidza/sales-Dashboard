// app/api/rm/ticket-aging/route.ts
// Open-ticket aging buckets: 0-30, 31-60, 61-90, 90+ days, broken down by priority.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const territory = sp.get('territory') || '';
    const siteCode  = sp.get('siteCode')  || '';
    const category  = sp.get('category')  || '';

    const rows = await query<{ priority: string | null; days: number }>(
      `SELECT COALESCE(tk.priority, 'Unspecified') AS priority,
              (CURRENT_DATE - tk.created_time::DATE)::INT AS days
         FROM rm_helpdesk_tickets tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status NOT IN ('Closed', 'Resolved')
          AND ($1::TEXT = '' OR tk.site_code = $1)
          AND ($2::TEXT = '' OR t.tm_code = $2)
          AND ($3::TEXT = '' OR c.slug = $3)`,
      [siteCode, territory, category],
    );

    const buckets = [
      { bucket: '0-30',  min: 0,  max: 30 },
      { bucket: '31-60', min: 31, max: 60 },
      { bucket: '61-90', min: 61, max: 90 },
      { bucket: '90+',   min: 91, max: Number.POSITIVE_INFINITY },
    ];

    const result = buckets.map(b => {
      const inBucket = rows.filter(r => r.days >= b.min && r.days <= b.max);
      const byPriority: Record<string, number> = {};
      for (const r of inBucket) {
        byPriority[r.priority || 'Unspecified'] = (byPriority[r.priority || 'Unspecified'] || 0) + 1;
      }
      return { bucket: b.bucket, count: inBucket.length, byPriority };
    });

    const oldest = rows.length > 0 ? Math.max(...rows.map(r => r.days)) : 0;
    const over90 = result[3]?.count || 0;

    return NextResponse.json({
      data: {
        buckets: result,
        oldestDays: oldest,
        over90,
        total: rows.length,
      },
    });
  } catch (err: any) {
    console.error('/api/rm/ticket-aging error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
