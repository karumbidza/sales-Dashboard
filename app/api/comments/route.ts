// app/api/comments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const reportId = req.nextUrl.searchParams.get('reportId');
  if (!reportId) return NextResponse.json({ error: 'reportId required' }, { status: 400 });

  const rows = await query<any>(
    `SELECT id, comment_text, author, comment_type, ref_site_code, created_at, updated_at
     FROM report_comments WHERE report_id = $1 ORDER BY created_at ASC`,
    [reportId]
  );
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { reportId, commentText, author, commentType, refSiteCode } = body;

  if (!reportId || !commentText) {
    return NextResponse.json({ error: 'reportId and commentText required' }, { status: 400 });
  }

  // Ensure report exists
  const report = await queryOne('SELECT id FROM reports WHERE id = $1', [reportId]);
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }

  const row = await queryOne<any>(
    `INSERT INTO report_comments (report_id, comment_text, author, comment_type, ref_site_code)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, comment_text, author, comment_type, ref_site_code, created_at`,
    [reportId, commentText, author || 'Anonymous', commentType || 'general', refSiteCode || null]
  );

  return NextResponse.json({ data: row }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await query('DELETE FROM report_comments WHERE id = $1', [id]);
  return NextResponse.json({ success: true });
}
