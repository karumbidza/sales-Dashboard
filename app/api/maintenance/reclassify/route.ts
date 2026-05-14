// app/api/maintenance/reclassify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CATEGORY_SLUGS } from '@/lib/categorizer';
import { normalizeDescription } from '@/lib/normalize-description';

export const dynamic = 'force-dynamic';

const SLUGS = new Set<string>(CATEGORY_SLUGS);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const descRaw   = String(body?.description_norm ?? body?.description ?? '');
    const slug      = String(body?.category_slug ?? '');

    if (!descRaw)            return NextResponse.json({ error: 'description required' }, { status: 400 });
    if (!SLUGS.has(slug))    return NextResponse.json({ error: 'unknown category_slug' }, { status: 400 });

    const desc = normalizeDescription(descRaw);
    if (!desc) return NextResponse.json({ error: 'normalized description is empty' }, { status: 400 });

    // Upsert: row may already exist (set by AI or seeded as pending).
    const result = await query<{ id: number; old_slug: string | null }>(
      `WITH new_cat AS (
         SELECT id FROM rm_categories WHERE slug = $2
       ),
       up AS (
         INSERT INTO rm_description_categories
           (description_norm, category_id, confidence, source, needs_review, updated_at)
         VALUES ($1, (SELECT id FROM new_cat), 'high', 'override', FALSE, NOW())
         ON CONFLICT (description_norm) DO UPDATE
           SET category_id = (SELECT id FROM new_cat),
               confidence  = 'high',
               source      = 'override',
               needs_review = FALSE,
               updated_at  = NOW()
         RETURNING id
       )
       SELECT id, NULL::TEXT AS old_slug FROM up`,
      [desc, slug],
    );

    return NextResponse.json({ ok: true, id: result[0]?.id ?? null });
  } catch (err: any) {
    console.error('/api/maintenance/reclassify error:', err);
    return NextResponse.json({ error: err.message || 'reclassify failed' }, { status: 500 });
  }
}
