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

    return NextResponse.json({
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
