// lib/categorizer.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeBatch, CategorizerClient, CATEGORY_SLUGS } from './categorizer';

function mockClient(canned: { id: number; category: string; confidence: string }[]): CategorizerClient {
  return {
    async classify(items, _systemPrompt) {
      // Return canned data ignoring the actual input (caller supplies matching ids).
      return { results: canned } as any;
    },
  };
}

test('high confidence: writes category and confidence verbatim', async () => {
  const client = mockClient([{ id: 1, category: 'plumbing_water_waste', confidence: 'high' }]);
  const out = await categorizeBatch(client, [{ id: 1, description: 'Repaired urinal leak' }], 'test-prompt');
  assert.deepEqual(out, [
    { id: 1, slug: 'plumbing_water_waste', confidence: 'high', needs_review: false },
  ]);
});

test('medium confidence: needs_review = false', async () => {
  const client = mockClient([{ id: 1, category: 'plumbing_water_waste', confidence: 'medium' }]);
  const out = await categorizeBatch(client, [{ id: 1, description: 'works' }], 'test-prompt');
  assert.equal(out[0].needs_review, false);
});

test('low confidence: needs_review = true', async () => {
  const client = mockClient([{ id: 1, category: 'plumbing_water_waste', confidence: 'low' }]);
  const out = await categorizeBatch(client, [{ id: 1, description: 'works' }], 'test-prompt');
  assert.equal(out[0].needs_review, true);
});

test('unknown category slug from model → falls back to other + needs_review', async () => {
  const client = mockClient([{ id: 1, category: 'nonexistent_bucket', confidence: 'high' }]);
  const out = await categorizeBatch(client, [{ id: 1, description: 'x' }], 'test-prompt');
  assert.equal(out[0].slug, 'other');
  assert.equal(out[0].needs_review, true);
});

test('client error propagates', async () => {
  const client: CategorizerClient = {
    async classify(_items, _systemPrompt) { throw new Error('rate_limit'); },
  };
  await assert.rejects(
    () => categorizeBatch(client, [{ id: 1, description: 'x' }], 'test-prompt'),
    /rate_limit/,
  );
});

test('CATEGORY_SLUGS list matches the seed taxonomy', () => {
  const expected = [
    'pumps_dispensers', 'compressors_air', 'tanks_lines', 'generators',
    'solar_ups', 'electrical_lighting', 'plumbing_water_waste', 'building_civil',
    'canopy_signage', 'landscaping_grounds', 'fire_safety', 'security_cctv', 'other',
  ];
  assert.deepEqual(CATEGORY_SLUGS, expected);
});

test('missing id in model response → falls back to other + needs_review for that row only', async () => {
  // Caller asked for ids [1,2] but model returned only id 1
  const client = mockClient([{ id: 1, category: 'plumbing_water_waste', confidence: 'high' }]);
  const out = await categorizeBatch(client, [
    { id: 1, description: 'a' },
    { id: 2, description: 'b' },
  ], 'test-prompt');
  assert.equal(out.length, 2);
  assert.equal(out[1].slug, 'other');
  assert.equal(out[1].needs_review, true);
});
