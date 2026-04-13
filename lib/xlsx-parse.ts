// lib/xlsx-parse.ts
// Pure-TypeScript Excel parsing using SheetJS (xlsx).
// Replaces Python scripts for Vercel compatibility.

import * as XLSX from 'xlsx';

// ── Helpers ────────────────────────────────────────────────────────────────

export function safeFloat(val: any, defaultVal: number | null = 0): number | null {
  if (val == null || val === '' || (typeof val === 'number' && isNaN(val))) return defaultVal;
  const n = Number(val);
  return isNaN(n) ? defaultVal : n;
}

export function safeStr(val: any): string | null {
  if (val == null || val === '') return null;
  return String(val).trim();
}

export function siteCode(val: any): string | null {
  const s = safeStr(val);
  return s ? s.toUpperCase() : null;
}

const MONTH_MAP: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

export function parseBudgetMonthCol(colName: string): string | null {
  const parts = String(colName).split('-');
  if (parts.length !== 2) return null;
  const m = MONTH_MAP[parts[0]];
  if (!m) return null;
  const y = parts[1].length === 2 ? 2000 + parseInt(parts[1]) : parseInt(parts[1]);
  if (isNaN(y)) return null;
  const mm = String(m).padStart(2, '0');
  return `${y}-${mm}-01`;
}

// ── Parse helpers ──────────────────────────────────────────────────────────

export interface ParsedSheets {
  sheetNames: string[];
  sheets: Record<string, Record<string, any>[]>;
}

// Excel serial number → YYYY-MM-DD (Excel epoch = 1899-12-30)
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function excelSerialToISO(serial: number): string {
  const ms = EXCEL_EPOCH + serial * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function parseExcelBuffer(buffer: Buffer | ArrayBuffer): ParsedSheets {
  // Read WITHOUT cellDates to avoid SheetJS timezone bugs (dates off by 1 day)
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheets: Record<string, Record<string, any>[]> = {};
  for (const name of wb.SheetNames) {
    // Detect date-formatted columns
    const ws = wb.Sheets[name];
    const dateColSet = new Set<string>();
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let c = range.s.c; c <= range.e.c; c++) {
      const headerCell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
      const dataCell = ws[XLSX.utils.encode_cell({ r: range.s.r + 1, c })];
      const colName = headerCell?.v != null ? String(headerCell.v) : '';
      if (!colName || !dataCell || dataCell.t !== 'n') continue;
      // Detect date columns by: format string, display text, or column name
      const isDate = (dataCell.z && /[dmy]/i.test(dataCell.z))
        || (dataCell.w && /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(dataCell.w))
        || /^date$/i.test(colName.trim());
      if (isDate) dateColSet.add(colName);
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: null });
    // Convert date serial numbers to YYYY-MM-DD strings
    for (const row of rows) {
      for (const col of Array.from(dateColSet)) {
        const v = row[col];
        if (typeof v === 'number' && v > 30000 && v < 100000) {
          row[col] = excelSerialToISO(v);
        }
      }
    }
    sheets[name] = rows;
  }
  return { sheetNames: wb.SheetNames, sheets };
}

// ── Compact format conversion (for client-side parsed data) ────────────────

export function compactToSheets(
  compact: Record<string, { columns: string[]; data: any[][] }>
): { sheetNames: string[]; sheets: Record<string, Record<string, any>[]> } {
  const sheetNames = Object.keys(compact);
  const sheets: Record<string, Record<string, any>[]> = {};
  for (const [name, { columns, data }] of Object.entries(compact)) {
    sheets[name] = data.map(row =>
      Object.fromEntries(columns.map((col, i) => [col, row[i] ?? null]))
    );
  }
  return { sheetNames, sheets };
}

// ── Date parsing ───────────────────────────────────────────────────────────

// Format a Date as local YYYY-MM-DD (avoids toISOString UTC shift)
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDate(val: any): string | null {
  if (val == null) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return localISO(val);
  }
  const s = String(val).trim();
  // If already YYYY-MM-DD, return as-is (no Date conversion needed)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // If ISO string with time, extract the date part
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return localISO(d);
}

export function parseDateDayFirst(val: any): string | null {
  if (val == null) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return localISO(val);
  }
  const s = String(val).trim();
  // If already YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  // Try DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return localISO(d);
}
