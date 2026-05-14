// lib/categorizer-examples.ts
// Loads a balanced few-shot sample from the user's rules + overrides,
// grouped by category. Skips 'other' — we never want examples that
// teach the model to give up.

import { query } from './db';

export interface FewShotMap {
  [categorySlug: string]: string[];
}

export async function loadFewShotExamples(perCategory = 3): Promise<FewShotMap> {
  const rows = await query<{ slug: string; description_norm: string }>(`
    SELECT c.slug, rdc.description_norm
      FROM rm_description_categories rdc
      JOIN rm_categories c ON rdc.category_id = c.id
     WHERE rdc.source IN ('rule', 'override')
       AND c.slug != 'other'
     ORDER BY c.slug, rdc.id
     LIMIT 200
  `);

  const grouped: FewShotMap = {};
  for (const r of rows) {
    if (!grouped[r.slug]) grouped[r.slug] = [];
    if (grouped[r.slug].length < perCategory) grouped[r.slug].push(r.description_norm);
  }
  return grouped;
}
