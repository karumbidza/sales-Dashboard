// app/api/ingest/preflight/route.ts
// Read-only diff: parses the Excel and compares STATUS REPORT against existing
// `sales` rows. Nothing is written to the database.
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';
const execFileAsync = promisify(execFile);

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export async function POST(req: NextRequest) {
  const tempPath = join('/tmp', `fuel_preflight_${Date.now()}_${Math.random().toString(36).slice(2)}.xlsx`);

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

    const scriptPath = join(process.cwd(), 'scripts', 'preflight.py');
    const { stdout } = await execFileAsync(
      'python3', [scriptPath, '--file', tempPath],
      { timeout: 90_000, env: { ...process.env }, maxBuffer: 10 * 1024 * 1024 }
    );

    const lines = stdout.trim().split('\n');
    const jsonLine = lines.reverse().find(l => l.trim().startsWith('{'));
    if (!jsonLine) {
      return NextResponse.json({ error: 'Preflight returned no output' }, { status: 500 });
    }
    const result = JSON.parse(jsonLine);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    return NextResponse.json(result);

  } catch (err: any) {
    console.error('/api/ingest/preflight error:', err);
    const detail = err?.stderr || err?.message || 'Internal server error';
    return NextResponse.json({ error: detail }, { status: 500 });
  } finally {
    unlink(tempPath).catch(() => {});
  }
}
