// app/api/maintenance/rules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CATEGORY_SLUGS } from '@/lib/categorizer';
import { APPLY_RULES_SQL, RESET_ORPHANS_SQL, normalizePattern } from '@/lib/rm-rules';

export const dynamic = 'force-dynamic';

const VALID_SLUGS = new Set<string>(CATEGORY_SLUGS);

export async function PUT(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const setClauses: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (typeof body.pattern === 'string') {
      const pattern = normalizePattern(body.pattern);
      if (!pattern) return NextResponse.json({ error: 'pattern required' }, { status: 400 });
      if (pattern.length > 200) return NextResponse.json({ error: 'pattern too long' }, { status: 400 });
      setClauses.push(`pattern = $${p++}`);
      params.push(pattern);
    }
    if (typeof body.category_slug === 'string') {
      if (!VALID_SLUGS.has(body.category_slug)) {
        return NextResponse.json({ error: 'unknown category_slug' }, { status: 400 });
      }
      setClauses.push(`category_id = (SELECT id FROM rm_categories WHERE slug = $${p++})`);
      params.push(body.category_slug);
    }
    if (typeof body.is_active === 'boolean') {
      setClauses.push(`is_active = $${p++}`);
      params.push(body.is_active);
    }
    if (typeof body.notes === 'string' || body.notes === null) {
      setClauses.push(`notes = $${p++}`);
      params.push(body.notes == null ? null : String(body.notes).slice(0, 500));
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    await query(
      `UPDATE rm_keyword_rules SET ${setClauses.join(', ')} WHERE id = $${p}`,
      params,
    );

    // Re-apply (in case pattern/category/is_active changed) and reset
    // orphans (in case is_active flipped off and rows lost their rule).
    const applied = await query<any>(APPLY_RULES_SQL);
    const orphans = await query<any>(RESET_ORPHANS_SQL);
    return NextResponse.json({
      applied_count: applied.length,
      orphans_reset: orphans.length,
    });
  } catch (err: any) {
    console.error('/api/maintenance/rules/[id] PUT error:', err);
    return NextResponse.json({ error: err.message || 'update failed' }, { status: 500 });
  }
}
