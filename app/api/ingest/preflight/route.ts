// app/api/ingest/preflight/route.ts
// Returns existing DB rows for a date range so the client can compute the diff.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // New protocol: client sends dateFrom/dateTo, server returns existing rows
      const body = await req.json();
      const { dateFrom, dateTo } = body;

      if (!dateFrom || !dateTo) {
        return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
      }

      const dbRows = await query<any>(
        `SELECT site_code, sale_date, total_volume, diesel_sales_volume,
                blend_sales_volume, ulp_sales_volume, total_revenue
         FROM sales WHERE sale_date BETWEEN $1 AND $2`,
        [dateFrom, dateTo]
      );

      // Convert to compact format: { key: [total_volume, diesel, blend, ulp, revenue] }
      const existing: Record<string, number[]> = {};
      for (const r of dbRows) {
        const d = r.sale_date instanceof Date
          ? r.sale_date.toISOString().slice(0, 10)
          : String(r.sale_date).slice(0, 10);
        existing[`${r.site_code}|${d}`] = [
          parseFloat(r.total_volume) || 0,
          parseFloat(r.diesel_sales_volume) || 0,
          parseFloat(r.blend_sales_volume) || 0,
          parseFloat(r.ulp_sales_volume) || 0,
          parseFloat(r.total_revenue) || 0,
        ];
      }

      return NextResponse.json({ existing });
    }

    // Legacy FormData path — kept for backward compatibility
    const { parseExcelBuffer, siteCode, safeFloat, parseDate } = await import('@/lib/xlsx-parse');

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const { sheets } = parseExcelBuffer(buffer);
    const statusRows = sheets['STATUS REPORT'];
    if (!statusRows || statusRows.length === 0) {
      return NextResponse.json({ error: 'STATUS REPORT sheet not found' }, { status: 422 });
    }

    const EPSILON = 0.001;
    const TRACKED_FIELDS = ['total_volume', 'diesel_sales_volume', 'blend_sales_volume', 'ulp_sales_volume', 'total_revenue'] as const;

    const fileRowMetrics = (row: Record<string, any>) => {
      const dieselV = safeFloat(row['DIESEL SALES (V)']) ?? 0;
      const blendV  = safeFloat(row['BLEND SALES (V)']) ?? 0;
      const ulpV    = safeFloat(row['ULP_Sales_Qty']) ?? 0;
      const flexBV  = safeFloat(row['FLEX BLEND (V)']) ?? 0;
      const flexDV  = safeFloat(row['FLEX DIESEL (V)']) ?? 0;
      const dieselR = safeFloat(row['DIESEL SALES ($)']) ?? 0;
      const blendR  = safeFloat(row['BLEND SALES ($)']) ?? 0;
      const ulpR    = safeFloat(row['ULP SALES ($)']) ?? 0;
      const flexBR  = safeFloat(row['FLEX BLEND ($)']) ?? 0;
      const flexDR  = safeFloat(row['FLEX DIESL ($)']) ?? 0;
      return {
        diesel_sales_volume: dieselV, blend_sales_volume: blendV, ulp_sales_volume: ulpV,
        total_volume: dieselV + blendV + ulpV + flexBV + flexDV,
        total_revenue: dieselR + blendR + ulpR + flexBR + flexDR,
      };
    }

    const fileRows = new Map<string, ReturnType<typeof fileRowMetrics>>();
    let minD: string | null = null, maxD: string | null = null;
    for (const row of statusRows) {
      const code = siteCode(row['SITE CODE']);
      const date = parseDate(row['Date']);
      if (!code || !date) continue;
      fileRows.set(`${code}|${date}`, fileRowMetrics(row));
      if (!minD || date < minD) minD = date;
      if (!maxD || date > maxD) maxD = date;
    }

    const existing = new Map<string, Record<string, number>>();
    if (minD && maxD) {
      const dbRows = await query<any>(
        `SELECT site_code, sale_date, total_volume, diesel_sales_volume, blend_sales_volume, ulp_sales_volume, total_revenue
         FROM sales WHERE sale_date BETWEEN $1 AND $2`, [minD, maxD]);
      for (const r of dbRows) {
        const d = r.sale_date instanceof Date ? r.sale_date.toISOString().slice(0, 10) : String(r.sale_date).slice(0, 10);
        existing.set(`${r.site_code}|${d}`, {
          total_volume: parseFloat(r.total_volume) || 0, diesel_sales_volume: parseFloat(r.diesel_sales_volume) || 0,
          blend_sales_volume: parseFloat(r.blend_sales_volume) || 0, ulp_sales_volume: parseFloat(r.ulp_sales_volume) || 0,
          total_revenue: parseFloat(r.total_revenue) || 0,
        });
      }
    }

    let newRows = 0, changedRows = 0, unchangedRows = 0;
    const sitesChanged = new Set<string>();
    const sampleChanges: any[] = [];
    for (const [key, fileVals] of Array.from(fileRows)) {
      if (!existing.has(key)) { newRows++; continue; }
      const ex = existing.get(key)!;
      const diffs: [string, number, number][] = [];
      for (const f of TRACKED_FIELDS) {
        if (Math.abs(fileVals[f] - ex[f]) > EPSILON) diffs.push([f, ex[f], fileVals[f]]);
      }
      if (diffs.length > 0) {
        changedRows++;
        const [site] = key.split('|');
        sitesChanged.add(site);
        if (sampleChanges.length < 10) {
          const [field, oldV, newV] = diffs[0];
          sampleChanges.push({ siteCode: site, date: key.split('|')[1], field, oldValue: oldV.toFixed(3), newValue: newV.toFixed(3) });
        }
      } else { unchangedRows++; }
    }

    return NextResponse.json({
      dateFrom: minD, dateTo: maxD, rowsInFile: fileRows.size, rowsExisting: existing.size,
      newRows, changedRows, unchangedRows, sitesWithChanges: Array.from(sitesChanged).sort(), sampleChanges,
    });

  } catch (err: any) {
    console.error('/api/ingest/preflight error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
