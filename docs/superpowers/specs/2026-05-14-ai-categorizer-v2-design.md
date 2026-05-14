# AI Categorizer v2 — Design

**Date:** 2026-05-14
**Status:** Design approved, ready for implementation plan
**Context:** Follow-on to the keyword rules feature. The Claude-backed categorizer is putting 100% of unmatched descriptions into `other` with `low` confidence. Goal: get it to actually pick specific categories.

## Problem

After running the keyword rules feature against the user's real data, 1323 of 2709 categorized descriptions ended up in `other` (49%), all with `low` confidence. Sample failures:

| Description | Should be |
|---|---|
| `luveve: supply 3/4" swievel, nozzle jackets and installation of grip lock` | pumps_dispensers |
| `c.valley: supply and installation quick coupling on pressure gauge` | compressors_air |
| `glaudina: zva automatic nozzle replacememnt (leaking)` | pumps_dispensers |
| `lib. supply and installation leaks on breakaway on blend` | pumps_dispensers |
| `mid repairs - installing new cable and daynight switch` | electrical_lighting |
| `belvedere: repair brockrn sink basin` | plumbing_water_waste |

Three observable causes:

1. **Site-name prefixes** (`luveve:`, `lib.`, `glaudina:`) confuse the model into treating descriptions as unstructured.
2. **Zimbabwean fuel-industry terminology** (`ZVA`, `breakaway`, `swivel`, `grip lock`, `soakway`) is not part of the model's general vocabulary.
3. **Typos and informal English** (`swievel`, `replacememnt`, `brockrn`, `dueto`) further obscure recognizable terms.

The categorizer's current system prompt is generic and gives Claude no anchor for any of these.

## Goals

- Drop the "other/low" rate dramatically. Target: <15% of AI-categorized descriptions end up as `other` after the change.
- Keep the categorizer cheap. Use prompt caching where possible; add a small few-shot section that grows with user feedback.
- Provide a one-click "re-categorize Other" path so the user can apply the new prompt to existing data on demand.
- Preserve the override and rule precedence — neither is ever overwritten by re-categorization.

## Non-goals

- Typo correction via dictionary. The few-shot examples + glossary handle this naturally.
- Translation / language detection.
- Per-site or per-cost-center prompt variation.
- Sending richer invoice context (site name, GL account) per row. We may revisit if the cleaner-prompt-only approach underperforms.

## Architecture

### Data flow

```
Pending row → cleanForAI(description) → Claude (smart prompt + few-shot) → verdict
                                              ↑
                       loadFewShotExamples()  ↑
                       (rules + overrides,
                        balanced per category)
```

Three new layers:

1. **`cleanForAI(description)`** — pure text cleaner; strips site-name prefixes and ticket references; never empties the string.
2. **`loadFewShotExamples()`** — pulls up to 3 random descriptions per category from `source IN ('rule', 'override')` rows, excluding `other`.
3. **`buildSystemPrompt(examples)`** — assembles a static base + domain glossary + dynamic examples + instructions.

Plus a new endpoint and a UI affordance for re-running the AI on existing `other` rows.

### Source-of-truth precedence (unchanged)

`override > rule > ai > pending`. Re-categorization only ever touches `source='ai' AND category=other` rows; it never disturbs overrides, rules, or AI-confident assignments in other categories.

## Components

### `lib/categorizer-input.ts`

Pure text cleaner. Single export:

```typescript
export function cleanForAI(description: string | null | undefined): string {
  if (!description) return '';
  let s = String(description);
  // 1. Strip leading site-name prefix.
  s = s.replace(/^[a-z0-9][\w.-]{0,15}[:.]\s+/i, '');
  // 2. Strip ticket / order references.
  s = s.replace(/\b(?:tkt|ticket|ord(?:er)?)\s*#?\s*\d+/gi, '');
  // 3. Collapse whitespace.
  return s.replace(/\s+/g, ' ').trim();
}
```

Call site in the categorizer wraps with `cleanForAI(desc) || desc` so a description that the cleaner would empty falls back to the original.

Six unit tests cover: no-prefix (untouched), colon-prefix stripped, period-prefix stripped, ticket reference stripped, empty result fallback, whitespace collapse.

### `lib/categorizer-examples.ts`

Loads few-shot data from the DB:

```typescript
export async function loadFewShotExamples(perCategory = 3): Promise<Record<string, string[]>> {
  const rows = await query<{ slug: string; description_norm: string }>(`
    SELECT c.slug, rdc.description_norm
      FROM rm_description_categories rdc
      JOIN rm_categories c ON rdc.category_id = c.id
     WHERE rdc.source IN ('rule', 'override')
       AND c.slug != 'other'
     ORDER BY random()
     LIMIT 200
  `);
  const grouped: Record<string, string[]> = {};
  for (const r of rows) {
    if (!grouped[r.slug]) grouped[r.slug] = [];
    if (grouped[r.slug].length < perCategory) grouped[r.slug].push(r.description_norm);
  }
  return grouped;
}
```

No caching across requests (the user's rules + overrides change during the day). The query is fast — single index hit on `source`.

### Updated `lib/categorizer.ts`

The categorizer interface stays the same. The system prompt becomes a function:

```typescript
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

const INSTRUCTIONS = `INSTRUCTIONS:
1. Look for keywords matching the glossary or category descriptions above.
2. Pick the BEST match. Only use 'other' if NO category fits — even loosely.
3. Rate confidence:
   - high: description directly names something in the category
   - medium: strong implication from context
   - low: an educated guess; surface for human review

Return strict JSON via the categorize tool. No prose.`;

export function buildSystemPrompt(examples: Record<string, string[]>): string {
  const exampleSections = Object.entries(examples)
    .filter(([, descs]) => descs.length > 0)
    .map(([slug, descs]) => {
      const lines = descs.map(d => `  - "${d}"`).join('\n');
      return `${slug}:\n${lines}`;
    })
    .join('\n\n');

  return `${BASE_PROMPT}

${GLOSSARY}

EXAMPLES OF CORRECT CATEGORIZATION (from past invoices):

${exampleSections}

${INSTRUCTIONS}`;
}
```

The Anthropic client call uses the assembled prompt with `cache_control: { type: 'ephemeral' }` (already present in current code).

Descriptions sent to Claude use `cleanForAI(desc) || desc`. Original `description_norm` stays in the DB.

### `POST /api/maintenance/recategorize-other`

A single SQL statement, idempotent, returns the count of flipped rows:

```typescript
const result = await query<{ id: number }>(`
  UPDATE rm_description_categories
     SET source = 'pending',
         confidence = NULL,
         needs_review = FALSE,
         updated_at = NOW()
   WHERE source = 'ai'
     AND category_id = (SELECT id FROM rm_categories WHERE slug = 'other')
   RETURNING id
`);
return NextResponse.json({ flipped: result.length });
```

Touches only `ai` + `other` rows. Never modifies `override`, `rule`, or non-`other` AI rows.

### GET rules endpoint — extend with otherCount

The current `GET /api/maintenance/rules` returns `{data: Rule[]}`. We add `otherCount` to the top level:

```json
{ "data": [...], "otherCount": 1323 }
```

`otherCount` is `COUNT(*) FROM rm_description_categories WHERE source='ai' AND category_id = (SELECT id FROM rm_categories WHERE slug='other')`.

### Rules page UI — re-categorize panel

A new panel below the rules table:

```
┌──────────────────────────────────────────────────────────────────┐
│ ⚠ 1,323 descriptions are currently "Other"                       │
│                                                                  │
│ The AI didn't pick a category for these. Re-running with the     │
│ smarter prompt and your rules/overrides should categorise most.  │
│                                                                  │
│ Estimated cost: $0.50 – $1 in Claude API.                        │
│                                                                  │
│ [ Re-categorize 1,323 descriptions ]                             │
└──────────────────────────────────────────────────────────────────┘
```

Click flow:
1. `confirm()` dialog with the cost estimate.
2. POST `/api/maintenance/recategorize-other` → `{flipped: N}`.
3. Mount the existing `CategorizationProgress` component (used during upload). Drain loop runs client-side calling `/api/maintenance/categorize-batch` until `pending = 0`.
4. On done: refetch rules, hide the panel until `otherCount > 0` again.

If `otherCount = 0`, the panel doesn't render.

## Edge cases and decisions

1. **Empty cleaner output.** If `cleanForAI(desc)` returns `''` (e.g. the entire string was a ticket reference), the call site uses `cleanForAI(desc) || desc` and falls back to the original. No description is ever sent to Claude as empty.
2. **No few-shot examples yet.** On a fresh system with zero rules and zero overrides, `loadFewShotExamples()` returns `{}`. The prompt still renders correctly (the "EXAMPLES" section appears empty), and the glossary + instructions are sufficient for baseline categorization.
3. **Examples in 'other' excluded.** We never teach the AI to assign `other` from examples. The query filters `c.slug != 'other'`.
4. **Re-categorize race.** If the cron is mid-batch when the user clicks Re-categorize, both run safely — they both `SELECT pending`, both UPDATE (last writer wins). The final state is consistent: every row gets re-categorized once.
5. **Prompt cache TTL.** Anthropic's `cache_control: ephemeral` lasts 5 minutes. New examples can sneak in across cache windows. Acceptable — the few-shot section is small and the input cost difference is negligible.
6. **What if accuracy is still bad after Re-categorize?** The cycle is: review remaining `other` rows → reclassify via InvoiceDrawer → author rules → Re-categorize again. Each cycle costs less because more rows are now `source='rule'` (skipped by AI). The system converges as the user works.

## Migration / rollout

- No database schema changes.
- No data backfill required. The first `Re-categorize` click triggers the migration of existing `other` rows.
- New code deploys with the next merge to main. The new prompt automatically applies to new uploads via the existing cron + ingest paths.

## Out of scope / future work

- Richer invoice context per row (site name, GL account) — Option C from brainstorming. Revisit if results are still poor.
- Typo correction dictionary.
- A "Re-categorize all non-override" button (full re-evaluation). Not needed unless we find AI made confident wrong assignments.
- Confidence-aware UI prioritization (sort by `confidence='low'` first in the drawer). Could be useful but not required for the AI improvement itself.
