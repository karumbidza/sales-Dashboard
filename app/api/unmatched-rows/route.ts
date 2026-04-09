// app/api/unmatched-rows/route.ts
// Returns rows that ingest could not place against a NAME INDEX entry,
// grouped by raw site code so the UI shows one row per offending code.
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX     = 100;
const VALID_SHEETS = new Set(['STATUS REPORT', 'PETROTRADE', 'MARGIN']);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const page     = Math.max(1, parseInt(sp.get('page') || '1', 10));
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, parseInt(sp.get('pageSize') || String(PAGE_SIZE_DEFAULT), 10)),
    );
    const sheet = sp.get('sheet') || undefined;

    const where: string[] = [];
    const params: any[]   = [];

    if (sheet && VALID_SHEETS.has(sheet)) {
      params.push(sheet);
      where.push(`sheet_name = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Total + per-sheet counts (independent of filter so UI pills are stable)
    const totals = await queryOne<any>(`
      SELECT
        COUNT(*)                                              AS all_rows,
        COUNT(*) FILTER (WHERE sheet_name = 'STATUS REPORT')  AS status_report,
        COUNT(*) FILTER (WHERE sheet_name = 'PETROTRADE')     AS petrotrade,
        COUNT(*) FILTER (WHERE sheet_name = 'MARGIN')         AS margin,
        COUNT(DISTINCT raw_site_code)                         AS distinct_codes
      FROM unmatched_status_rows
    `);

    // Grouped count for pagination total
    const groupedTotal = await queryOne<any>(`
      SELECT COUNT(*) AS n FROM (
        SELECT raw_site_code, sheet_name
        FROM unmatched_status_rows
        ${whereSql}
        GROUP BY raw_site_code, sheet_name
      ) g
    `, params);
    const total = parseInt(groupedTotal?.n || 0);

    const offset = (page - 1) * pageSize;
    params.push(pageSize); const limitIdx  = params.length;
    params.push(offset);   const offsetIdx = params.length;

    const rows = await query<any>(`
      SELECT raw_site_code,
             sheet_name,
             COUNT(*)              AS row_count,
             MIN(sale_date)        AS first_date,
             MAX(sale_date)        AS last_date,
             MAX(ingested_at)      AS last_seen,
             MAX(source_file)      AS last_source
      FROM unmatched_status_rows
      ${whereSql}
      GROUP BY raw_site_code, sheet_name
      ORDER BY MAX(ingested_at) DESC, row_count DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, params);

    return NextResponse.json({
      data: rows.map((r: any) => ({
        rawSiteCode: r.raw_site_code,
        sheet:       r.sheet_name,
        rowCount:    parseInt(r.row_count),
        firstDate:   r.first_date,
        lastDate:    r.last_date,
        lastSeen:    r.last_seen,
        lastSource:  r.last_source,
      })),
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      counts: {
        all:          parseInt(totals?.all_rows      || 0),
        statusReport: parseInt(totals?.status_report || 0),
        petrotrade:   parseInt(totals?.petrotrade    || 0),
        margin:       parseInt(totals?.margin        || 0),
        distinctCodes: parseInt(totals?.distinct_codes || 0),
      },
    });
  } catch (err: any) {
    console.error('/api/unmatched-rows error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
