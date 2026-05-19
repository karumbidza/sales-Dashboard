// lib/format-delta.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDelta } from './format-delta';

test('positive value when up is bad → up + bad class', () => {
  const r = formatDelta(4.3, 'down');   // goodDirection = 'down' means down-is-good
  assert.equal(r.direction, 'up');
  assert.equal(r.cls, 'kpi-bad');
  assert.equal(r.magnitude, '4.3');
});

test('negative value when down is good → down + good class', () => {
  const r = formatDelta(-1.1, 'down');
  assert.equal(r.direction, 'down');
  assert.equal(r.cls, 'kpi-good');
  assert.equal(r.magnitude, '1.1');
});

test('zero → flat + dim', () => {
  const r = formatDelta(0, 'down');
  assert.equal(r.direction, 'flat');
  assert.equal(r.cls, 'kpi-dim');
  assert.equal(r.magnitude, '0.0');
});

test('null → flat + dim with em-dash', () => {
  const r = formatDelta(null, 'down');
  assert.equal(r.direction, 'flat');
  assert.equal(r.cls, 'kpi-dim');
  assert.equal(r.magnitude, '—');
});

test('positive value when up is good → up + good class', () => {
  const r = formatDelta(5.7, 'up');
  assert.equal(r.direction, 'up');
  assert.equal(r.cls, 'kpi-good');
});

test('treats sub-1% as flat when threshold=1', () => {
  const r = formatDelta(0.4, 'down', { flatThreshold: 1 });
  assert.equal(r.direction, 'flat');
  assert.equal(r.cls, 'kpi-dim');
  assert.equal(r.magnitude, '0.4');
});
