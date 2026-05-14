// lib/rm-finance-parse.ts
import { parseDate, parseDateDayFirst, safeFloat, safeStr, siteCode } from './xlsx-parse';
import { deriveCostCenter, CostCenter } from './rm-cost-center';

export interface RMInvoiceRow {
  entry_no:        number;
  site_code:       string;
  service_date:    string;        // YYYY-MM-DD
  description:     string;
  debit_lcy:       number;
  credit_lcy:      number;
  document_type:   string | null;
  document_no:     string | null;
  external_doc_no: string | null;
  gl_account_no:   string | null;
  cost_center:     CostCenter;
}

export type ParseReason =
  | 'missing_entry_no'
  | 'missing_site_code'
  | 'bad_date'
  | 'bad_debit'
  | 'missing_description';

export interface ParseResult {
  ok:     boolean;
  row?:   RMInvoiceRow;
  reason?: ParseReason;
  raw?:   { siteCode: string | null; date: string | null };
}

export function parseRMFinanceRow(raw: Record<string, unknown>): ParseResult {
  const entryNo = Number(raw['Entry No.']);
  if (!Number.isFinite(entryNo) || entryNo <= 0) {
    return { ok: false, reason: 'missing_entry_no' };
  }

  const sc = siteCode(raw['SITE CODE']);
  if (!sc) return { ok: false, reason: 'missing_site_code' };

  const date = parseDate(raw['DATE']) ?? parseDateDayFirst(raw['DATE']);
  if (!date) return { ok: false, reason: 'bad_date', raw: { siteCode: sc, date: null } };

  const debit = safeFloat(raw['Debit Amount (LCY)'], null);
  if (debit === null) return { ok: false, reason: 'bad_debit', raw: { siteCode: sc, date } };

  const description = safeStr(raw['Description']);
  if (!description) return { ok: false, reason: 'missing_description', raw: { siteCode: sc, date } };

  return {
    ok: true,
    row: {
      entry_no:        entryNo,
      site_code:       sc,
      service_date:    date,
      description,
      debit_lcy:       debit,
      credit_lcy:      safeFloat(raw['Credit Amount (LCY)'], 0) ?? 0,
      document_type:   safeStr(raw['Document Type']),
      document_no:     safeStr(raw['Document No.']),
      external_doc_no: safeStr(raw['External Document No.']),
      gl_account_no:   safeStr(raw['G/L Account No.']),
      cost_center:     deriveCostCenter(raw as Record<string, unknown>),
    },
  };
}

// Bulk convenience: returns parsed rows + a structured list of skipped rows.
export function parseRMFinanceRows(rows: Record<string, unknown>[]): {
  parsed: RMInvoiceRow[];
  skipped: { reason: ParseReason; raw: Record<string, unknown> }[];
} {
  const parsed: RMInvoiceRow[] = [];
  const skipped: { reason: ParseReason; raw: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const res = parseRMFinanceRow(r);
    if (res.ok && res.row) parsed.push(res.row);
    else if (res.reason)  skipped.push({ reason: res.reason, raw: r });
  }
  return { parsed, skipped };
}
