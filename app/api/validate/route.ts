// app/api/validate/route.ts
// Pure-TypeScript validation — no Python dependency.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  parseExcelBuffer, compactToSheets, safeStr, siteCode, parseBudgetMonthCol, parseDate,
  safeFloat, parseDateDayFirst,
} from '@/lib/xlsx-parse';

export const dynamic = 'force-dynamic';

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

const REQUIRED_SHEETS = ['NAME INDEX', 'STATUS REPORT', 'PETROTRADE', 'MARGIN', 'VOLUME BUDGET'];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  'NAME INDEX': ['SITE CODE', 'BUDGET'],
  'STATUS REPORT': [
    'SITE CODE', 'Date',
    'DIESEL SALES (V)', 'BLEND SALES (V)', 'ULP_Sales_Qty',
    'DIESEL SALES ($)', 'BLEND SALES ($)', 'ULP SALES ($)',
  ],
  'PETROTRADE': ['SITE CODE', 'DATE', 'P.TRADE SALES (V)'],
  'MARGIN': ['SITE CODE', 'SITE NAME'],
  'VOLUME BUDGET': ['SITE CODE', 'TM', 'MOSO'],
};

const WARN_COLUMNS: Record<string, string[]> = {
  'STATUS REPORT': [
    'Cash_Sale_Value', 'Cash_Count',
    'FLEX BLEND (V)', 'FLEX DIESEL (V)',
    'DIESEL DELIVERY', 'BLEND DELIVERIES',
  ],
};

const MIN_ROW_COUNTS: Record<string, number> = {
  'NAME INDEX': 5, 'STATUS REPORT': 100, 'PETROTRADE': 1, 'MARGIN': 1, 'VOLUME BUDGET': 5,
};

interface Check {
  id: string; sheet: string | null; title: string;
  status: 'pass' | 'warning' | 'error'; detail: string;
}

export async function POST(req: NextRequest) {
  try {
    // Two accepted formats:
    // 1. JSON with lightweight payload (allColumns, rowCounts, slimmed sheets)
    // 2. FormData with file (legacy)
    let sheetNames: string[];
    let allColumns: Record<string, string[]>;        // full column names per sheet
    let sheetRowCounts: Record<string, number>;       // row counts per sheet
    let sheets: Record<string, Record<string, any>[]>; // slimmed row data
    let fileName = 'upload.xlsx';

    const contentType = req.headers.get('content-type') || '';

    // Determine dataType (default 'sales' for backwards compatibility)
    let dataType: 'sales' | 'maintenance' = 'sales';
    try {
      if (contentType.includes('application/json')) {
        const peek = await req.clone().json();
        if (peek?.dataType === 'maintenance') dataType = 'maintenance';
      } else {
        const fd = await req.clone().formData();
        if (fd.get('dataType') === 'maintenance') dataType = 'maintenance';
      }
    } catch {
      // peek failed; fall through with default 'sales'
    }

    if (dataType === 'maintenance') {
      return validateMaintenance(req);
    }

    if (contentType.includes('application/json')) {
      const body = await req.json();
      if (!body.sheets) return NextResponse.json({ error: 'No sheet data provided' }, { status: 400 });

      sheetNames = body.sheetNames || [];
      allColumns = body.allColumns || {};
      sheetRowCounts = body.rowCounts || {};
      fileName = body.fileName || fileName;

      // Convert compact sheets to objects (these are slimmed — only validation-relevant columns)
      ({ sheets } = compactToSheets(body.sheets));
    } else {
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

      const parsed = parseExcelBuffer(buffer);
      sheetNames = parsed.sheetNames;
      sheets = parsed.sheets;
      fileName = file.name;

      // For FormData mode, derive allColumns and rowCounts from full sheets
      allColumns = {};
      sheetRowCounts = {};
      for (const [name, rows] of Object.entries(sheets)) {
        sheetRowCounts[name] = rows.length;
        allColumns[name] = rows.length > 0 ? Object.keys(rows[0]) : [];
      }
    }

    const checks: Check[] = [];
    const summary = { errors: 0, warnings: 0, passed: 0 };

    const addCheck = (id: string, sheet: string | null, title: string, status: Check['status'], detail: string) => {
      checks.push({ id, sheet, title, status, detail });
      if (status === 'error') summary.errors++;
      else if (status === 'warning') summary.warnings++;
      else summary.passed++;
    };

    // 1. Required sheets
    for (const name of REQUIRED_SHEETS) {
      if (sheetNames.includes(name)) {
        const rowCount = sheetRowCounts[name] ?? 0;
        const cols = allColumns[name] || [];
        addCheck('sheet_present', name, `Sheet "${name}" present`, 'pass',
          `${rowCount} rows, ${cols.length} columns`);
      } else {
        addCheck('sheet_missing', name, `Sheet "${name}" present`, 'error',
          `Sheet not found. Found: ${sheetNames.join(', ')}`);
      }
    }

    // 2. Required columns (use allColumns — the full column list)
    for (const [sheetName, requiredCols] of Object.entries(REQUIRED_COLUMNS)) {
      const cols = allColumns[sheetName];
      if (!cols || cols.length === 0) continue;
      const missing = requiredCols.filter(c => !cols.includes(c));
      if (missing.length > 0) {
        addCheck('cols_required', sheetName, `Required columns in "${sheetName}"`, 'error',
          `Missing: ${missing.join(', ')}. Found: ${cols.slice(0, 20).join(', ')}`);
      } else {
        addCheck('cols_required', sheetName, `Required columns in "${sheetName}"`, 'pass',
          `All ${requiredCols.length} required columns present`);
      }
    }

    // 3. Optional columns
    for (const [sheetName, warnCols] of Object.entries(WARN_COLUMNS)) {
      const cols = allColumns[sheetName];
      if (!cols || cols.length === 0) continue;
      const missing = warnCols.filter(c => !cols.includes(c));
      if (missing.length > 0) {
        addCheck('cols_optional', sheetName, `Optional columns in "${sheetName}"`, 'warning',
          `Not found (will default to 0): ${missing.join(', ')}`);
      } else {
        addCheck('cols_optional', sheetName, `Optional columns in "${sheetName}"`, 'pass',
          `All ${warnCols.length} optional columns present`);
      }
    }

    // 4. Min row counts
    for (const [sheetName, minRows] of Object.entries(MIN_ROW_COUNTS)) {
      const n = sheetRowCounts[sheetName] ?? 0;
      if (!sheetNames.includes(sheetName)) continue;
      if (n < minRows) {
        addCheck('row_count', sheetName, `Row count "${sheetName}"`,
          n > 0 ? 'warning' : 'error', `${n} rows — expected at least ${minRows}`);
      } else {
        addCheck('row_count', sheetName, `Row count "${sheetName}"`, 'pass', `${n.toLocaleString()} rows`);
      }
    }

    // 5. Date column parseable (uses slimmed STATUS REPORT with Date column)
    let dateRange: { from: string; to: string } | null = null;
    const statusRows = sheets['STATUS REPORT'];
    const statusRowCount = sheetRowCounts['STATUS REPORT'] ?? 0;
    if (statusRows && statusRows.length > 0) {
      let bad = 0;
      let minD: string | null = null;
      let maxD: string | null = null;
      for (const row of statusRows) {
        const d = parseDate(row['Date']);
        if (!d) { bad++; continue; }
        if (!minD || d < minD) minD = d;
        if (!maxD || d > maxD) maxD = d;
      }
      if (bad > 0) {
        addCheck('date_parse', 'STATUS REPORT', 'Date column parseable',
          bad < statusRowCount * 0.05 ? 'warning' : 'error',
          `${bad} unparseable date values out of ${statusRowCount}`);
      } else {
        addCheck('date_parse', 'STATUS REPORT', 'Date column parseable', 'pass',
          `All ${statusRowCount.toLocaleString()} dates valid`);
      }
      if (minD && maxD) {
        dateRange = { from: minD, to: maxD };
        addCheck('date_range', 'STATUS REPORT', 'Date range detected', 'pass', `${minD} → ${maxD}`);
      }
    }

    // 6. Duplicate site+date
    if (statusRows && statusRows.length > 0) {
      const seen = new Set<string>();
      let dupes = 0;
      for (const row of statusRows) {
        const code = siteCode(row['SITE CODE']);
        const date = parseDate(row['Date']);
        if (!code || !date) continue;
        const key = `${code}|${date}`;
        if (seen.has(key)) dupes++;
        else seen.add(key);
      }
      addCheck('duplicates', 'STATUS REPORT', 'Duplicate site+date rows',
        dupes > 0 ? 'warning' : 'pass',
        dupes > 0 ? `${dupes} duplicate (SITE CODE, Date) pairs — will be collapsed to latest` : 'No duplicates found');
    }

    // 7. Site code coverage vs DB
    let knownCodes: Set<string> | null = null;
    try {
      const dbRows = await query<{ site_code: string }>('SELECT site_code FROM sites');
      knownCodes = new Set(dbRows.map(r => r.site_code));
    } catch { /* DB unreachable — skip */ }

    if (knownCodes && statusRows && statusRows.length > 0) {
      const fileCodes = new Set<string>();
      for (const row of statusRows) {
        const c = siteCode(row['SITE CODE']);
        if (c) fileCodes.add(c);
      }
      const unknown = Array.from(fileCodes).filter(c => !knownCodes!.has(c));
      const matched = Array.from(fileCodes).filter(c => knownCodes!.has(c));
      if (unknown.length > 0) {
        addCheck('site_codes', 'STATUS REPORT', 'Site codes matched to DB', 'warning',
          `${matched.length} matched, ${unknown.length} unknown (will be skipped): ${unknown.slice(0, 10).join(', ')}`);
      } else {
        addCheck('site_codes', 'STATUS REPORT', 'Site codes matched to DB', 'pass',
          `All ${matched.length} site codes recognised`);
      }
    }

    // 8. NAME INDEX new sites & duplicate names
    const nameIndexRows = sheets['NAME INDEX'];
    if (knownCodes && nameIndexRows && nameIndexRows.length > 0) {
      const fileCodes = new Set<string>();
      for (const row of nameIndexRows) {
        const c = siteCode(row['SITE CODE']);
        if (c) fileCodes.add(c);
      }
      const newSites = Array.from(fileCodes).filter(c => !knownCodes!.has(c));
      addCheck('new_sites', 'NAME INDEX', 'New sites in file', 'pass',
        newSites.length > 0
          ? `${newSites.length} new site(s) will be added: ${newSites.slice(0, 10).join(', ')}`
          : 'No new sites — all already in DB');
    }

    if (nameIndexRows && nameIndexRows.length > 0) {
      const nameToCode = new Map<string, Set<string>>();
      for (const row of nameIndexRows) {
        const code = siteCode(row['SITE CODE']);
        const name = safeStr(row['BUDGET'])?.toUpperCase();
        if (!code || !name) continue;
        if (!nameToCode.has(name)) nameToCode.set(name, new Set());
        nameToCode.get(name)!.add(code);
      }
      const dupNames: string[] = [];
      const examples: string[] = [];
      for (const [name, codes] of Array.from(nameToCode)) {
        if (codes.size > 1) {
          dupNames.push(name);
          if (examples.length < 5) examples.push(`${name} → [${Array.from(codes).join(', ')}]`);
        }
      }
      if (dupNames.length > 0) {
        addCheck('duplicate_names', 'NAME INDEX', 'Duplicate site names with different codes', 'error',
          `${dupNames.length} site name(s) appear under more than one code: ${examples.join('; ')}`);
      } else {
        addCheck('duplicate_names', 'NAME INDEX', 'Duplicate site names with different codes', 'pass',
          'Each site name maps to exactly one code');
      }
    }

    // 9. Blank site codes
    for (const sheetName of ['STATUS REPORT', 'PETROTRADE', 'MARGIN']) {
      const rows = sheets[sheetName];
      if (!rows || rows.length === 0) continue;
      let blank = 0;
      for (const row of rows) {
        if (!safeStr(row['SITE CODE'])) blank++;
      }
      addCheck('blank_site_code', sheetName, `Blank SITE CODEs in "${sheetName}"`,
        blank > 0 ? 'warning' : 'pass',
        blank > 0 ? `${blank} rows with blank SITE CODE (will be skipped)` : 'No blank site codes');
    }

    // 10. Budget months (use allColumns for VOLUME BUDGET)
    const budgetCols = allColumns['VOLUME BUDGET'];
    if (budgetCols && budgetCols.length > 0) {
      const monthCols = budgetCols.filter(c => parseBudgetMonthCol(c) !== null);
      if (monthCols.length > 0) {
        addCheck('budget_months', 'VOLUME BUDGET', 'Budget month columns', 'pass',
          `${monthCols.length} months detected: ${monthCols[0]} → ${monthCols[monthCols.length - 1]}`);
      } else {
        addCheck('budget_months', 'VOLUME BUDGET', 'Budget month columns', 'warning',
          'No month columns found (expected format: Jan-25, Feb-25...)');
      }
    }

    const canIngest = summary.errors === 0;

    return NextResponse.json({
      ok: canIngest,
      canIngest,
      checks,
      summary,
      dateRange,
      sheetRowCounts,
      fileName,
    });

  } catch (err: any) {
    console.error('/api/validate error:', err);
    return NextResponse.json({
      ok: false, canIngest: false, error: err.message,
      checks: [{ id: 'system', sheet: null, title: 'Validator error', status: 'error', detail: err.message }],
      summary: { errors: 1, warnings: 0, passed: 0 },
      sheetRowCounts: {}, dateRange: null,
    }, { status: 500 });
  }
}

const MAINT_REQUIRED_COLS = ['Site', 'Date', 'Cost', 'Category'];

async function validateMaintenance(req: NextRequest): Promise<NextResponse> {
  try {
    const contentType = req.headers.get('content-type') || '';

    let rows: Record<string, any>[];
    let fileName = 'maintenance.xlsx';

    if (contentType.includes('application/json')) {
      const body = await req.json();
      rows = Array.isArray(body.rows) ? body.rows : [];
      fileName = body.fileName || fileName;
    } else {
      const fd = await req.formData();
      const file = fd.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = parseExcelBuffer(buffer);
      const sheetName = parsed.sheetNames[0];
      rows = parsed.sheets[sheetName] || [];
      fileName = file.name;
    }

    const checks: Check[] = [];
    const summary = { errors: 0, warnings: 0, passed: 0 };
    const addCheck = (id: string, sheet: string | null, title: string, status: Check['status'], detail: string) => {
      checks.push({ id, sheet, title, status, detail });
      if (status === 'error') summary.errors++;
      else if (status === 'warning') summary.warnings++;
      else summary.passed++;
    };

    // 1. Row presence
    if (rows.length === 0) {
      addCheck('rm_empty', 'MAINTENANCE', 'Sheet has rows', 'error', 'No rows found in file');
      return NextResponse.json({ ok: false, canIngest: false, checks, summary, fileName });
    }
    addCheck('rm_rows', 'MAINTENANCE', 'Row count', 'pass', `${rows.length.toLocaleString()} rows`);

    // 2. Required columns
    const cols = Object.keys(rows[0]);
    const missing = MAINT_REQUIRED_COLS.filter(c => !cols.includes(c));
    if (missing.length > 0) {
      addCheck('rm_cols', 'MAINTENANCE', 'Required columns', 'error',
        `Missing: ${missing.join(', ')}. Expected: ${MAINT_REQUIRED_COLS.join(', ')}. Found: ${cols.join(', ')}`);
    } else {
      addCheck('rm_cols', 'MAINTENANCE', 'Required columns', 'pass', `All ${MAINT_REQUIRED_COLS.length} columns present`);
    }

    // 3. Date parseable / range
    let bad = 0;
    let minD: string | null = null;
    let maxD: string | null = null;
    for (const r of rows) {
      let d: string | null = parseDate(r['Date']);
      if (!d) {
        d = parseDateDayFirst(r['Date']);
      }
      if (!d) { bad++; continue; }
      if (!minD || d < minD) minD = d;
      if (!maxD || d > maxD) maxD = d;
    }
    if (bad > 0) {
      addCheck('rm_date', 'MAINTENANCE', 'Date column parseable',
        bad < rows.length * 0.05 ? 'warning' : 'error',
        `${bad} unparseable date values out of ${rows.length}`);
    } else {
      addCheck('rm_date', 'MAINTENANCE', 'Date column parseable', 'pass', `All ${rows.length} dates valid`);
    }

    // 4. Cost numeric
    let badCost = 0;
    for (const r of rows) {
      const c = safeFloat(r['Cost']);
      if (c === null || (typeof c === 'number' && isNaN(c))) badCost++;
    }
    if (badCost > 0) {
      addCheck('rm_cost', 'MAINTENANCE', 'Cost column numeric',
        badCost < rows.length * 0.05 ? 'warning' : 'error',
        `${badCost} non-numeric Cost values out of ${rows.length}`);
    } else {
      addCheck('rm_cost', 'MAINTENANCE', 'Cost column numeric', 'pass', `All ${rows.length} costs numeric`);
    }

    // 5. Site coverage vs DB
    try {
      const dbRows = await query<{ site_code: string; budget_name: string }>(
        'SELECT site_code, UPPER(budget_name) AS budget_name FROM sites'
      );
      const nameToCode = new Map(dbRows.map(r => [r.budget_name, r.site_code]));
      const unknownNames = new Set<string>();
      let matched = 0;
      for (const r of rows) {
        const name = safeStr(r['Site'])?.toUpperCase();
        if (!name) continue;
        if (nameToCode.has(name)) matched++;
        else unknownNames.add(name);
      }
      if (unknownNames.size > 0) {
        addCheck('rm_sites', 'MAINTENANCE', 'Sites matched to DB', 'warning',
          `${matched} matched, ${unknownNames.size} unknown (will go to Unmatched Rows): ${Array.from(unknownNames).slice(0, 10).join(', ')}`);
      } else {
        addCheck('rm_sites', 'MAINTENANCE', 'Sites matched to DB', 'pass', `All ${matched} site names recognised`);
      }
    } catch {
      // DB unreachable — skip site check
    }

    const dateRange = minD && maxD ? { from: minD, to: maxD } : null;
    const canIngest = summary.errors === 0;
    return NextResponse.json({ ok: canIngest, canIngest, checks, summary, dateRange, fileName });
  } catch (err: any) {
    console.error('/api/validate (maintenance) error:', err);
    return NextResponse.json({
      ok: false, canIngest: false, error: err.message,
      checks: [{ id: 'system', sheet: null, title: 'Validator error', status: 'error', detail: err.message }],
      summary: { errors: 1, warnings: 0, passed: 0 },
    }, { status: 500 });
  }
}
