// app/api/maintenance/recategorize-other/route.ts
// One-click flip: every rm_description_categories row that the AI put
// in `other` goes back to `pending` so the cron (or client drain)
// re-categorizes it with the new prompt. Never touches override or
// rule rows — those are user-authoritative.
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await query<{ id: number }>(`
      UPDATE rm_description_categories
         SET source       = 'pending',
             confidence   = NULL,
             needs_review = FALSE,
             updated_at   = NOW()
       WHERE source = 'ai'
         AND category_id = (SELECT id FROM rm_categories WHERE slug = 'other')
       RETURNING id
    `);
    return NextResponse.json({ flipped: result.length });
  } catch (err: any) {
    console.error('/api/maintenance/recategorize-other error:', err);
    return NextResponse.json({ error: err.message || 'flip failed' }, { status: 500 });
  }
}
