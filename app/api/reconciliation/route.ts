// app/api/reconciliation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const month = sp.get('month') || new Date().toISOString().slice(0, 7) + '-01';
    const onlyFlagged = sp.get('flagged') === 'true';
    const territory = sp.get('territory');

    const params: any[] = [month];
    const clauses: string[] = [];

    if (onlyFlagged) clauses.push('rl.is_flagged = TRUE');
    if (territory) {
      params.push(territory.toUpperCase());
      clauses.push(`t.tm_code = $${params.length}`);
    }

    const rows = await query<any>(`
      SELECT
        si.site_code,
        si.budget_name                                  AS site_name,
        si.moso,
        t.tm_code                                       AS territory_code,
        t.tm_name                                       AS territory_name,
        ROUND(rl.status_volume::NUMERIC, 0)             AS status_volume,
        ROUND(rl.invoiced_volume::NUMERIC, 0)           AS invoiced_volume,
        ROUND(rl.variance::NUMERIC, 0)                  AS variance,
        rl.variance_pct,
        rl.is_flagged,
        rl.notes
      FROM reconciliation_log rl
      JOIN sites si ON rl.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      WHERE DATE_TRUNC('month', rl.period_month) = DATE_TRUNC('month', $1::DATE)
      ${clauses.length ? 'AND ' + clauses.join(' AND ') : ''}
      ORDER BY ABS(rl.variance) DESC NULLS LAST
    `, params);

    // Summary stats
    const flaggedCount  = rows.filter((r: any) => r.is_flagged).length;
    const totalVariance = rows.reduce((sum: number, r: any) => sum + parseFloat(r.variance || 0), 0);

    return NextResponse.json({
      data: rows.map((r: any) => ({
        ...r,
        status_volume:   parseFloat(r.status_volume),
        invoiced_volume: parseFloat(r.invoiced_volume),
        variance:        parseFloat(r.variance),
        variance_pct:    r.variance_pct ? parseFloat(r.variance_pct) : null,
      })),
      summary: {
        total_sites:    rows.length,
        flagged_sites:  flaggedCount,
        total_variance: Math.round(totalVariance),
      },
    });

  } catch (err: any) {
    console.error('/api/reconciliation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
