// app/api/site-activity/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX     = 100;
const VALID_STATUS = new Set(['active', 'late', 'stale', 'dormant', 'prospective']);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const page     = Math.max(1, parseInt(sp.get('page') || '1', 10));
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, parseInt(sp.get('pageSize') || String(PAGE_SIZE_DEFAULT), 10))
    );
    const status    = sp.get('status') || undefined;
    const territory = sp.get('territory') || undefined;
    const search    = sp.get('search') || undefined;

    const where: string[] = [];
    const params: any[]   = [];

    if (status && VALID_STATUS.has(status)) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (territory) {
      params.push(territory.toUpperCase());
      where.push(`territory_code = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where.push(`(LOWER(site_code) LIKE $${params.length} OR LOWER(site_name) LIKE $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Counts: total + per-status (independent of status filter so the UI can
    // show all the bucket pills with their sizes).
    const counts = await queryOne<any>(`
      SELECT
        COUNT(*)                                           AS total_all,
        COUNT(*) FILTER (WHERE status = 'active')          AS active,
        COUNT(*) FILTER (WHERE status = 'late')            AS late,
        COUNT(*) FILTER (WHERE status = 'stale')           AS stale,
        COUNT(*) FILTER (WHERE status = 'dormant')         AS dormant,
        COUNT(*) FILTER (WHERE status = 'prospective')     AS prospective
      FROM site_activity
    `);

    const filteredCount = await queryOne<any>(`
      SELECT COUNT(*) AS n FROM site_activity ${whereSql}
    `, params);
    const total = parseInt(filteredCount?.n || 0);

    const offset = (page - 1) * pageSize;
    params.push(pageSize); const limitIdx  = params.length;
    params.push(offset);   const offsetIdx = params.length;

    const rows = await query<any>(`
      SELECT site_code,
             site_name,
             moso,
             territory_code,
             territory_name,
             first_sale_date,
             last_sale_date,
             days_reported,
             days_since_last,
             status
      FROM site_activity
      ${whereSql}
      ORDER BY
        CASE status
          WHEN 'dormant'     THEN 0
          WHEN 'stale'       THEN 1
          WHEN 'late'        THEN 2
          WHEN 'prospective' THEN 3
          WHEN 'active'      THEN 4
        END,
        days_since_last DESC NULLS FIRST,
        site_name
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, params);

    return NextResponse.json({
      data: rows.map((r: any) => ({
        siteCode:       r.site_code,
        siteName:       r.site_name,
        moso:           r.moso,
        territoryCode:  r.territory_code,
        territoryName:  r.territory_name,
        firstSaleDate:  r.first_sale_date,
        lastSaleDate:   r.last_sale_date,
        daysReported:   r.days_reported != null ? parseInt(r.days_reported) : 0,
        daysSinceLast:  r.days_since_last != null ? parseInt(r.days_since_last) : null,
        status:         r.status,
      })),
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      counts: {
        all:         parseInt(counts?.total_all   || 0),
        active:      parseInt(counts?.active      || 0),
        late:        parseInt(counts?.late        || 0),
        stale:       parseInt(counts?.stale       || 0),
        dormant:     parseInt(counts?.dormant     || 0),
        prospective: parseInt(counts?.prospective || 0),
      },
      asOf: new Date().toISOString().split('T')[0],
    });
  } catch (err: any) {
    console.error('/api/site-activity error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
