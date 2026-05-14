import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePattern } from './rm-rules';

test('lowercases input', () => {
  assert.equal(normalizePattern('PUMP'), 'pump');
});

test('trims surrounding whitespace', () => {
  assert.equal(normalizePattern('  pump  '), 'pump');
});

test('collapses internal whitespace runs to a single space', () => {
  assert.equal(normalizePattern('pump\t  truck\n'), 'pump truck');
});

test('strips SQL LIKE wildcards % and _ to avoid runaway matches', () => {
  assert.equal(normalizePattern('pump%'), 'pump');
  assert.equal(normalizePattern('pump_truck'), 'pumptruck');
  assert.equal(normalizePattern('\\backslash'), 'backslash');
});

test('returns empty string for null, undefined, or empty input', () => {
  assert.equal(normalizePattern(null), '');
  assert.equal(normalizePattern(undefined), '');
  assert.equal(normalizePattern(''), '');
  assert.equal(normalizePattern('   '), '');
});
