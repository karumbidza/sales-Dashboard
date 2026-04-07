// app/api/upload-log/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '20'), 100);

    const rows = await query<any>(
      `SELECT id, file_name, file_size_bytes, period_month, status,
              row_counts, error_message, duration_ms, uploaded_at
       FROM upload_log
       ORDER BY uploaded_at DESC
       LIMIT $1`,
      [limit]
    );

    // Compute totals for each row
    const data = rows.map((r: any) => {
      const counts: Record<string, number> = r.row_counts || {};
      const totalRows = Object.values(counts).reduce((s: number, v) => s + (Number(v) || 0), 0);
      return {
        id:             r.id,
        fileName:       r.file_name,
        fileSizeKb:     r.file_size_bytes ? Math.round(r.file_size_bytes / 1024) : null,
        periodMonth:    r.period_month,
        status:         r.status,
        rowCounts:      counts,
        totalRows,
        errorMessage:   r.error_message,
        durationMs:     r.duration_ms,
        uploadedAt:     r.uploaded_at,
      };
    });

    // Summary stats
    const successCount = data.filter(r => r.status === 'success').length;
    const lastSuccess  = data.find(r => r.status === 'success');

    return NextResponse.json({
      data,
      summary: {
        totalUploads:   data.length,
        successCount,
        failedCount:    data.filter(r => r.status === 'failed').length,
        lastUploadedAt: lastSuccess?.uploadedAt || null,
        lastFileName:   lastSuccess?.fileName   || null,
        lastPeriod:     lastSuccess?.periodMonth || null,
      },
    });
  } catch (err: any) {
    console.error('/api/upload-log error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
