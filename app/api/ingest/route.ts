// app/api/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

// Rate limiter: max 5 ingestion requests per IP per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 — ZIP/OOXML

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests — try again in a minute' }, { status: 429 });
  }

  const tempPath = join('/tmp', `fuel_upload_${Date.now()}_${Math.random().toString(36).slice(2)}.xlsx`);
  let logId: number | null = null;
  const startMs = Date.now();

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const period = (formData.get('period') as string) || '';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      return NextResponse.json({ error: 'Only Excel files (.xlsx) are accepted' }, { status: 400 });
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate magic bytes
    if (buffer.length < 4 || !XLSX_MAGIC.every((b, i) => buffer[i] === b)) {
      return NextResponse.json({ error: 'Invalid file format' }, { status: 400 });
    }

    // Validate period format
    if (period && !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: 'Invalid period format — use YYYY-MM-DD' }, { status: 400 });
    }

    // Create upload_log entry (status: pending)
    const logRow = await query<any>(
      `INSERT INTO upload_log (file_name, file_size_bytes, status)
       VALUES ($1, $2, 'pending') RETURNING id`,
      [file.name, file.size]
    );
    logId = logRow[0]?.id ?? null;

    await writeFile(tempPath, buffer);

    const scriptPath = join(process.cwd(), 'scripts', 'ingest.py');
    const args = ['--file', tempPath];
    if (period) args.push('--period', period);

    const { stdout } = await execFileAsync('python3', [scriptPath, ...args], {
      timeout: 120_000,
      env: { ...process.env },
    });

    const lines = stdout.trim().split('\n');
    const lastJson = lines.reverse().find(l => l.trim().startsWith('{'));
    const result = lastJson ? JSON.parse(lastJson) : { success: false };

    const durationMs = Date.now() - startMs;

    if (!result.success) {
      // Log failure
      if (logId) {
        await query(
          `UPDATE upload_log SET status='failed', error_message=$1, duration_ms=$2 WHERE id=$3`,
          [result.error || 'Ingestion failed', durationMs, logId]
        );
      }
      return NextResponse.json({ error: result.error || 'Ingestion failed', log: stdout }, { status: 422 });
    }

    // Log success with row counts and period
    if (logId) {
      await query(
        `UPDATE upload_log
         SET status='success', period_month=$1, row_counts=$2, duration_ms=$3
         WHERE id=$4`,
        [
          result.period_month || null,
          JSON.stringify(result.row_counts || {}),
          durationMs,
          logId,
        ]
      );
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      periodMonth: result.period_month,
      rowCounts: result.row_counts,
      durationMs,
      log: stdout,
    });

  } catch (err: any) {
    console.error('Ingest error:', err);
    const durationMs = Date.now() - startMs;
    if (logId) {
      await query(
        `UPDATE upload_log SET status='failed', error_message=$1, duration_ms=$2 WHERE id=$3`,
        [String(err.message || 'Unknown error'), durationMs, logId]
      ).catch(() => {});
    }
    return NextResponse.json({ error: 'Ingestion failed — check server logs' }, { status: 500 });
  } finally {
    unlink(tempPath).catch(() => {});
  }
}
