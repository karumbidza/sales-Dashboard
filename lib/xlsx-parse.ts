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

export function parseExcelBuffer(buffer: Buffer | ArrayBuffer): ParsedSheets {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets: Record<string, Record<string, any>[]> = {};
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
  }
  return { sheetNames: wb.SheetNames, sheets };
}

// ── Date parsing ───────────────────────────────────────────────────────────

export function parseDate(val: any): string | null {
  if (val == null) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseDateDayFirst(val: any): string | null {
  if (val == null) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  // Try DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
