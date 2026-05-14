// app/api/maintenance/rules/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CATEGORY_SLUGS } from '@/lib/categorizer';
import { APPLY_RULES_SQL, normalizePattern } from '@/lib/rm-rules';

export const dynamic = 'force-dynamic';

const VALID_SLUGS = new Set<string>(CATEGORY_SLUGS);

export async function GET() {
  try {
    const rows = await query<any>(`
      SELECT r.id, r.pattern, r.is_active, r.notes, r.created_at, r.updated_at,
             c.slug AS category_slug, c.display_name AS category_name,
             COUNT(rdc.description_norm)::INT AS match_count
        FROM rm_keyword_rules r
        JOIN rm_categories c ON r.category_id = c.id
        LEFT JOIN rm_description_categories rdc
          ON r.is_active = TRUE
         AND rdc.description_norm LIKE '%' || lower(r.pattern) || '%'
       GROUP BY r.id, c.slug, c.display_name
       ORDER BY LENGTH(r.pattern) DESC, r.id
    `);

    const otherRows = await query<{ n: string }>(`
      SELECT COUNT(*)::TEXT AS n
        FROM rm_description_categories
       WHERE source = 'ai'
         AND category_id = (SELECT id FROM rm_categories WHERE slug = 'other')
    `);
    const otherCount = parseInt(otherRows[0]?.n || '0', 10);

    return NextResponse.json({
      otherCount,
      data: rows.map(r => ({
        id:           r.id,
        pattern:      r.pattern,
        categorySlug: r.category_slug,
        categoryName: r.category_name,
        isActive:     r.is_active,
        notes:        r.notes,
        matchCount:   r.match_count,
        createdAt:    r.created_at,
        updatedAt:    r.updated_at,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/rules GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pattern = normalizePattern(body?.pattern);
    const slug    = String(body?.category_slug ?? '');
    const notes   = body?.notes != null ? String(body.notes).slice(0, 500) : null;

    if (!pattern) return NextResponse.json({ error: 'pattern required' }, { status: 400 });
    if (pattern.length > 200) return NextResponse.json({ error: 'pattern too long (max 200 chars)' }, { status: 400 });
    if (!VALID_SLUGS.has(slug)) return NextResponse.json({ error: 'unknown category_slug' }, { status: 400 });

    // Reject duplicate active patterns.
    const dup = await query<{ id: number }>(
      `SELECT id FROM rm_keyword_rules WHERE lower(pattern) = $1 AND is_active = TRUE LIMIT 1`,
      [pattern],
    );
    if (dup.length > 0) {
      return NextResponse.json({ error: 'rule already exists for this pattern' }, { status: 409 });
    }

    const ins = await query<{ id: number }>(
      `INSERT INTO rm_keyword_rules (pattern, category_id, notes)
       VALUES ($1, (SELECT id FROM rm_categories WHERE slug = $2), $3)
       RETURNING id`,
      [pattern, slug, notes],
    );

    const applied = await query<any>(APPLY_RULES_SQL);
    return NextResponse.json({ id: ins[0].id, applied_count: applied.length });
  } catch (err: any) {
    // Race-safe duplicate detection — the partial unique index catches concurrent
    // duplicate inserts that slip past the SELECT-then-INSERT pre-check.
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'rule already exists for this pattern' }, { status: 409 });
    }
    console.error('/api/maintenance/rules POST error:', err);
    return NextResponse.json({ error: err.message || 'create failed' }, { status: 500 });
  }
}
