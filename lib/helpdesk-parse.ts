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

export function parseHelpdeskDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, mo, d, y, h, min, sec] = m;
  const yyyy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  const date = new Date(Date.UTC(
    yyyy,
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    parseInt(h, 10),
    parseInt(min, 10),
    sec ? parseInt(sec, 10) : 0,
  ));
  return isNaN(date.getTime()) ? null : date.toISOString();
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
  if (!sc) return { ok: false, reason: 'missing_site_code', raw: { ticketId: ticketIdRaw, siteCode: null } };

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
