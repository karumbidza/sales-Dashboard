// app/api/validate/route.ts
// Phase 1: pre-flight validation — reads the Excel, checks structure, returns
// a report. Nothing is written to the database.
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';
const execFileAsync = promisify(execFile);

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export async function POST(req: NextRequest) {
  const tempPath = join('/tmp', `fuel_validate_${Date.now()}.xlsx`);

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls'))
      return NextResponse.json({ error: 'Only .xlsx files accepted' }, { status: 400 });

    if (file.size > 50 * 1024 * 1024)
      return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length < 4 || !XLSX_MAGIC.every((b, i) => buffer[i] === b))
      return NextResponse.json({ error: 'Invalid file format' }, { status: 400 });

    await writeFile(tempPath, buffer);

    const scriptPath = join(process.cwd(), 'scripts', 'validate.py');

    // validate.py exits 1 when it finds errors — execFileAsync rejects on non-zero
    // exit codes, but stdout still contains the JSON report we need.
    let stdout = '';
    try {
      const out = await execFileAsync(
        'python3', [scriptPath, '--file', tempPath],
        { timeout: 60_000, env: { ...process.env } }
      );
      stdout = out.stdout;
    } catch (execErr: any) {
      stdout = execErr.stdout || '';
      if (!stdout) throw execErr; // real execution failure, no output
    }

    // Parse JSON result from stdout — validate.py prints pretty-printed JSON
    // (multi-line), so grab from the first `{` to the last `}`.
    const start = stdout.indexOf('{');
    const end   = stdout.lastIndexOf('}');
    const jsonBlob = start >= 0 && end > start ? stdout.slice(start, end + 1) : '';
    const result = jsonBlob ? JSON.parse(jsonBlob) : {
      ok: false, canIngest: false,
      checks: [], summary: { errors: 1, warnings: 0, passed: 0 },
      sheetRowCounts: {}, dateRange: null,
      error: 'Validator returned no output',
    };

    return NextResponse.json(result);

  } catch (err: any) {
    console.error('/api/validate error:', err);
    const detail = err?.stderr || err?.message || 'Internal server error';
    return NextResponse.json({
      ok: false, canIngest: false, error: detail,
      checks: [{ id: 'system', sheet: null, title: 'Validator error', status: 'error', detail }],
      summary: { errors: 1, warnings: 0, passed: 0 },
      sheetRowCounts: {}, dateRange: null,
    }, { status: 500 });
  } finally {
    unlink(tempPath).catch(() => {});
  }
}
