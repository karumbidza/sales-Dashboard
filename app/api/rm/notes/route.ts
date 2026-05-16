// app/api/rm/notes/route.ts
// Per-site, per-period analyst notes. Used by the dashboard heatmap
// and by the server-side PDF renderer.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isISODate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom');
    const dateTo   = sp.get('dateTo');
    if (!isISODate(dateFrom) || !isISODate(dateTo)) {
      return bad('dateFrom and dateTo must be YYYY-MM-DD');
    }
    const rows = await query<{ site_code: string; note_text: string }>(
      `SELECT site_code, note_text
         FROM rm_site_notes
        WHERE period_from = $1::DATE AND period_to = $2::DATE`,
      [dateFrom, dateTo],
    );
    return NextResponse.json({
      data: rows.map(r => ({ siteCode: r.site_code, note: r.note_text })),
    });
  } catch (err: any) {
    console.error('GET /api/rm/notes error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const siteCode = (body?.siteCode || '').trim();
    const dateFrom = (body?.dateFrom || '').trim();
    const dateTo   = (body?.dateTo   || '').trim();
    const note     = typeof body?.note === 'string' ? body.note : '';

    if (!siteCode) return bad('siteCode required');
    if (!isISODate(dateFrom) || !isISODate(dateTo)) {
      return bad('dateFrom and dateTo must be YYYY-MM-DD');
    }

    if (note.trim() === '') {
      // Empty note = delete.
      await query(
        `DELETE FROM rm_site_notes
          WHERE site_code = $1 AND period_from = $2::DATE AND period_to = $3::DATE`,
        [siteCode, dateFrom, dateTo],
      );
      return NextResponse.json({ ok: true, deleted: true });
    }

    await query(
      `INSERT INTO rm_site_notes (site_code, period_from, period_to, note_text)
       VALUES ($1, $2::DATE, $3::DATE, $4)
       ON CONFLICT (site_code, period_from, period_to)
       DO UPDATE SET note_text = EXCLUDED.note_text, updated_at = NOW()`,
      [siteCode, dateFrom, dateTo, note],
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('POST /api/rm/notes error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
