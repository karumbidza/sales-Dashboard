// app/api/rm/filters/route.ts
// Returns dropdown values for the R&M Command Center global filter bar.
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [territories, sites, categories] = await Promise.all([
      query<{ tm_code: string; tm_name: string }>(
        `SELECT tm_code, tm_name FROM territories ORDER BY tm_name`,
      ),
      query<{ site_code: string; site_name: string; territory_code: string | null }>(
        `SELECT s.site_code, s.budget_name AS site_name, t.tm_code AS territory_code
           FROM sites s
           LEFT JOIN territories t ON s.territory_id = t.id
          ORDER BY s.budget_name`,
      ),
      query<{ slug: string; display_name: string }>(
        `SELECT slug, display_name FROM rm_categories WHERE is_active=TRUE ORDER BY sort_order`,
      ),
    ]);

    return NextResponse.json({
      data: {
        territories: territories.map(t => ({ code: t.tm_code, name: t.tm_name })),
        sites:       sites.map(s => ({ code: s.site_code, name: s.site_name, territoryCode: s.territory_code })),
        categories:  categories.map(c => ({ slug: c.slug, name: c.display_name })),
      },
    });
  } catch (err: any) {
    console.error('/api/rm/filters error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
