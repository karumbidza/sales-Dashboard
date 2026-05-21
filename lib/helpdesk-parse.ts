// lib/helpdesk-parse.ts
// Pure parsers for R&M Helpdesk rows (Freshdesk export).
// Handles M/D/YY date format and H:MM:SS resolution time format with
// arbitrarily large hour values (e.g. 534:31:57 for ~22 days).

import { safeStr, siteCode } from './xlsx-parse';

export interface HelpdeskTicket {
  ticket_id:          number;
  site_code:          string;
  subject:            string;
  status:             string;
  priority:           string | null;
  source:             string | null;
  ticket_group:       string | null;
  agent:              string | null;
  equipment:          string | null;
  service_provider:   string | null;
  created_time:       string;
  due_time:           string | null;
  resolved_time:      string | null;
  closed_time:        string | null;
  resolution_minutes: number | null;
  resolution_status:  string | null;
}

export type ParseReason =
  | 'missing_ticket_id'
  | 'missing_site_code'
  | 'missing_subject'
  | 'bad_created_time';

export interface ParseResult {
  ok:      boolean;
  row?:    HelpdeskTicket;
  reason?: ParseReason;
  raw?:    { ticketId: string | null; siteCode: string | null };
}

// Excel epoch — Dec 30 1899 to compensate for Excel's 1900-leap-year bug.
// For any date from 1900-03-01 onward this gives the correct calendar day.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function fromExcelSerial(serial: number): string | null {
  const ms = EXCEL_EPOCH + serial * 86400000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Robust date parser for the Freshdesk export. Handles multiple formats
// because (a) Freshdesk's text export uses M/D/YY[YY], (b) once you open
// the file in Excel, dates may become Excel-native serials or get
// reformatted to AM/PM / ISO / date-only depending on locale settings.
export function parseHelpdeskDate(v: unknown): string | null {
  if (v == null || v === '') return null;

  // 1. Date object (SheetJS cellDates:true gave a real Date)
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();

  // 2. Excel serial number (cellDates:true couldn't classify the cell)
  if (typeof v === 'number' && isFinite(v) && v > 25000 && v < 100000) {
    return fromExcelSerial(v);
  }

  const s = String(v).trim();
  if (!s) return null;

  // 3. ISO 8601 — "YYYY-MM-DD[ T]HH:MM[:SS][.sss][Z]"
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?$/);
  if (m) {
    const [, y, mo, d, h, min, sec] = m;
    const date = new Date(Date.UTC(
      parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10),
      parseInt(h, 10), parseInt(min, 10), sec ? parseInt(sec, 10) : 0,
    ));
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  // 4. D/M/YY[YY] H:MM[:SS] vs M/D/YY[YY] H:MM[:SS]
  //    Both share the same regex shape; disambiguate by checking if the
  //    "first" position exceeds 12 (then it MUST be the day, so DD/MM).
  //    Otherwise fall back to M/D (Freshdesk default).
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, a, b, y, h, min, sec] = m;
    const aN = parseInt(a, 10);
    const bN = parseInt(b, 10);
    // If a > 12, a must be the day → DD/MM. Otherwise default M/D.
    const isDayFirst = aN > 12 && bN <= 12;
    const mo = isDayFirst ? bN : aN;
    const d  = isDayFirst ? aN : bN;
    const yyyy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
    const date = new Date(Date.UTC(
      yyyy, mo - 1, d,
      parseInt(h, 10), parseInt(min, 10), sec ? parseInt(sec, 10) : 0,
    ));
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  // 5. M/D/YY[YY] h:MM[:SS] AM/PM — Excel-saved locale-formatted text
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (m) {
    const [, mo, d, y, h, min, sec, ampm] = m;
    const yyyy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
    let hour = parseInt(h, 10);
    if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
    if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
    const date = new Date(Date.UTC(
      yyyy, parseInt(mo, 10) - 1, parseInt(d, 10),
      hour, parseInt(min, 10), sec ? parseInt(sec, 10) : 0,
    ));
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  // 6. M/D/YY[YY] — date only, no time
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, mo, d, y] = m;
    const yyyy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
    const date = new Date(Date.UTC(yyyy, parseInt(mo, 10) - 1, parseInt(d, 10)));
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

export function parseResolutionMinutes(v: unknown): number | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const [, h, min, sec] = m;
  return parseInt(h, 10) * 60 + parseInt(min, 10) + Math.round(parseInt(sec, 10) / 60);
}

export function parseHelpdeskRow(raw: Record<string, unknown>): ParseResult {
  const ticketIdRaw = String(raw['Ticket ID'] ?? '').trim();
  const ticketId = Number(ticketIdRaw);
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return { ok: false, reason: 'missing_ticket_id', raw: { ticketId: ticketIdRaw || null, siteCode: null } };
  }

  const sc = siteCode(raw['SITE CODE']);
  // Treat placeholder values ("-", "—", "N/A", "NONE") as missing — they're
  // tickets not initiated from a real site (HQ chatter, test, etc.).
  if (!sc || ['-', '—', 'N/A', 'NA', 'NONE', 'NULL'].includes(sc)) {
    return { ok: false, reason: 'missing_site_code', raw: { ticketId: ticketIdRaw, siteCode: sc } };
  }

  const subject = safeStr(raw['Subject']);
  if (!subject) return { ok: false, reason: 'missing_subject', raw: { ticketId: ticketIdRaw, siteCode: sc } };

  const created = parseHelpdeskDate(raw['Created time']);
  if (!created) return { ok: false, reason: 'bad_created_time', raw: { ticketId: ticketIdRaw, siteCode: sc } };

  return {
    ok: true,
    row: {
      ticket_id:          ticketId,
      site_code:          sc,
      subject,
      status:             safeStr(raw['Status']) ?? 'Open',
      priority:           safeStr(raw['Priority']),
      source:             safeStr(raw['Source']),
      ticket_group:       safeStr(raw['Group']),
      agent:              safeStr(raw['Agent']),
      // Note trailing space in column name — present in the Freshdesk export.
      equipment:          safeStr(raw['Equipment ']) ?? safeStr(raw['Equipment']),
      service_provider:   safeStr(raw['Service provider']),
      created_time:       created,
      due_time:           parseHelpdeskDate(raw['Due by Time']),
      resolved_time:      parseHelpdeskDate(raw['Resolved time']),
      closed_time:        parseHelpdeskDate(raw['Closed time']),
      resolution_minutes: parseResolutionMinutes(raw['Resolution time (in hrs)']),
      resolution_status:  safeStr(raw['Resolution status']),
    },
  };
}

export function parseHelpdeskRows(rows: Record<string, unknown>[]): {
  parsed:  HelpdeskTicket[];
  skipped: { reason: ParseReason; raw: Record<string, unknown> }[];
} {
  const parsed: HelpdeskTicket[] = [];
  const skipped: { reason: ParseReason; raw: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const res = parseHelpdeskRow(r);
    if (res.ok && res.row) parsed.push(res.row);
    else if (res.reason)  skipped.push({ reason: res.reason, raw: r });
  }
  return { parsed, skipped };
}
