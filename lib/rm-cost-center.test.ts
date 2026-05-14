// lib/rm-cost-center.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCostCenter } from './rm-cost-center';

test('retail when Retail Code is filled', () => {
  assert.equal(deriveCostCenter({ 'Retail Code': 'MAZOWE' }), 'retail');
});

test('head_office when only Head office Code is filled', () => {
  assert.equal(deriveCostCenter({ 'Head office Code': 'ADMINISTRATION' }), 'head_office');
});

test('commercial when only Commercial Code is filled', () => {
  assert.equal(deriveCostCenter({ 'Commercial Code': 'COMM' }), 'commercial');
});

test('supply_chain, projects, lubricants, hsse, non_redan_sites mapped correctly', () => {
  assert.equal(deriveCostCenter({ 'Supply Chain Code': 'SC' }),    'supply_chain');
  assert.equal(deriveCostCenter({ 'Projects Code': 'P' }),         'projects');
  assert.equal(deriveCostCenter({ 'Lubricants Code': 'L' }),       'lubricants');
  assert.equal(deriveCostCenter({ 'Hsse Code': 'H' }),             'hsse');
  assert.equal(deriveCostCenter({ 'Non redan sites Code': 'NR' }), 'non_redan_sites');
});

test('retail wins when multiple codes are filled (priority order)', () => {
  assert.equal(
    deriveCostCenter({ 'Retail Code': 'MAZOWE', 'Head office Code': 'ADMIN' }),
    'retail',
  );
});

test('returns "other" when no code is filled', () => {
  assert.equal(deriveCostCenter({}), 'other');
  assert.equal(deriveCostCenter({ 'Retail Code': null, 'Commercial Code': '' }), 'other');
});

test('treats whitespace-only strings as empty', () => {
  assert.equal(deriveCostCenter({ 'Retail Code': '   ', 'Head office Code': 'HQ' }), 'head_office');
});
