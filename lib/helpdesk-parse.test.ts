import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHelpdeskRow,
  parseHelpdeskDate,
  parseResolutionMinutes,
} from './helpdesk-parse';

const baseRow = {
  'SITE CODE':                    'RUW-063',
  'Ticket ID':                    '12288',
  'Subject':                      'forecourt canopy lights need attention',
  'Status':                       'Closed',
  'Priority':                     'Urgent',
  'Source':                       'Portal',
  'Group':                        'Reactive Maintenance',
  'Agent':                        'Allen Karumbidza',
  'Equipment ':                   'Canopy',
  'Service provider':             'ACME Engineering',
  'Created time':                 '11/13/25 10:09',
  'Due by Time':                  '11/16/25 10:09',
  'Resolved time':                '2/9/26 13:41',
  'Closed time':                  '2/9/26 13:41',
  'Resolution time (in hrs)':     '534:31:57',
  'Resolution status':            'SLA Violated',
};

test('parseHelpdeskDate: parses M/D/YY H:MM format', () => {
  assert.equal(parseHelpdeskDate('11/13/25 10:09'), '2025-11-13T10:09:00.000Z');
});

test('parseHelpdeskDate: parses M/D/YY H:MM:SS format', () => {
  assert.equal(parseHelpdeskDate('2/9/26 13:41:30'), '2026-02-09T13:41:30.000Z');
});

test('parseHelpdeskDate: parses 4-digit year', () => {
  assert.equal(parseHelpdeskDate('1/15/2027 09:00'), '2027-01-15T09:00:00.000Z');
});

test('parseHelpdeskDate: returns null for null/empty/garbage', () => {
  assert.equal(parseHelpdeskDate(null), null);
  assert.equal(parseHelpdeskDate(''), null);
  assert.equal(parseHelpdeskDate('not a date'), null);
});

test('parseHelpdeskDate: accepts native Date object', () => {
  const d = new Date('2026-05-14T12:00:00Z');
  assert.equal(parseHelpdeskDate(d), '2026-05-14T12:00:00.000Z');
});

test('parseResolutionMinutes: parses H:MM:SS with large hours', () => {
  // 534h 31m 57s ≈ 32072 minutes (57s rounds to 1m)
  assert.equal(parseResolutionMinutes('534:31:57'), 32072);
});

test('parseResolutionMinutes: small values round correctly', () => {
  assert.equal(parseResolutionMinutes('0:28:25'), 28);
  assert.equal(parseResolutionMinutes('1:00:00'), 60);
});

test('parseResolutionMinutes: returns null on bad input', () => {
  assert.equal(parseResolutionMinutes(null), null);
  assert.equal(parseResolutionMinutes(''), null);
  assert.equal(parseResolutionMinutes('not time'), null);
});

test('parseHelpdeskRow: happy path', () => {
  const out = parseHelpdeskRow(baseRow);
  assert.ok(out.ok);
  assert.equal(out.row!.ticket_id, 12288);
  assert.equal(out.row!.site_code, 'RUW-063');
  assert.equal(out.row!.subject, 'forecourt canopy lights need attention');
  assert.equal(out.row!.status, 'Closed');
  assert.equal(out.row!.priority, 'Urgent');
  assert.equal(out.row!.equipment, 'Canopy');
  assert.equal(out.row!.service_provider, 'ACME Engineering');
  assert.equal(out.row!.created_time, '2025-11-13T10:09:00.000Z');
  assert.equal(out.row!.resolution_minutes, 32072);
  assert.equal(out.row!.resolution_status, 'SLA Violated');
});

test('parseHelpdeskRow: uppercases site_code', () => {
  const out = parseHelpdeskRow({ ...baseRow, 'SITE CODE': 'ruw-063' });
  assert.equal(out.row!.site_code, 'RUW-063');
});

test('parseHelpdeskRow: skips when Ticket ID missing or non-numeric', () => {
  assert.equal(parseHelpdeskRow({ ...baseRow, 'Ticket ID': null }).reason, 'missing_ticket_id');
  assert.equal(parseHelpdeskRow({ ...baseRow, 'Ticket ID': 'abc' }).reason, 'missing_ticket_id');
});

test('parseHelpdeskRow: skips when SITE CODE missing', () => {
  assert.equal(parseHelpdeskRow({ ...baseRow, 'SITE CODE': null }).reason, 'missing_site_code');
});

test('parseHelpdeskRow: skips when Subject empty', () => {
  assert.equal(parseHelpdeskRow({ ...baseRow, 'Subject': '   ' }).reason, 'missing_subject');
});

test('parseHelpdeskRow: skips when Created time is unparseable', () => {
  assert.equal(parseHelpdeskRow({ ...baseRow, 'Created time': 'banana' }).reason, 'bad_created_time');
});

test('parseHelpdeskRow: nullable fields tolerated as null', () => {
  const out = parseHelpdeskRow({
    ...baseRow,
    'Service provider':         null,
    'Resolved time':            null,
    'Closed time':              null,
    'Resolution time (in hrs)': null,
    'Resolution status':        null,
  });
  assert.ok(out.ok);
  assert.equal(out.row!.service_provider, null);
  assert.equal(out.row!.resolved_time, null);
  assert.equal(out.row!.closed_time, null);
  assert.equal(out.row!.resolution_minutes, null);
  assert.equal(out.row!.resolution_status, null);
});
