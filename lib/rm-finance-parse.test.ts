// lib/rm-finance-parse.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRMFinanceRow } from './rm-finance-parse';

const baseRow = {
  'SITE CODE': 'MAZ-042',
  'SITE NAME': 'MAZOWE',
  'DATE': '2026-05-07',
  'Document Type': 'Invoice',
  'Document No.': '116351',
  'G/L Account No.': '4725',
  'Description': 'Repaired urinal leak ',
  'Retail Code': 'MAZOWE',
  'Debit Amount (LCY)': 335,
  'Credit Amount (LCY)': 0,
  'Entry No.': 2609805,
  'External Document No.': '1233',
};

test('parses a happy-path retail invoice row', () => {
  const out = parseRMFinanceRow(baseRow);
  assert.ok(out.ok);
  assert.equal(out.row!.entry_no, 2609805);
  assert.equal(out.row!.site_code, 'MAZ-042');
  assert.equal(out.row!.service_date, '2026-05-07');
  assert.equal(out.row!.description, 'Repaired urinal leak');  // trimmed
  assert.equal(out.row!.debit_lcy, 335);
  assert.equal(out.row!.credit_lcy, 0);
  assert.equal(out.row!.cost_center, 'retail');
  assert.equal(out.row!.document_type, 'Invoice');
  assert.equal(out.row!.document_no, '116351');
});

test('uppercases site_code', () => {
  const out = parseRMFinanceRow({ ...baseRow, 'SITE CODE': 'maz-042' });
  assert.equal(out.row!.site_code, 'MAZ-042');
});

test('skips row when Entry No. is missing', () => {
  const out = parseRMFinanceRow({ ...baseRow, 'Entry No.': null });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'missing_entry_no');
});

test('skips row when Date is unparseable', () => {
  const out = parseRMFinanceRow({ ...baseRow, 'DATE': 'banana' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'bad_date');
});

test('skips row when Debit (LCY) is missing or non-numeric', () => {
  assert.equal(parseRMFinanceRow({ ...baseRow, 'Debit Amount (LCY)': null }).reason, 'bad_debit');
  assert.equal(parseRMFinanceRow({ ...baseRow, 'Debit Amount (LCY)': 'abc' }).reason, 'bad_debit');
});

test('skips row when Description is empty', () => {
  assert.equal(parseRMFinanceRow({ ...baseRow, 'Description': '   ' }).reason, 'missing_description');
});

test('derives non-retail cost center', () => {
  const out = parseRMFinanceRow({
    ...baseRow, 'Retail Code': null, 'Head office Code': 'ADMINISTRATION',
  });
  assert.equal(out.row!.cost_center, 'head_office');
});

test('accepts Excel Date object as service_date', () => {
  const out = parseRMFinanceRow({ ...baseRow, 'DATE': new Date('2026-05-07T10:00:00Z') });
  assert.equal(out.row!.service_date, '2026-05-07');
});
