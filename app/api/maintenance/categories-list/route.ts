// app/api/maintenance/categories-list/route.ts
// Flat list of categories — used by filter dropdowns and the reclassify menu.
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await query<any>(
      `SELECT slug, display_name, sort_order
         FROM rm_categories
        WHERE is_active = TRUE
        ORDER BY sort_order`,
    );
    return NextResponse.json({
      data: rows.map(r => ({ slug: r.slug, displayName: r.display_name })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/categories-list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
