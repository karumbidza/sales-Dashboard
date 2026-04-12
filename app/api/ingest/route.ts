// app/api/ingest/route.ts
// Pure-TypeScript Excel ingestion — no Python dependency.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  parseExcelBuffer, compactToSheets, safeFloat, safeStr, siteCode,
  parseBudgetMonthCol, parseDate, parseDateDayFirst,
} from '@/lib/xlsx-parse';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Vercel Pro allows up to 300s

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

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

const SHEET_KEY_TO_NAME: Record<string, string> = {
  name_index:    'NAME INDEX',
  status_report: 'STATUS REPORT',
  petrotrade:    'PETROTRADE',
  margin:        'MARGIN',
  volume_budget: 'VOLUME BUDGET',
};

const TRACKED_DIFF_FIELDS = [
  'total_volume', 'diesel_sales_volume', 'blend_sales_volume',
  'ulp_sales_volume', 'total_revenue',
] as const;

// ── Batch helper ──────────────────────────────────────────────────────────

async function batchUpsert(sql: string, rows: any[][], batchSize = 200) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const placeholders = batch.map((row, bi) => {
      const offset = bi * row.length;
      return `(${row.map((_, ci) => `$${offset + ci + 1}`).join(',')})`;
    }).join(',');
    const params = batch.flat();
    await query(sql.replace('__VALUES__', placeholders), params);
  }
}

// ── Ingest: NAME INDEX ────────────────────────────────────────────────────

async function ingestNameIndex(rows: Record<string, any>[], sourceFile: string) {
  const seen = new Map<string, any[]>();
  for (const row of rows) {
    const code = siteCode(row['SITE CODE']);
    const budget = safeStr(row['BUDGET']);
    if (!code || !budget) continue;
    seen.set(code, [
      code, budget,
      safeStr(row['DYNAMICS']),
      safeStr(row['STATUS REPORT']),
      safeStr(row['PETROTRADE']),
    ]);
  }
  const records = Array.from(seen.values());
  if (records.length === 0) return 0;

  for (const rec of records) {
    await query(
      `INSERT INTO sites (site_code, budget_name, dynamics_name, status_report_name, petrotrade_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (site_code) DO UPDATE SET
         budget_name = EXCLUDED.budget_name,
         dynamics_name = EXCLUDED.dynamics_name,
         status_report_name = EXCLUDED.status_report_name,
         petrotrade_name = EXCLUDED.petrotrade_name`,
      rec
    );
  }
  return records.length;
}

// ── Ingest: VOLUME BUDGET ─────────────────────────────────────────────────

async function ingestBudget(rows: Record<string, any>[], sourceFile: string) {
  // Get territory map
  const terRows = await query<{ tm_code: string; id: number }>('SELECT tm_code, id FROM territories');
  const territoryMap = new Map(terRows.map(r => [r.tm_code, r.id]));

  // Update sites with MOSO and territory
  for (const row of rows) {
    const code = siteCode(row['SITE CODE']);
    if (!code) continue;
    const tm = safeStr(row['TM']);
    const moso = safeStr(row['MOSO']);
    const tid = tm ? territoryMap.get(tm) ?? null : null;
    await query('UPDATE sites SET moso = $1, territory_id = $2 WHERE site_code = $3', [moso, tid, code]);
  }

  // Identify month columns
  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
  const monthCols: [string, string][] = [];
  for (const col of cols) {
    const dt = parseBudgetMonthCol(col);
    if (dt) monthCols.push([col, dt]);
  }

  let count = 0;
  for (const row of rows) {
    const code = siteCode(row['SITE CODE']);
    if (!code) continue;
    const stretch = safeFloat(row['Stretch']) ?? 0;
    const marginBudget = safeFloat(row['MARGIN BUDGET']) ?? 0;
    const ugm = safeFloat(row['UGM - system']) ?? 0;

    for (const [col, budgetMonth] of monthCols) {
      const vol = safeFloat(row[col]) ?? 0;
      if (vol <= 0) continue;
      const stretchMonthly = stretch ? stretch / 12 : null;
      await query(
        `INSERT INTO volume_budget (site_code, budget_month, budget_volume, stretch_volume, margin_budget, ugm_system, source_file)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (site_code, budget_month) DO UPDATE SET
           budget_volume = EXCLUDED.budget_volume, stretch_volume = EXCLUDED.stretch_volume,
           margin_budget = EXCLUDED.margin_budget, ugm_system = EXCLUDED.ugm_system,
           source_file = EXCLUDED.source_file, ingested_at = NOW()`,
        [code, budgetMonth, vol, stretchMonthly,
         marginBudget > 0 ? marginBudget : null,
         ugm > 0 ? ugm : null, sourceFile]
      );
      count++;
    }
  }
  return count;
}

// ── Ingest: STATUS REPORT ─────────────────────────────────────────────────

async function ingestStatusReport(
  rows: Record<string, any>[], sourceFile: string, uploadLogId: number | null
) {
  // Clear prior unmatched rows
  if (uploadLogId) {
    await query("DELETE FROM unmatched_status_rows WHERE upload_log_id = $1 AND sheet_name = 'STATUS REPORT'", [uploadLogId]);
  }

  const validCodes = new Set(
    (await query<{ site_code: string }>('SELECT site_code FROM sites')).map(r => r.site_code)
  );

  // Build records
  const seen = new Map<string, any[]>();
  const unmatched: any[][] = [];
  let skipped = 0;

  for (const row of rows) {
    const rawCode = safeStr(row['SITE CODE']);
    const code = siteCode(row['SITE CODE']);
    if (!code || !validCodes.has(code)) {
      skipped++;
      if (rawCode) {
        const sd = parseDate(row['Date']);
        unmatched.push([rawCode, sd, 'STATUS REPORT', sourceFile, uploadLogId]);
      }
      continue;
    }
    const saleDate = parseDate(row['Date']);
    if (!saleDate) { skipped++; continue; }

    const rec = [
      code, saleDate,
      safeFloat(row['OPENING DIP DIESEL'], null),
      safeFloat(row['DIESEL DELIVERY']),
      safeFloat(row['DIESEL SALES (V)']),
      safeFloat(row['CLOSING DIP DIESEL'], null),
      safeFloat(row['DIESEL GAIN/LOSS'], null),
      safeFloat(row['DIESEL SALES ($)']),
      safeFloat(row['BLEND START DIP'], null),
      safeFloat(row['BLEND DELIVERIES']),
      safeFloat(row['BLEND SALES (V)']),
      safeFloat(row['BLEND CLOSING DIP'], null),
      safeFloat(row['BLEND GAIN/LOSS'], null),
      safeFloat(row['BLEND SALES ($)']),
      safeFloat(row['ULP_Start_Dip'], null),
      safeFloat(row['ULP_Deliveries']),
      safeFloat(row['ULP_Sales_Qty']),
      safeFloat(row['ULP_End_Dip'], null),
      safeFloat(row['ULP_Gain_Loss'], null),
      safeFloat(row['ULP SALES ($)']),
      safeFloat(row['FLEX BLEND (V)']),
      safeFloat(row['FLEX BLEND ($)']),
      safeFloat(row['FLEX DIESEL (V)']),
      safeFloat(row['FLEX DIESL ($)']),
      safeFloat(row['Cash_Sale_Value'], null),
      safeFloat(row['Cash_Count'], null),
      safeFloat(row['Cash_Difference'], null),
      safeFloat(row['Blend_Coupon_Qty']),
      safeFloat(row['Blend_Coupon_Value']),
      safeFloat(row['Blend_Card_Qty']),
      safeFloat(row['Blend_Card_Value']),
      safeFloat(row['D50_Coupon_Qty']),
      safeFloat(row['D50_Coupon_Value']),
      safeFloat(row['D50_Card_Qty']),
      safeFloat(row['D50_Card_Value']),
      safeFloat(row['ULP_Coupon_Qty']),
      safeFloat(row['ULP_Coupon_Value']),
      safeFloat(row['ULP_Card_Qty']),
      safeFloat(row['ULP_Card_Value']),
      sourceFile,
    ];
    seen.set(`${code}|${saleDate}`, rec);
  }

  const records = Array.from(seen.values());
  const totalInFile = records.length;

  // Fetch existing rows for diff
  if (records.length === 0) return { inserted: 0, skipped, total: totalInFile };

  const dates = records.map(r => r[1] as string);
  const minD = dates.reduce((a, b) => a < b ? a : b);
  const maxD = dates.reduce((a, b) => a > b ? a : b);

  const existingRows = await query<any>(
    `SELECT site_code, sale_date, total_volume, diesel_sales_volume,
            blend_sales_volume, ulp_sales_volume, total_revenue
     FROM sales WHERE sale_date BETWEEN $1 AND $2`,
    [minD, maxD]
  );

  const existing = new Map<string, Record<string, number>>();
  for (const r of existingRows) {
    const d = r.sale_date instanceof Date ? r.sale_date.toISOString().slice(0, 10) : String(r.sale_date).slice(0, 10);
    existing.set(`${r.site_code}|${d}`, {
      total_volume: parseFloat(r.total_volume) || 0,
      diesel_sales_volume: parseFloat(r.diesel_sales_volume) || 0,
      blend_sales_volume: parseFloat(r.blend_sales_volume) || 0,
      ulp_sales_volume: parseFloat(r.ulp_sales_volume) || 0,
      total_revenue: parseFloat(r.total_revenue) || 0,
    });
  }

  // Diff
  const filtered: any[][] = [];
  const changeLog: any[][] = [];
  let nNew = 0, nChanged = 0, nUnchanged = 0;

  for (const rec of records) {
    const key = `${rec[0]}|${rec[1]}`;
    if (!existing.has(key)) { filtered.push(rec); nNew++; continue; }

    const ex = existing.get(key)!;
    const dieselV = (rec[4] as number) ?? 0;
    const blendV  = (rec[10] as number) ?? 0;
    const ulpV    = (rec[16] as number) ?? 0;
    const flexBV  = (rec[20] as number) ?? 0;
    const flexDV  = (rec[22] as number) ?? 0;
    const dieselR = (rec[7] as number) ?? 0;
    const blendR  = (rec[13] as number) ?? 0;
    const ulpR    = (rec[19] as number) ?? 0;
    const flexBR  = (rec[21] as number) ?? 0;
    const flexDR  = (rec[23] as number) ?? 0;

    const newVals: Record<string, number> = {
      diesel_sales_volume: dieselV,
      blend_sales_volume: blendV,
      ulp_sales_volume: ulpV,
      total_volume: dieselV + blendV + ulpV + flexBV + flexDV,
      total_revenue: dieselR + blendR + ulpR + flexBR + flexDR,
    };

    const diffs: [string, number, number][] = [];
    for (const f of TRACKED_DIFF_FIELDS) {
      if (Math.abs(newVals[f] - ex[f]) > 0.001) diffs.push([f, ex[f], newVals[f]]);
    }

    if (diffs.length > 0) {
      filtered.push(rec);
      nChanged++;
      if (uploadLogId) {
        for (const [field, oldV, newV] of diffs) {
          changeLog.push([uploadLogId, rec[0], rec[1], field, oldV.toFixed(3), newV.toFixed(3)]);
        }
      }
    } else {
      nUnchanged++;
    }
  }

  // Log changes
  if (changeLog.length > 0) {
    for (const cl of changeLog) {
      await query(
        `INSERT INTO upload_changes (upload_log_id, site_code, sale_date, field_name, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5, $6)`, cl
      );
    }
  }

  // Upsert filtered records
  for (const rec of filtered) {
    await query(
      `INSERT INTO sales (
        site_code, sale_date,
        diesel_opening_dip, diesel_delivery, diesel_sales_volume,
        diesel_closing_dip, diesel_gain_loss, diesel_sales_value,
        blend_opening_dip, blend_delivery, blend_sales_volume,
        blend_closing_dip, blend_gain_loss, blend_sales_value,
        ulp_opening_dip, ulp_delivery, ulp_sales_volume,
        ulp_closing_dip, ulp_gain_loss, ulp_sales_value,
        flex_blend_volume, flex_blend_value,
        flex_diesel_volume, flex_diesel_value,
        cash_sale_value, cash_count, cash_difference,
        blend_coupon_qty, blend_coupon_value,
        blend_card_qty, blend_card_value,
        diesel_coupon_qty, diesel_coupon_value,
        diesel_card_qty, diesel_card_value,
        ulp_coupon_qty, ulp_coupon_value,
        ulp_card_qty, ulp_card_value,
        source_file
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40
      )
      ON CONFLICT (site_code, sale_date) DO UPDATE SET
        diesel_opening_dip  = EXCLUDED.diesel_opening_dip,
        diesel_delivery     = EXCLUDED.diesel_delivery,
        diesel_sales_volume = EXCLUDED.diesel_sales_volume,
        diesel_closing_dip  = EXCLUDED.diesel_closing_dip,
        diesel_gain_loss    = EXCLUDED.diesel_gain_loss,
        diesel_sales_value  = EXCLUDED.diesel_sales_value,
        blend_opening_dip   = EXCLUDED.blend_opening_dip,
        blend_delivery      = EXCLUDED.blend_delivery,
        blend_sales_volume  = EXCLUDED.blend_sales_volume,
        blend_closing_dip   = EXCLUDED.blend_closing_dip,
        blend_gain_loss     = EXCLUDED.blend_gain_loss,
        blend_sales_value   = EXCLUDED.blend_sales_value,
        ulp_opening_dip     = EXCLUDED.ulp_opening_dip,
        ulp_delivery        = EXCLUDED.ulp_delivery,
        ulp_sales_volume    = EXCLUDED.ulp_sales_volume,
        ulp_closing_dip     = EXCLUDED.ulp_closing_dip,
        ulp_gain_loss       = EXCLUDED.ulp_gain_loss,
        ulp_sales_value     = EXCLUDED.ulp_sales_value,
        flex_blend_volume   = EXCLUDED.flex_blend_volume,
        flex_blend_value    = EXCLUDED.flex_blend_value,
        flex_diesel_volume  = EXCLUDED.flex_diesel_volume,
        flex_diesel_value   = EXCLUDED.flex_diesel_value,
        cash_sale_value     = EXCLUDED.cash_sale_value,
        cash_count          = EXCLUDED.cash_count,
        cash_difference     = EXCLUDED.cash_difference,
        blend_coupon_qty    = EXCLUDED.blend_coupon_qty,
        blend_coupon_value  = EXCLUDED.blend_coupon_value,
        blend_card_qty      = EXCLUDED.blend_card_qty,
        blend_card_value    = EXCLUDED.blend_card_value,
        diesel_coupon_qty   = EXCLUDED.diesel_coupon_qty,
        diesel_coupon_value = EXCLUDED.diesel_coupon_value,
        diesel_card_qty     = EXCLUDED.diesel_card_qty,
        diesel_card_value   = EXCLUDED.diesel_card_value,
        ulp_coupon_qty      = EXCLUDED.ulp_coupon_qty,
        ulp_coupon_value    = EXCLUDED.ulp_coupon_value,
        ulp_card_qty        = EXCLUDED.ulp_card_qty,
        ulp_card_value      = EXCLUDED.ulp_card_value,
        source_file         = EXCLUDED.source_file,
        ingested_at         = NOW()`,
      rec
    );
  }

  // Log unmatched
  for (const um of unmatched) {
    await query(
      `INSERT INTO unmatched_status_rows (raw_site_code, sale_date, sheet_name, source_file, upload_log_id)
       VALUES ($1, $2, $3, $4, $5)`, um
    );
  }

  return { inserted: filtered.length, skipped, total: totalInFile, nNew, nChanged, nUnchanged };
}

// ── Ingest: PETROTRADE ────────────────────────────────────────────────────

async function ingestPetrotrade(
  rows: Record<string, any>[], sourceFile: string, uploadLogId: number | null
) {
  if (uploadLogId) {
    await query("DELETE FROM unmatched_status_rows WHERE upload_log_id = $1 AND sheet_name = 'PETROTRADE'", [uploadLogId]);
  }

  const validCodes = new Set(
    (await query<{ site_code: string }>('SELECT site_code FROM sites')).map(r => r.site_code)
  );

  const seen = new Map<string, any[]>();
  const unmatched: any[][] = [];
  let skipped = 0;

  for (const row of rows) {
    const rawCode = safeStr(row['SITE CODE']);
    const code = siteCode(row['SITE CODE']);
    if (!code || !validCodes.has(code)) {
      skipped++;
      if (rawCode) {
        const sd = parseDateDayFirst(row['DATE']);
        unmatched.push([rawCode, sd, 'PETROTRADE', sourceFile, uploadLogId]);
      }
      continue;
    }
    const saleDate = parseDateDayFirst(row['DATE']);
    if (!saleDate) { skipped++; continue; }

    const vol = safeFloat(row['P.TRADE SALES (V)']) ?? 0;
    const ref = safeStr(row['Reference']) || '';
    const desc = safeStr(row['Description']);

    seen.set(`${code}|${saleDate}|${ref}`, [code, saleDate, vol, 0.05, ref, desc, sourceFile]);
  }

  const records = Array.from(seen.values());
  for (const rec of records) {
    await query(
      `INSERT INTO petrotrade_sales (site_code, sale_date, volume_litres, margin_per_litre, reference, description, source_file)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (site_code, sale_date, reference) DO UPDATE SET
         volume_litres = EXCLUDED.volume_litres,
         source_file = EXCLUDED.source_file,
         ingested_at = NOW()`,
      rec
    );
  }

  for (const um of unmatched) {
    await query(
      `INSERT INTO unmatched_status_rows (raw_site_code, sale_date, sheet_name, source_file, upload_log_id)
       VALUES ($1, $2, $3, $4, $5)`, um
    );
  }

  return records.length;
}

// ── Ingest: MARGIN ────────────────────────────────────────────────────────

async function ingestMargin(
  rows: Record<string, any>[], sourceFile: string, uploadLogId: number | null
) {
  if (uploadLogId) {
    await query("DELETE FROM unmatched_status_rows WHERE upload_log_id = $1 AND sheet_name = 'MARGIN'", [uploadLogId]);
  }

  const validCodes = new Set(
    (await query<{ site_code: string }>('SELECT site_code FROM sites')).map(r => r.site_code)
  );

  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
  const monthCols: [string, string][] = [];
  for (const col of cols) {
    const dt = parseBudgetMonthCol(col);
    if (dt) monthCols.push([col, dt]);
  }

  const unmatched: any[][] = [];
  let count = 0;

  for (const row of rows) {
    const rawCode = safeStr(row['SITE CODE']);
    const code = siteCode(row['SITE CODE']);
    if (!code || !validCodes.has(code)) {
      if (rawCode) unmatched.push([rawCode, null, 'MARGIN', sourceFile, uploadLogId]);
      continue;
    }
    for (const [col, pm] of monthCols) {
      const val = row[col];
      if (val == null) continue;
      const mpl = safeFloat(val, null);
      if (mpl == null) continue;
      await query(
        `INSERT INTO site_margins (site_code, period_month, margin_per_litre, source_file)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (site_code, period_month) DO UPDATE SET
           margin_per_litre = EXCLUDED.margin_per_litre,
           source_file = EXCLUDED.source_file,
           ingested_at = NOW()`,
        [code, pm, mpl, sourceFile]
      );
      count++;
    }
  }

  for (const um of unmatched) {
    await query(
      `INSERT INTO unmatched_status_rows (raw_site_code, sale_date, sheet_name, source_file, upload_log_id)
       VALUES ($1, $2, $3, $4, $5)`, um
    );
  }

  return count;
}

// ── Post-ingestion ────────────────────────────────────────────────────────

async function buildReconciliation(periodMonth: string) {
  await query('DELETE FROM reconciliation_log WHERE period_month = $1', [periodMonth]);
  await query(
    `INSERT INTO reconciliation_log
       (site_code, period_month, status_volume, invoiced_volume, variance_pct, is_flagged)
     SELECT s.site_code, $1, COALESCE(sr.status_vol, 0), COALESCE(sr.status_vol, 0), 0, FALSE
     FROM sites s
     JOIN (
       SELECT site_code, SUM(total_volume) AS status_vol
       FROM sales
       WHERE DATE_TRUNC('month', sale_date) = DATE_TRUNC('month', $1::DATE)
       GROUP BY site_code
     ) sr ON s.site_code = sr.site_code`,
    [periodMonth]
  );
}

async function refreshViews() {
  await query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_site_monthly_performance');
  await query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_territory_monthly');
}

// ── Main POST handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests — try again in a minute' }, { status: 429 });
  }

  let logId: number | null = null;
  const startMs = Date.now();

  try {
    let parsedSheets: Record<string, Record<string, any>[]>;
    let fileName: string;
    let fileSize: number;
    let period: string;
    let sheetsParam: string;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // Client-side parsed data (compact format)
      const body = await req.json();
      if (!body.sheets) return NextResponse.json({ error: 'No sheet data provided' }, { status: 400 });
      ({ sheets: parsedSheets } = compactToSheets(body.sheets));
      fileName = body.fileName || 'upload.xlsx';
      fileSize = body.fileSize || 0;
      period = body.period || '';
      sheetsParam = body.selectedSheets || '';
    } else {
      // Legacy: file upload via FormData
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      period = (formData.get('period') as string) || '';
      sheetsParam = (formData.get('sheets') as string) || '';

      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls'))
        return NextResponse.json({ error: 'Only Excel files (.xlsx) are accepted' }, { status: 400 });
      if (file.size > 50 * 1024 * 1024)
        return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 });

      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length < 4 || !XLSX_MAGIC.every((b, i) => buffer[i] === b))
        return NextResponse.json({ error: 'Invalid file format' }, { status: 400 });

      ({ sheets: parsedSheets } = parseExcelBuffer(buffer));
      fileName = file.name;
      fileSize = file.size;
    }

    if (period && !/^\d{4}-\d{2}-\d{2}$/.test(period))
      return NextResponse.json({ error: 'Invalid period format — use YYYY-MM-DD' }, { status: 400 });

    // Create upload_log entry
    const logRow = await query<any>(
      `INSERT INTO upload_log (file_name, file_size_bytes, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [fileName, fileSize]
    );
    logId = logRow[0]?.id ?? null;

    const sheets = parsedSheets;

    // Determine period month
    let periodMonth: string;
    if (period) {
      const pd = new Date(period);
      periodMonth = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}-01`;
    } else {
      const now = new Date();
      periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    const selectedSheets = sheetsParam
      ? new Set(sheetsParam.split(',').map(s => s.trim()).filter(Boolean))
      : null;

    const wanted = (key: string) => selectedSheets === null || selectedSheets.has(key);
    const sourceFile = fileName;
    const rowCounts: Record<string, number> = {};

    // Ingest in dependency order
    if (wanted('name_index') && sheets['NAME INDEX']) {
      const n = await ingestNameIndex(sheets['NAME INDEX'], sourceFile);
      rowCounts.name_index = sheets['NAME INDEX'].length;
    }

    if (wanted('volume_budget') && sheets['VOLUME BUDGET']) {
      await ingestBudget(sheets['VOLUME BUDGET'], sourceFile);
      rowCounts.volume_budget = sheets['VOLUME BUDGET'].length;
    }

    if (wanted('status_report') && sheets['STATUS REPORT']) {
      await ingestStatusReport(sheets['STATUS REPORT'], sourceFile, logId);
      rowCounts.status_report = sheets['STATUS REPORT'].length;
    }

    if (wanted('petrotrade') && sheets['PETROTRADE']) {
      await ingestPetrotrade(sheets['PETROTRADE'], sourceFile, logId);
      rowCounts.petrotrade = sheets['PETROTRADE'].length;
    }

    if (wanted('margin') && sheets['MARGIN']) {
      await ingestMargin(sheets['MARGIN'], sourceFile, logId);
      rowCounts.margin = sheets['MARGIN'].length;
    }

    // Post-ingestion
    await buildReconciliation(periodMonth);
    try { await refreshViews(); } catch (e) { console.warn('View refresh failed:', e); }

    const durationMs = Date.now() - startMs;

    if (logId) {
      await query(
        `UPDATE upload_log SET status='success', period_month=$1, row_counts=$2, duration_ms=$3 WHERE id=$4`,
        [periodMonth, JSON.stringify(rowCounts), durationMs, logId]
      );
    }

    return NextResponse.json({
      success: true,
      fileName,
      periodMonth,
      rowCounts,
      durationMs,
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
    return NextResponse.json({ error: err.message || 'Ingestion failed — check server logs' }, { status: 500 });
  }
}
