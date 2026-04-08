// app/api/db-viewer/budget-periods/route.ts
// Pivoted volume_budget for the Database Viewer:
//   rows = months,  columns = sites
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function ymdLocal(d: any): string {
  if (d == null) return '';
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  }
  return String(d).slice(0, 10);
}
function monthLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[parseInt(m[2],10)-1]} ${m[1]}` : iso;
}

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
        t.tm_code      AS territory_code,
        t.tm_name      AS territory_name,
        vb.budget_volume,
        vb.stretch_volume
      FROM volume_budget vb
      JOIN sites si ON vb.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      ${whereTerritory}
      ORDER BY vb.budget_month, si.budget_name
    `, params);

    const siteMap = new Map<string, { siteCode: string; siteName: string; territory: string | null }>();
    const data: Record<string, Record<string, { budget: number; stretch: number }>> = {};
    const monthSet = new Set<string>();

    for (const r of rows) {
      const monthIso = ymdLocal(r.budget_month);
      monthSet.add(monthIso);
      if (!siteMap.has(r.site_code)) {
        siteMap.set(r.site_code, {
          siteCode:  r.site_code,
          siteName:  r.site_name || r.site_code,
          territory: r.territory_name || r.territory_code || null,
        });
      }
      if (!data[r.site_code]) data[r.site_code] = {};
      data[r.site_code][monthIso] = {
        budget:  Number(r.budget_volume  || 0),
        stretch: Number(r.stretch_volume || 0),
      };
    }

    const sortedMonths = Array.from(monthSet).sort();
    const months       = sortedMonths.map(monthLabel);
    const sites        = Array.from(siteMap.values()).sort((a, b) => a.siteName.localeCompare(b.siteName));

    return NextResponse.json({ months, monthIsos: sortedMonths, sites, data });
  } catch (err: any) {
    console.error('/api/db-viewer/budget-periods error:', err);
    return NextResponse.json({ error: err.message || 'failed' }, { status: 500 });
  }
}
