# AI Categorizer v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude actually pick specific categories instead of dumping everything in `other/low` by cleaning the input, teaching the domain vocabulary, and showing examples from the user's own rules + overrides.

**Architecture:** Add a pure-JS `cleanForAI()` cleaner that strips site-name prefixes and ticket refs before Claude sees the description. Refactor the categorizer prompt into base + glossary + dynamic few-shot + instructions, with examples loaded from `source IN ('rule', 'override')` rows. Add a one-click `Re-categorize Other` button that flips `source='ai' AND category=other` rows to `pending` so the cron drains them with the new prompt.

**Tech Stack:** TypeScript, Next.js 14, Postgres, Anthropic SDK (`@anthropic-ai/sdk`), `node:test` for unit tests.

**Spec reference:** `docs/superpowers/specs/2026-05-14-ai-categorizer-v2-design.md`

---

## File Map

**Create:**
- `lib/categorizer-input.ts` — `cleanForAI()` pure function
- `lib/categorizer-input.test.ts` — 6 unit tests
- `lib/categorizer-examples.ts` — `loadFewShotExamples()` DB helper (no unit tests; integration-tested via routes)
- `app/api/maintenance/recategorize-other/route.ts` — new POST endpoint

**Modify:**
- `lib/categorizer.ts` — split system prompt into constants, add `buildSystemPrompt()`, wire `cleanForAI()` into the message body
- `app/api/maintenance/categorize-batch/route.ts` — load examples, pass to client
- `app/api/maintenance/rules/route.ts` — add `otherCount` to the GET response
- `app/dashboard/maintenance/rules/page.tsx` — render Re-categorize panel + wire `CategorizationProgress`

---

## Task 1: cleanForAI helper + tests

**Files:**
- Create: `lib/categorizer-input.ts`
- Create: `lib/categorizer-input.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/categorizer-input.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: failures referencing `Cannot find module './categorizer-input'`.

- [ ] **Step 3: Implement to make tests pass**

Create `lib/categorizer-input.ts`:

```typescript
// lib/categorizer-input.ts
// Pre-AI text cleaner. Strips noise that confuses Claude without
// changing what we store in the DB.
//
// The cleaner is intentionally conservative — if a strip would
// empty the string, the call site (categorizer.ts) falls back
// to the original description.

export function cleanForAI(description: string | null | undefined): string {
  if (!description) return '';
  let s = String(description);

  // 1. Strip leading site-name prefix: a short token followed by ':' or '.'
  //    Matches: 'luveve:', 'lib.', 'c.valley:', 'ARD-001:'
  //    Does NOT match free text: 'supply', 'repair' (no trailing punctuation)
  s = s.replace(/^[a-z0-9][\w.-]{0,15}[:.]\s+/i, '');

  // 2. Strip ticket / order references anywhere in the string.
  s = s.replace(/\b(?:tkt|ticket|ord(?:er)?)\s*#?\s*\d+/gi, '');

  // 3. Collapse whitespace and trim.
  return s.replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: 41 tests pass, 0 fail (34 prior + 7 new).

- [ ] **Step 5: Commit**

```bash
git add lib/categorizer-input.ts lib/categorizer-input.test.ts
git commit -m "feat: add cleanForAI helper for pre-AI input normalization"
```

---

## Task 2: Few-shot example loader

**Files:**
- Create: `lib/categorizer-examples.ts`

- [ ] **Step 1: Implement the loader**

Create `lib/categorizer-examples.ts`:

```typescript
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
     ORDER BY random()
     LIMIT 200
  `);

  const grouped: FewShotMap = {};
  for (const r of rows) {
    if (!grouped[r.slug]) grouped[r.slug] = [];
    if (grouped[r.slug].length < perCategory) grouped[r.slug].push(r.description_norm);
  }
  return grouped;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Verify it returns data**

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  npx tsx -e "
import { loadFewShotExamples } from './lib/categorizer-examples';
loadFewShotExamples().then(grouped => {
  for (const [slug, descs] of Object.entries(grouped)) {
    console.log('--- ' + slug + ' (' + descs.length + ') ---');
    descs.forEach(d => console.log('  ' + d));
  }
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: a printout grouped by category. Should show at least 3 categories with 1-3 examples each (depends on what user has authored). If the output is empty `{}`, the user has zero rules/overrides — acceptable, the system will fall back to glossary-only prompting.

- [ ] **Step 4: Commit**

```bash
git add lib/categorizer-examples.ts
git commit -m "feat: add loadFewShotExamples for AI categorizer prompt"
```

---

## Task 3: Refactor categorizer.ts prompt into modular parts + buildSystemPrompt

**Files:**
- Modify: `lib/categorizer.ts`

This task restructures the prompt to support the new glossary and few-shot sections. The categorizer interface stays the same.

- [ ] **Step 1: Replace the SYSTEM_PROMPT constant with three smaller constants**

In `lib/categorizer.ts`, locate the current `SYSTEM_PROMPT` definition:

```typescript
const SYSTEM_PROMPT = `You categorize R&M (repairs & maintenance) invoice descriptions for a
fuel-station retail business in Zimbabwe. You will receive a list of
descriptions and must assign each to exactly ONE of these categories:
...
Return strict JSON via the provided tool. No prose.`;
```

Replace the entire block (from `const SYSTEM_PROMPT` through its closing backtick + semicolon) with:

```typescript
// Static base — the category list and high-level instructions.
const BASE_PROMPT = `You categorize R&M (repairs & maintenance) invoice
descriptions for a fuel-station retail business in Zimbabwe. You will
receive a list of descriptions and must assign each to exactly ONE of
these categories.

CATEGORIES:
  pumps_dispensers     — Dispensers, fuel nozzles, hoses, STP, shear/breakaway valves
  compressors_air      — Air compressors, compressor motors, pressure gauges, V-belts
  tanks_lines          — Underground tanks, fuel lines, manholes, ATG, dipsticks, bunding, line testing, oil separators
  generators           — Gensets, generator service & repair
  solar_ups            — Solar panels, inverters, batteries, UPS
  electrical_lighting  — Wiring, sockets, fault clearing, isolators, day-night switches, lights, cabling
  plumbing_water_waste — Leaks, toilets, urinals, sinks, sprinklers, waste disposal, boreholes, drainage
  building_civil       — Paint, roof, doors, windows, tiles, paving, locksets, safes, HVAC, strongroom doors
  canopy_signage       — Canopy structure, signage, illumination, display boards
  landscaping_grounds  — Garden, grass, trees, hedging
  fire_safety          — Extinguishers, fire equipment
  security_cctv        — CCTV, alarms, fences, gates
  other                — TRULY no fit. Use sparingly.`;

// Domain terminology unique to Zimbabwean fuel-station maintenance.
// The model does not know these out-of-the-box.
const GLOSSARY = `DOMAIN GLOSSARY (Zimbabwean fuel-station terminology):
  ZVA          — automatic nozzle type → pumps_dispensers
  breakaway    — emergency disconnect on dispenser hose → pumps_dispensers
  swivel       — rotating hose fitting → pumps_dispensers
  grip lock    — anti-theft nozzle clip → pumps_dispensers
  STP / submersible — fuel tank pump → tanks_lines
  ATG          — automatic tank gauge → tanks_lines
  soakway      — drainage pit → plumbing_water_waste
  oil separator — wastewater treatment → tanks_lines
  bunding      — concrete containment around tanks → tanks_lines
  day-night switch — photocell light switch → electrical_lighting
  canopy       — overhead roof at fuel pumps → canopy_signage
  forecourt    — open service area (context only, not a category)`;

// Final instructions block — explicit anti-other bias.
const INSTRUCTIONS = `INSTRUCTIONS:
1. Look for keywords matching the glossary or category descriptions above.
2. Pick the BEST match. Only use 'other' if NO category fits — even loosely.
3. Rate confidence:
   - high: description directly names something in the category
   - medium: strong implication from context
   - low: an educated guess; surface for human review

Return strict JSON via the categorize tool. No prose.`;

import type { FewShotMap } from './categorizer-examples';

export function buildSystemPrompt(examples: FewShotMap): string {
  const exampleSections = Object.entries(examples)
    .filter(([, descs]) => descs.length > 0)
    .map(([slug, descs]) => {
      const lines = descs.map(d => `  - "${d}"`).join('\n');
      return `${slug}:\n${lines}`;
    })
    .join('\n\n');

  const examplesBlock = exampleSections
    ? `EXAMPLES OF CORRECT CATEGORIZATION (from past invoices):\n\n${exampleSections}\n\n`
    : '';

  return `${BASE_PROMPT}\n\n${GLOSSARY}\n\n${examplesBlock}${INSTRUCTIONS}`;
}
```

- [ ] **Step 2: Update the `CategorizerClient.classify` interface to accept the prompt**

The current `CategorizerClient` interface and `createClaudeClient` function pass the prompt internally. Refactor so the caller passes the system prompt explicitly. Locate this block in `lib/categorizer.ts`:

```typescript
export interface CategorizerClient {
  classify(items: CategorizerInput[]): Promise<ClassifyResponse>;
}
```

Replace with:

```typescript
export interface CategorizerClient {
  classify(items: CategorizerInput[], systemPrompt: string): Promise<ClassifyResponse>;
}
```

- [ ] **Step 3: Update `categorizeBatch` to accept and forward the prompt**

Locate:

```typescript
export async function categorizeBatch(
  client: CategorizerClient,
  items: CategorizerInput[],
): Promise<CategorizerOutput[]> {
  const resp = await client.classify(items);
```

Replace the signature and the first call with:

```typescript
export async function categorizeBatch(
  client: CategorizerClient,
  items: CategorizerInput[],
  systemPrompt: string,
): Promise<CategorizerOutput[]> {
  const resp = await client.classify(items, systemPrompt);
```

- [ ] **Step 4: Update `createClaudeClient` to accept the system prompt per call and wire `cleanForAI`**

Locate the existing `createClaudeClient` function (uses `SYSTEM_PROMPT` and `TOOL`). Replace the whole function with:

```typescript
import { cleanForAI } from './categorizer-input';

export function createClaudeClient(apiKey: string): CategorizerClient {
  // Lazy-import the SDK so tests do not need it loaded.
  const Anthropic = require('@anthropic-ai/sdk').default;
  const sdk = new Anthropic({ apiKey });

  return {
    async classify(items, systemPrompt) {
      // Send the cleaned description to Claude; keep the original id mapping.
      // If cleanForAI empties a description, fall back to the original.
      const cleanedItems = items.map(it => ({
        id: it.id,
        description: cleanForAI(it.description) || it.description,
      }));

      const resp = await sdk.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        system: [
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
        ],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'categorize' },
        messages: [{
          role: 'user',
          content: JSON.stringify(cleanedItems),
        }],
      });
      const block = (resp.content as any[]).find(b => b.type === 'tool_use' && b.name === 'categorize');
      if (!block) throw new Error('Claude did not return the categorize tool call');
      return block.input as ClassifyResponse;
    },
  };
}
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: TypeScript errors at the existing call site in `app/api/maintenance/categorize-batch/route.ts` (it calls `categorizeBatch(client, items)` without the third argument). That is expected — Task 4 fixes it.

If the only errors are in `categorize-batch/route.ts`, proceed. If there are errors anywhere else in this file or in `lib/categorizer.test.ts`, stop and report.

- [ ] **Step 6: Update categorizer.test.ts to match new signature**

The existing categorizer tests pass a stub client and call `categorizeBatch(client, items)`. Open `lib/categorizer.test.ts`. The stub `client.classify` currently has signature `(items: ...) => Promise<...>`. Update each `client` stub to accept and ignore a second arg, and update each `categorizeBatch` call to pass a third arg.

Find each occurrence of `categorizeBatch(client, items)` in the test file and replace with `categorizeBatch(client, items, 'test-prompt')`.

Find each `classify(items)` arrow function and update its signature. For example:

```typescript
// before:
const client: CategorizerClient = {
  classify: async (items) => ({ results: [...] }),
};
// after:
const client: CategorizerClient = {
  classify: async (items, _systemPrompt) => ({ results: [...] }),
};
```

Apply this to every stub in the test file.

- [ ] **Step 7: Run tests**

```bash
npm test
```

Expected: 41 tests pass (no regression).

- [ ] **Step 8: Commit**

```bash
git add lib/categorizer.ts lib/categorizer.test.ts
git commit -m "refactor: split categorizer prompt into base + glossary + few-shot + instructions"
```

---

## Task 4: Wire categorize-batch route to use the new prompt

**Files:**
- Modify: `app/api/maintenance/categorize-batch/route.ts`

- [ ] **Step 1: Import the new helpers**

Open `app/api/maintenance/categorize-batch/route.ts`. The current imports include:

```typescript
import {
  categorizeBatch,
  createClaudeClient,
  CategorizerClient,
  CLAUDE_MODEL,
} from '@/lib/categorizer';
```

Replace with:

```typescript
import {
  categorizeBatch,
  createClaudeClient,
  CategorizerClient,
  CLAUDE_MODEL,
  buildSystemPrompt,
} from '@/lib/categorizer';
import { loadFewShotExamples } from '@/lib/categorizer-examples';
```

- [ ] **Step 2: Load examples and build the prompt before calling Claude**

In the `POST` handler, locate the section between the `pending` query and the `categorizeBatch` call:

```typescript
    const client = getClient();
    const verdicts = await categorizeBatch(
      client,
      pending.map(p => ({ id: p.id, description: p.description_norm })),
    );
```

Replace it with:

```typescript
    const client = getClient();
    const examples = await loadFewShotExamples();
    const systemPrompt = buildSystemPrompt(examples);

    const verdicts = await categorizeBatch(
      client,
      pending.map(p => ({ id: p.id, description: p.description_norm })),
      systemPrompt,
    );
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no output. (The Task 3 errors should be resolved.)

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: 41 tests pass.

- [ ] **Step 5: Smoke test the endpoint locally**

Start dev server: `npm run dev`. Wait for ✓ Ready.

```bash
# Pick a pending row, run the new prompt on it
curl -s -X POST http://localhost:3000/api/maintenance/categorize-batch \
  -H 'Content-Type: application/json' -d '{}'
```

Expected: a response `{processed: N, remaining: M}` where N is up to 50. (If there are currently 0 pending rows, N will be 0 — that's fine; Task 5 will create pending rows for testing.)

Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add app/api/maintenance/categorize-batch/route.ts
git commit -m "feat: load few-shot examples and use buildSystemPrompt in categorize-batch"
```

---

## Task 5: POST /api/maintenance/recategorize-other endpoint

**Files:**
- Create: `app/api/maintenance/recategorize-other/route.ts`

- [ ] **Step 1: Implement the endpoint**

Create `app/api/maintenance/recategorize-other/route.ts`:

```typescript
// app/api/maintenance/recategorize-other/route.ts
// One-click flip: every rm_description_categories row that the AI put
// in `other` goes back to `pending` so the cron (or client drain)
// re-categorizes it with the new prompt. Never touches override or
// rule rows — those are user-authoritative.
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await query<{ id: number }>(`
      UPDATE rm_description_categories
         SET source       = 'pending',
             confidence   = NULL,
             needs_review = FALSE,
             updated_at   = NOW()
       WHERE source = 'ai'
         AND category_id = (SELECT id FROM rm_categories WHERE slug = 'other')
       RETURNING id
    `);
    return NextResponse.json({ flipped: result.length });
  } catch (err: any) {
    console.error('/api/maintenance/recategorize-other error:', err);
    return NextResponse.json({ error: err.message || 'flip failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify end-to-end**

Start dev server. Confirm pre-state:

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -c "SELECT source, COUNT(*) FROM rm_description_categories GROUP BY source ORDER BY 1;"
```

Note the `ai` count and `pending` count.

Run the flip:

```bash
curl -s -X POST http://localhost:3000/api/maintenance/recategorize-other
```

Expected: `{"flipped":N}` where N matches the number of `ai` + `other` rows.

Re-check state:

```bash
psql "$DATABASE_URL" -c "SELECT source, COUNT(*) FROM rm_description_categories GROUP BY source ORDER BY 1;"
```

Expected: `pending` grew by N. `ai` dropped by N. `override` and `rule` unchanged.

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/recategorize-other/route.ts
git commit -m "feat: add POST /api/maintenance/recategorize-other for one-click flip"
```

---

## Task 6: Extend GET /api/maintenance/rules with otherCount

**Files:**
- Modify: `app/api/maintenance/rules/route.ts`

- [ ] **Step 1: Add an otherCount query and include in response**

In `app/api/maintenance/rules/route.ts`, locate the `GET` handler. The current return value is `{data: rows.map(...)}`. Modify the function body to also query the `other` count and include it.

Find this block:

```typescript
export async function GET() {
  try {
    const rows = await query<any>(`
      SELECT r.id, r.pattern, ...
    `);

    return NextResponse.json({
      data: rows.map(r => ({
        ...
      })),
    });
  } catch (err: any) {
    ...
  }
}
```

Replace with:

```typescript
export async function GET() {
  try {
    const rows = await query<any>(`
      SELECT r.id, r.pattern, r.is_active, r.notes, r.created_at, r.updated_at,
             c.slug AS category_slug, c.display_name AS category_name,
             COUNT(rdc.description_norm)::INT AS match_count
        FROM rm_keyword_rules r
        JOIN rm_categories c ON r.category_id = c.id
        LEFT JOIN rm_description_categories rdc
          ON r.is_active = TRUE
         AND rdc.description_norm LIKE '%' || lower(r.pattern) || '%'
       GROUP BY r.id, c.slug, c.display_name
       ORDER BY LENGTH(r.pattern) DESC, r.id
    `);

    const otherRows = await query<{ n: string }>(`
      SELECT COUNT(*)::TEXT AS n
        FROM rm_description_categories
       WHERE source = 'ai'
         AND category_id = (SELECT id FROM rm_categories WHERE slug = 'other')
    `);
    const otherCount = parseInt(otherRows[0]?.n || '0', 10);

    return NextResponse.json({
      otherCount,
      data: rows.map(r => ({
        id:           r.id,
        pattern:      r.pattern,
        categorySlug: r.category_slug,
        categoryName: r.category_name,
        isActive:     r.is_active,
        notes:        r.notes,
        matchCount:   r.match_count,
        createdAt:    r.created_at,
        updatedAt:    r.updated_at,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/rules GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify**

```bash
npm run dev
curl -s http://localhost:3000/api/maintenance/rules | head -c 200
```

Expected: response contains `"otherCount":` at the top level.

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/rules/route.ts
git commit -m "feat: return otherCount from GET /api/maintenance/rules"
```

---

## Task 7: Re-categorize panel on the Rules page

**Files:**
- Modify: `app/dashboard/maintenance/rules/page.tsx`

- [ ] **Step 1: Import CategorizationProgress and add state**

Open `app/dashboard/maintenance/rules/page.tsx`. Add the import near the top with the other imports:

```typescript
import CategorizationProgress from '@/components/maintenance/CategorizationProgress';
```

Inside `RulesPageInner`, find the state declarations. Add two more lines after the existing `editing` state:

```typescript
  const [otherCount,    setOtherCount]    = useState(0);
  const [recategorizing, setRecategorizing] = useState<null | { pending: number }>(null);
```

- [ ] **Step 2: Populate otherCount from refetch**

Find the `refetch` function. The current implementation reads `rRes?.data || []`. Update it to also read `otherCount`:

```typescript
  const refetch = async () => {
    setLoading(true); setError(null);
    try {
      const [rRes, cRes] = await Promise.all([
        fetch('/api/maintenance/rules').then(r => r.json()),
        fetch('/api/maintenance/categories-list').then(r => r.json()),
      ]);
      setRules(rRes?.data || []);
      setOtherCount(rRes?.otherCount || 0);
      setCats(cRes?.data || []);
    } catch (e: any) {
      setError(e.message || 'load failed');
    } finally {
      setLoading(false);
    }
  };
```

- [ ] **Step 3: Add recategorize handler**

After the `deleteRule` function and before `return (`, add:

```typescript
  const recategorizeOther = async () => {
    const ok = window.confirm(
      `Re-categorize ${otherCount.toLocaleString()} descriptions currently in "Other"?\n\n` +
      `This will re-run the AI with the smarter prompt and your rules/overrides. ` +
      `Estimated cost: $0.50–$1 in Claude API.`,
    );
    if (!ok) return;
    const res = await fetch('/api/maintenance/recategorize-other', { method: 'POST' });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'recategorize failed');
      return;
    }
    const { flipped } = await res.json();
    setRecategorizing({ pending: flipped });
  };
```

- [ ] **Step 4: Render the panel below the rules table**

In the `RulesPageInner` JSX, find the closing `</div>` of the rules-card. Add a new card after it, before `</main>`:

Find this section:

```tsx
          {!loading && (
            <table className="w-full text-xs">
              ...
            </table>
          )}
        </div>
      </main>
```

Replace with:

```tsx
          {!loading && (
            <table className="w-full text-xs">
              {/* existing table content unchanged */}
              <thead className="border-b">
                <tr className="text-left text-gray-500 uppercase">
                  <th className="px-3 py-2">Pattern</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Matches</th>
                  <th className="px-3 py-2 text-center">Active</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    cats={cats}
                    editing={editing === r.id}
                    onEdit={() => setEditing(r.id)}
                    onCancel={() => setEditing(null)}
                    onSave={(pattern, slug) => updateRule(r.id, { pattern, category_slug: slug })}
                    onToggle={() => updateRule(r.id, { is_active: !r.isActive })}
                    onDelete={() => deleteRule(r.id)}
                  />
                ))}
                {rules.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6 text-gray-500">No rules yet. Add your first one above.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Re-categorize Other panel — appears when the AI has stranded
            descriptions in 'other'. After the user authors more rules, this
            panel lets them re-run the AI with the new context. */}
        {!loading && otherCount > 0 && !recategorizing && (
          <div className="card mt-4 border border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <span className="text-amber-700">⚠</span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-amber-900">
                  {otherCount.toLocaleString()} description{otherCount === 1 ? '' : 's'} currently in &ldquo;Other&rdquo;
                </h3>
                <p className="text-xs text-amber-800 mt-1">
                  The AI couldn&apos;t pick a category for these. Re-running with the smarter prompt and your
                  rules/overrides should categorise most of them. Estimated cost: $0.50–$1.
                </p>
                <button
                  onClick={recategorizeOther}
                  className="mt-3 rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Re-categorize {otherCount.toLocaleString()} description{otherCount === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </div>
        )}

        {recategorizing && (
          <div className="card mt-4">
            <h3 className="text-sm font-semibold mb-2">Re-categorizing…</h3>
            <CategorizationProgress
              uploadLogId={null}
              pendingAtStart={recategorizing.pending}
              onDone={() => {
                setRecategorizing(null);
                refetch();
              }}
            />
          </div>
        )}
      </main>
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Smoke test in the dev server**

```bash
npm run dev
```

Open `http://localhost:3000/dashboard/maintenance/rules` in a browser if available. Otherwise:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard/maintenance/rules
```

Expected: 200 or 307 (redirect to login is fine).

Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/maintenance/rules/page.tsx
git commit -m "feat: add Re-categorize Other panel to Rules page"
```

---

## Task 8: End-to-end smoke test

**Files:**
- None (manual verification against production)

- [ ] **Step 1: Open the PR**

```bash
git push -u origin feat/ai-categorizer-v2
gh pr create --title "feat: smarter AI categorizer with cleaner input + few-shot prompt" \
  --body "Implements docs/superpowers/specs/2026-05-14-ai-categorizer-v2-design.md"
```

Merge via GitHub UI. Vercel deploys automatically.

- [ ] **Step 2: After deploy, exercise the new flow**

1. Open `/dashboard/maintenance/rules` on production.
2. Confirm the "X descriptions currently in Other" panel appears below the rules table with a non-zero count.
3. Click **Re-categorize N descriptions**, confirm the dialog. Watch the progress bar.
4. Wait for completion. The panel should disappear (or show a smaller count if some genuinely defy categorization).

- [ ] **Step 3: Verify the source distribution changed**

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -c "
    SELECT c.slug, c.display_name, COUNT(*) AS rows, rdc.source
      FROM rm_description_categories rdc
      JOIN rm_categories c ON rdc.category_id = c.id
     WHERE rdc.source = 'ai'
     GROUP BY c.slug, c.display_name, rdc.source
     ORDER BY rows DESC;
  "
```

Expected: many more non-`other` rows than before; ideally `other` is now <15% of the AI rows.

- [ ] **Step 4: Spot-check on the Maintenance page**

Open the Maintenance dashboard, click a site row, inspect the InvoiceDrawer. Previously-"Other" invoices should now show specific categories. Confidence column should show a mix of `high`, `medium`, and `low` instead of 100% low.

- [ ] **Step 5: Iterate**

Author additional rules for any patterns still showing up in `other`. Click **Re-categorize** again. Each pass costs less because more rows are now `source='rule'`.
