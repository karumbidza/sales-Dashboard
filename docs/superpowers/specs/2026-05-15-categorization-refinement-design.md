# Categorization Refinement — Design

**Date:** 2026-05-15
**Status:** Design approved, ready for implementation plan
**Context:** Follow-on to the Helpdesk upload feature. Post-helpdesk-ingest, ~52% of unique descriptions (2,024 of 3,871) sit in `Other / Uncategorised`. Analysis of the top "Other" descriptions reveals two distinct problems:

1. **Missing taxonomy** — descriptions like `plymouth repairs` (×14), `caretaker wages for july` (×8), `canopy cleaning` (×8), and `amortization of nembudziya renovations` (×5) genuinely don't fit any existing category.
2. **AI failures on covered terms** — descriptions like `zva 3/4 nozzle` (×12), `fire extinguisher service` (×13), `pressure gauge replacement` (×4) should match existing categories but the AI defaulted to `Other`. Keyword rules cover this deterministically.

## Goals

- Drop `Other` from ~52% to <20% of unique descriptions.
- Surface ~200 currently uncategorised rows the moment the migration commits.
- Add 4 new top-level categories the data demands: Vehicles, Labour & Wages, Cleaning Services, Capex / Amortization.
- Seed a starter rule pack covering the patterns the AI keeps missing on existing categories.

## Non-goals

- Subcategories / hierarchical taxonomy. Out of scope; flat list stays.
- Restructuring existing categories or merging any.
- Improving the AI prompt beyond adding the new category descriptions and glossary entries — the rules system carries the deterministic load.
- Confidence scoring changes.

## Architecture

Three coordinated changes, all in one PR:

### 1. Database schema additions

Single migration `sql/migrations/rm_categories_expansion.sql`. One transaction, three steps:

```sql
BEGIN;

-- New categories
INSERT INTO rm_categories (slug, display_name, sort_order) VALUES
  ('vehicles',           'Vehicles',                   13),
  ('labour_wages',       'Labour & Wages',             14),
  ('cleaning_services',  'Cleaning Services',          15),
  ('capex_amortization', 'Capex / Amortization',       16)
ON CONFLICT (slug) DO NOTHING;

-- Starter rule pack (see Section "Rule pack" below for full list)
INSERT INTO rm_keyword_rules (pattern, category_id)
SELECT pattern, (SELECT id FROM rm_categories WHERE slug = target_slug)
  FROM (VALUES
    ('fire extinguisher',  'fire_safety'),
    ('fire equipment',     'fire_safety'),
    -- ... 23 more
  ) AS seed(pattern, target_slug)
ON CONFLICT DO NOTHING;

-- Retroactive apply — flips matching 'ai' rows to 'rule'
WITH best_match AS (
  SELECT rdc.description_norm, r.category_id,
         ROW_NUMBER() OVER (PARTITION BY rdc.description_norm
                            ORDER BY LENGTH(r.pattern) DESC, r.id) AS rk
    FROM rm_description_categories rdc
    JOIN rm_keyword_rules r
      ON r.is_active = TRUE
     AND rdc.description_norm LIKE '%' || lower(r.pattern) || '%'
   WHERE rdc.source != 'override'
)
UPDATE rm_description_categories rdc
SET category_id = bm.category_id, source = 'rule', confidence = 'high',
    needs_review = FALSE, updated_at = NOW()
FROM best_match bm
WHERE rdc.description_norm = bm.description_norm AND bm.rk = 1
  AND (rdc.category_id IS DISTINCT FROM bm.category_id OR rdc.source != 'rule');

COMMIT;
```

The retroactive apply is the same SQL as `APPLY_RULES_SQL` in `lib/rm-rules.ts`. We inline it in the migration rather than calling out to application code.

### 2. Code change in `lib/categorizer.ts`

Three constants get edited; the rest of the file is unchanged.

**`CATEGORY_SLUGS`** — extend the readonly array with four new slugs in the same order as their `sort_order`:

```typescript
export const CATEGORY_SLUGS = [
  'pumps_dispensers',
  'compressors_air',
  'tanks_lines',
  'generators',
  'solar_ups',
  'electrical_lighting',
  'plumbing_water_waste',
  'building_civil',
  'canopy_signage',
  'landscaping_grounds',
  'fire_safety',
  'security_cctv',
  'vehicles',
  'labour_wages',
  'cleaning_services',
  'capex_amortization',
  'other',
] as const;
```

This is the source of truth referenced everywhere — POST/PUT rules validation, the tool-use schema's `enum`, the categorizer fallback. The new slugs flow through automatically.

**`BASE_PROMPT`** — append 4 new lines under CATEGORIES and tighten `fire_safety` to mention spill kits/signage:

```
  ...
  fire_safety          — Extinguishers, fire equipment, spill kits, fire signage
  security_cctv        — CCTV, alarms, fences, gates
  vehicles             — Fleet vehicles by name (Plymouth, Toyota), tyres, vehicle servicing, transport
  labour_wages         — Recurring people-cost lines: caretaker wages, security wages, person names by themselves
  cleaning_services    — Routine cleaning (canopy cleaning, deep forecourt cleaning, shop cleaning) — operational, not repair
  capex_amortization   — Accounting accruals: renovation amortization, capex spread over months, set-up costs
  other                — TRULY no fit. Use sparingly.
```

**`GLOSSARY`** — append 5 new lines explaining the new-category triggers:

```
  Plymouth / Toyota / vehicle  — vehicle make or generic vehicle reference → vehicles
  caretaker / gardener wages   — recurring people-cost lines → labour_wages
  person name only             — likely a wage line if no other context → labour_wages
  deep cleaning / canopy clean — operational cleaning, NOT repair → cleaning_services
  amortization / amortisation  — accounting accrual → capex_amortization
```

`INSTRUCTIONS` and `buildSystemPrompt()` are unchanged.

### 3. User action post-deploy

After the migration commits and code deploys:

1. Visit the Rules page. The 4 new categories are in the dropdown; the 25 starter rules appear in the table with live match counts.
2. Click **"Re-categorize Other"**. Existing `ai+other` rows that didn't match a rule go back to `pending`. The cron drains them with the smarter prompt that now knows about the four new categories.

## Rule pack (full list)

25 rules grouped by category:

**fire_safety (5)**
- `fire extinguisher`, `fire equipment`, `spill kit`, `co2 container`, `fire point`

**pumps_dispensers (5)**
- `zva`, `nozzle`, `hose`, `breakaway`, `swivel`

**compressors_air (1)**
- `pressure gauge`

**tanks_lines (2)**
- `dipstick`, `manhole`

**plumbing_water_waste (2)**
- `borehole`, `liquid waste`

**cleaning_services (3 — NEW)**
- `canopy cleaning`, `deep cleaning`, `forecourt cleaning`

**vehicles (2 — NEW)**
- `plymouth`, `tyre`

**labour_wages (3 — NEW)**
- `wages`, `caretaker`, `gardener`

**capex_amortization (2 — NEW)**
- `amortization`, `amortisation`

## Conflict handling and idempotency

- `INSERT ... ON CONFLICT DO NOTHING` on `rm_categories` and `rm_keyword_rules` makes the migration re-runnable. Existing rows are never touched.
- Existing `source='override'` rows are never reclassified by the retroactive apply.
- Longest-pattern-wins handles overlap: `canopy cleaning` (15 chars) beats a hypothetical `canopy` (6 chars), so cleaning rules don't get pre-empted by structural ones.
- Existing user-authored rules with the same patterns: the unique partial index `uniq_rm_keyword_rules_active_pattern` rejects duplicate active patterns. The migration's `ON CONFLICT` silently skips those. Pre-existing user rules win.

## Edge cases

1. **`person name only → labour_wages` is a defensible heuristic, not a guarantee.** The AI may put one-word person names like `tamburai tsunga` into `labour_wages`, but if there's no clear name pattern it will fall back to `other`. Acceptable — better to surface for review than to silently misclassify.

2. **`nozzle` and `hose` are short patterns** (6 and 4 chars). Risk: `nozzle` could match `nozzle washer` (still pumps_dispensers — fine). `hose` could match `garden hose` (debatable: pumps_dispensers vs landscaping_grounds). Given the fuel-station context, both are overwhelmingly pumps_dispensers. If we see misclassification, we can disable the rule via the UI and use longer-phrase rules.

3. **`wages` is broad but specific to wage lines** in this data. No invoices use the word "wages" in a non-wage context.

4. **Migration is idempotent for fresh installs.** If someone re-runs from scratch, the categories/rules insert with `ON CONFLICT DO NOTHING` and the retroactive apply is a no-op (already current).

5. **Existing rules created by the user since the original PR (e.g. `pump`, `compressor`, `generator`).** These coexist with seeded rules. The longest-pattern-wins resolves precedence at apply time — no conflict.

## Expected impact

| Metric | Before | After migration commit | After Re-categorize Other |
|---|---|---|---|
| `other` (unique descs) | 2,024 (52%) | ~1,800 | ~400–700 (10–18%) |
| Categories with rows | 12 | 16 | 16 |
| Active rules | 11 | 36 | 36 |
| API cost for re-run | — | $0 (rules only) | ~$0.30 |

## Migration / rollout

1. Apply `sql/migrations/rm_categories_expansion.sql` to Neon (idempotent, single transaction).
2. Merge the PR → Vercel deploys the updated `lib/categorizer.ts`.
3. User clicks "Re-categorize Other" once the deploy is live.

## Out of scope / future work

- Subcategories / two-level taxonomy.
- Per-cost-center category overrides.
- Auto-detect "is this a person's name?" via NER or an ML classifier — manual review is sufficient.
- A "bulk reclassify by pattern" UI — for now the user authors a rule and lets the rules engine handle it.
