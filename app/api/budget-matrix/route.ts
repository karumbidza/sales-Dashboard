// app/api/budget-matrix/route.ts
// Pivoted volume_budget view: rows = months, columns = sites,
// each cell holds {budget, stretch}. PATCH allows in-place edits.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const territory = req.nextUrl.searchParams.get('territory');
    const params: any[] = [];
    let whereTerritory = '';
    if (territory) {
      params.push(territory.toUpperCase());
      whereTerritory = `WHERE t.tm_code = $${params.length}`;
    }
    const rows = await query<any>(`
      SELECT
        vb.budget_month,
        vb.site_code,
        si.budget_name AS site_name,
        vb.budget_volume,
        vb.stretch_volume
      FROM volume_budget vb
      JOIN sites si ON vb.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      ${whereTerritory}
      ORDER BY vb.budget_month, si.budget_name
    `, params);

    // Collect distinct sites (for column order) and months (for row order)
    const siteMap = new Map<string, { code: string; name: string }>();
    const monthMap = new Map<string, Record<string, { b: number; s: number }>>();

    for (const r of rows) {
      siteMap.set(r.site_code, { code: r.site_code, name: r.site_name || r.site_code });
      // Pull local Y-M-D from the JS Date — toISOString() converts to UTC and
      // shifts the day across timezone boundaries, which would mis-label months.
      const d = r.budget_month;
      const monthKey = d instanceof Date
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        : String(d).slice(0, 10);
      if (!monthMap.has(monthKey)) monthMap.set(monthKey, {});
      monthMap.get(monthKey)![r.site_code] = {
        b: Number(r.budget_volume || 0),
        s: Number(r.stretch_volume || 0),
      };
    }

    const sites = Array.from(siteMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const months = Array.from(monthMap.keys()).sort();

    const matrix = months.map(m => ({
      month: m,
      cells: sites.map(s => monthMap.get(m)?.[s.code] || null),
    }));

    return NextResponse.json({ sites, matrix });
  } catch (err: any) {
    console.error('/api/budget-matrix GET error:', err);
    return NextResponse.json({ error: err.message || 'failed' }, { status: 500 });
  }
}

// PATCH: upsert one (site_code, budget_month) cell
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { siteCode, month, budgetVolume, stretchVolume } = body || {};

    if (!siteCode || !month) {
      return NextResponse.json({ error: 'siteCode and month required' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM-DD' }, { status: 400 });
    }

    // Validate site exists (FK protection with a clear error)
    const site = await query<any>(
      `SELECT 1 FROM sites WHERE site_code = $1`, [siteCode]
    );
    if (site.length === 0) {
      return NextResponse.json({ error: `Unknown site_code: ${siteCode}` }, { status: 404 });
    }

    const b = budgetVolume == null || budgetVolume === '' ? null : Number(budgetVolume);
    const s = stretchVolume == null || stretchVolume === '' ? null : Number(stretchVolume);
    if (b != null && (!Number.isFinite(b) || b < 0)) {
      return NextResponse.json({ error: 'budgetVolume must be a non-negative number' }, { status: 400 });
    }
    if (s != null && (!Number.isFinite(s) || s < 0)) {
      return NextResponse.json({ error: 'stretchVolume must be a non-negative number' }, { status: 400 });
    }

    await query(`
      INSERT INTO volume_budget (site_code, budget_month, budget_volume, stretch_volume, source_file)
      VALUES ($1, $2::DATE, $3, $4, 'manual-edit')
      ON CONFLICT (site_code, budget_month) DO UPDATE SET
        budget_volume  = COALESCE(EXCLUDED.budget_volume,  volume_budget.budget_volume),
        stretch_volume = COALESCE(EXCLUDED.stretch_volume, volume_budget.stretch_volume),
        source_file    = 'manual-edit',
        ingested_at    = NOW()
    `, [siteCode, month, b, s]);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('/api/budget-matrix PATCH error:', err);
    return NextResponse.json({ error: err.message || 'failed' }, { status: 500 });
  }
}
