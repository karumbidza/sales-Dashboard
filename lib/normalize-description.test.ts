// lib/normalize-description.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDescription } from './normalize-description';

test('lowercases', () => {
  assert.equal(normalizeDescription('Repaired Urinal Leak'), 'repaired urinal leak');
});

test('trims and collapses whitespace', () => {
  assert.equal(normalizeDescription('  plumbing   works  '), 'plumbing works');
});

test('collapses tabs/newlines as whitespace', () => {
  assert.equal(normalizeDescription('a\tb\nc'), 'a b c');
});

test('returns empty string for empty input', () => {
  assert.equal(normalizeDescription(''), '');
});

test('handles null/undefined as empty string', () => {
  assert.equal(normalizeDescription(null as any), '');
  assert.equal(normalizeDescription(undefined as any), '');
});
