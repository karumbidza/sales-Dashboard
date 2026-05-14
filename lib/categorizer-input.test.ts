import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanForAI } from './categorizer-input';

test('returns empty string for null/undefined/empty input', () => {
  assert.equal(cleanForAI(null), '');
  assert.equal(cleanForAI(undefined), '');
  assert.equal(cleanForAI(''), '');
});

test('passes through descriptions without site-name prefix', () => {
  assert.equal(cleanForAI('supply 3/4 swivel'), 'supply 3/4 swivel');
  assert.equal(cleanForAI('repair broken sink basin'), 'repair broken sink basin');
});

test('strips lowercase site prefix with colon', () => {
  assert.equal(
    cleanForAI('luveve: supply 3/4" swievel, nozzle jackets'),
    'supply 3/4" swievel, nozzle jackets',
  );
});

test('strips abbreviated site prefix with period', () => {
  assert.equal(
    cleanForAI('lib. supply and installation leaks on breakaway'),
    'supply and installation leaks on breakaway',
  );
});

test('strips hyphenated site code prefix', () => {
  assert.equal(
    cleanForAI('ARD-001: zva nozzle replacement'),
    'zva nozzle replacement',
  );
});

test('strips ticket and order references mid-string', () => {
  assert.equal(
    cleanForAI('repairs tkt# 9859 collapsed soakway'),
    'repairs collapsed soakway',
  );
  assert.equal(
    cleanForAI('TICKET 1234 fix leak'),
    'fix leak',
  );
});

test('collapses runs of whitespace and trims', () => {
  assert.equal(cleanForAI('   foo \t\n bar   '), 'foo bar');
});
