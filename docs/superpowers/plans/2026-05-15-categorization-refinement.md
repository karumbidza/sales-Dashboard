# Categorization Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 new top-level categories (Vehicles, Labour & Wages, Cleaning Services, Capex / Amortization) and seed 25 keyword rules so ~200 of the existing 2,024 "Other" descriptions reclassify the instant the migration commits.

**Architecture:** A single idempotent SQL migration runs three steps in one transaction: insert categories, insert rules with `ON CONFLICT DO NOTHING`, run the same `APPLY_RULES_SQL` from `lib/rm-rules.ts` to retroactively reclassify matching descriptions. Code change adds 4 slugs to `CATEGORY_SLUGS`, extends `BASE_PROMPT`, and appends 5 glossary lines so future AI calls know the new categories.

**Tech Stack:** Postgres, TypeScript (Next.js 14), `node:test`.

**Spec reference:** `docs/superpowers/specs/2026-05-15-categorization-refinement-design.md`

---

## File Map

**Create:**
- `sql/migrations/rm_categories_expansion.sql` — categories + rules + retroactive apply

**Modify:**
- `lib/categorizer.ts` — extend `CATEGORY_SLUGS`, `BASE_PROMPT`, `GLOSSARY`
- `lib/categorizer.test.ts` — update the `'CATEGORY_SLUGS list matches the seed taxonomy'` test to expect 17 slugs

No new components, no new API routes, no UI changes. The existing Rules page and Re-categorize Other button handle everything.

---

## Task 1: Database migration

**Files:**
- Create: `sql/migrations/rm_categories_expansion.sql`

- [ ] **Step 1: Write the migration**

Create `sql/migrations/rm_categories_expansion.sql` with EXACTLY:

```sql
-- ============================================================
-- Categorization refinement:
-- 1. Adds 4 new top-level categories that the data demands.
-- 2. Seeds 25 starter keyword rules covering the most common
--    'Other' patterns observed in production data.
-- 3. Retroactively applies all active rules so matching
--    descriptions flip from 'ai' to 'rule' immediately.
-- ============================================================

BEGIN;

-- 1. New categories
INSERT INTO rm_categories (slug, display_name, sort_order) VALUES
  ('vehicles',           'Vehicles',                   13),
  ('labour_wages',       'Labour & Wages',             14),
  ('cleaning_services',  'Cleaning Services',          15),
  ('capex_amortization', 'Capex / Amortization',       16)
ON CONFLICT (slug) DO NOTHING;

-- 2. Starter rule pack — 25 patterns
INSERT INTO rm_keyword_rules (pattern, category_id)
SELECT seed.pattern,
       (SELECT id FROM rm_categories WHERE slug = seed.target_slug)
  FROM (VALUES
    -- fire_safety
    ('fire extinguisher',  'fire_safety'),
    ('fire equipment',     'fire_safety'),
    ('spill kit',          'fire_safety'),
    ('co2 container',      'fire_safety'),
    ('fire point',         'fire_safety'),
    -- pumps_dispensers
    ('zva',                'pumps_dispensers'),
    ('nozzle',             'pumps_dispensers'),
    ('hose',               'pumps_dispensers'),
    ('breakaway',          'pumps_dispensers'),
    ('swivel',             'pumps_dispensers'),
    -- compressors_air
    ('pressure gauge',     'compressors_air'),
    -- tanks_lines
    ('dipstick',           'tanks_lines'),
    ('manhole',            'tanks_lines'),
    -- plumbing_water_waste
    ('borehole',           'plumbing_water_waste'),
    ('liquid waste',       'plumbing_water_waste'),
    -- cleaning_services (new)
    ('canopy cleaning',    'cleaning_services'),
    ('deep cleaning',      'cleaning_services'),
    ('forecourt cleaning', 'cleaning_services'),
    -- vehicles (new)
    ('plymouth',           'vehicles'),
    ('tyre',               'vehicles'),
    -- labour_wages (new)
    ('wages',              'labour_wages'),
    ('caretaker',          'labour_wages'),
    ('gardener',           'labour_wages'),
    -- capex_amortization (new)
    ('amortization',       'capex_amortization'),
    ('amortisation',       'capex_amortization')
  ) AS seed(pattern, target_slug)
ON CONFLICT DO NOTHING;

-- 3. Retroactive apply — same logic as APPLY_RULES_SQL in lib/rm-rules.ts.
-- Longest pattern wins per description_norm. Never touches source='override'.
WITH best_match AS (
  SELECT
    rdc.description_norm,
    r.category_id,
    ROW_NUMBER() OVER (
      PARTITION BY rdc.description_norm
      ORDER BY LENGTH(r.pattern) DESC, r.id
    ) AS rk
  FROM rm_description_categories rdc
  JOIN rm_keyword_rules r
    ON r.is_active = TRUE
   AND rdc.description_norm LIKE '%' || lower(r.pattern) || '%'
  WHERE rdc.source != 'override'
)
UPDATE rm_description_categories rdc
SET category_id  = bm.category_id,
    source       = 'rule',
    confidence   = 'high',
    needs_review = FALSE,
    updated_at   = NOW()
FROM best_match bm
WHERE rdc.description_norm = bm.description_norm
  AND bm.rk = 1
  AND (rdc.category_id IS DISTINCT FROM bm.category_id OR rdc.source != 'rule');

COMMIT;
```

- [ ] **Step 2: Apply against Neon**

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/rm_categories_expansion.sql
```

Expected: `BEGIN ... INSERT 0 4 ... INSERT 0 25 ... UPDATE 200+ ... COMMIT` (the UPDATE row count will vary based on data, but should be ≥150).

- [ ] **Step 3: Verify**

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -c "
SELECT slug, display_name FROM rm_categories WHERE sort_order BETWEEN 13 AND 16 ORDER BY sort_order;
" -c "
SELECT COUNT(*) AS rule_count FROM rm_keyword_rules WHERE is_active = TRUE;
" -c "
SELECT c.display_name, COUNT(*) AS unique_descs
  FROM rm_description_categories rdc
  JOIN rm_categories c ON rdc.category_id = c.id
 GROUP BY c.display_name
 ORDER BY 2 DESC;
"
```

Expected:
- 4 new categories present (vehicles, labour_wages, cleaning_services, capex_amortization)
- Rule count is at least 36 (11 existing + 25 new)
- Category distribution shows the 4 new categories with non-zero counts; `Other / Uncategorised` should be visibly smaller than the pre-migration 2,024.

- [ ] **Step 4: Commit**

```bash
git add sql/migrations/rm_categories_expansion.sql
git commit -m "feat: add 4 new categories + 25 starter rules, retroactively apply"
```

---

## Task 2: Update categorizer.ts code constants

**Files:**
- Modify: `lib/categorizer.ts`

- [ ] **Step 1: Extend CATEGORY_SLUGS**

Open `lib/categorizer.ts`. Find:

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
  'other',
] as const;
```

Replace with:

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

- [ ] **Step 2: Update BASE_PROMPT with new categories and tighten fire_safety**

Find the BASE_PROMPT constant. Its closing lines currently read:

```
  fire_safety          — Extinguishers, fire equipment
  security_cctv        — CCTV, alarms, fences, gates
  other                — TRULY no fit. Use sparingly.`;
```

Replace those three lines with:

```
  fire_safety          — Extinguishers, fire equipment, spill kits, fire signage
  security_cctv        — CCTV, alarms, fences, gates
  vehicles             — Fleet vehicles by name (Plymouth, Toyota), tyres, vehicle servicing, transport
  labour_wages         — Recurring people-cost lines: caretaker wages, security wages, person names by themselves
  cleaning_services    — Routine cleaning (canopy cleaning, deep forecourt cleaning, shop cleaning) — operational, not repair
  capex_amortization   — Accounting accruals: renovation amortization, capex spread over months, set-up costs
  other                — TRULY no fit. Use sparingly.`;
```

- [ ] **Step 3: Append new entries to GLOSSARY**

Find the GLOSSARY constant. Its closing line currently reads:

```
  forecourt    — open service area (context only, not a category)`;
```

Replace that line with:

```
  forecourt    — open service area (context only, not a category)
  Plymouth / Toyota / vehicle  — vehicle make or generic vehicle reference → vehicles
  caretaker / gardener wages   — recurring people-cost lines → labour_wages
  person name only             — likely a wage line if no other context → labour_wages
  deep cleaning / canopy clean — operational cleaning, NOT repair → cleaning_services
  amortization / amortisation  — accounting accrual → capex_amortization`;
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add lib/categorizer.ts
git commit -m "feat: teach categorizer about 4 new categories with glossary hints"
```

---

## Task 3: Update categorizer test for new slug count

**Files:**
- Modify: `lib/categorizer.test.ts`

- [ ] **Step 1: Update the seed taxonomy test**

In `lib/categorizer.test.ts`, find the test starting at line 52:

```typescript
test('CATEGORY_SLUGS list matches the seed taxonomy', () => {
  const expected = [
    'pumps_dispensers', 'compressors_air', 'tanks_lines', 'generators',
    'solar_ups', 'electrical_lighting', 'plumbing_water_waste', 'building_civil',
    'canopy_signage', 'landscaping_grounds', 'fire_safety', 'security_cctv', 'other',
  ];
  assert.deepEqual(CATEGORY_SLUGS, expected);
});
```

Replace the body with:

```typescript
test('CATEGORY_SLUGS list matches the seed taxonomy', () => {
  const expected = [
    'pumps_dispensers', 'compressors_air', 'tanks_lines', 'generators',
    'solar_ups', 'electrical_lighting', 'plumbing_water_waste', 'building_civil',
    'canopy_signage', 'landscaping_grounds', 'fire_safety', 'security_cctv',
    'vehicles', 'labour_wages', 'cleaning_services', 'capex_amortization',
    'other',
  ];
  assert.deepEqual(CATEGORY_SLUGS, expected);
});
```

The new slugs go between `security_cctv` and `other` to match the order in `lib/categorizer.ts`.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all 57 tests pass (no regressions). If a single test was relying on `length === 13`, it should now pass with `=== 17`.

- [ ] **Step 3: Commit**

```bash
git add lib/categorizer.test.ts
git commit -m "test: update CATEGORY_SLUGS test for 4 new categories"
```

---

## Task 4: PR + manual smoke test on production

**Files:**
- None (manual verification)

- [ ] **Step 1: Open the PR**

```bash
git push -u origin feat/category-refinement
gh pr create --title "feat: add 4 categories + 25 starter rules to reduce Other to under 20 percent" \
  --body "Implements docs/superpowers/specs/2026-05-15-categorization-refinement-design.md - adds Vehicles, Labour & Wages, Cleaning Services, Capex / Amortization categories, seeds 25 starter rules, and retroactively applies them to ~200 currently-Other descriptions."
```

Merge via GitHub UI.

- [ ] **Step 2: Confirm the migration already ran on Neon**

The migration was applied during Task 1 Step 2. Confirm state on production:

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -c "
SELECT source, COUNT(*) FROM rm_description_categories GROUP BY source ORDER BY 1;
" -c "
SELECT c.display_name, COUNT(*) AS unique_descs
  FROM rm_description_categories rdc
  JOIN rm_categories c ON rdc.category_id = c.id
 GROUP BY c.display_name
 ORDER BY 2 DESC;
"
```

Expected: rule source count grew by 150+; Other count is visibly lower (~1,800 from 2,024).

- [ ] **Step 3: Verify the Rules page**

In the live app, open `/dashboard/maintenance/rules`. Confirm:
- 4 new categories appear in the Add Rule category dropdown.
- The 25 seeded rules show in the table with their live match counts.
- The "Other count" panel reflects the post-migration reduced number.

- [ ] **Step 4: Click Re-categorize Other**

On the Rules page, click **Re-categorize N descriptions**. CategorizationProgress mounts and drains.

Watch the progress complete (expect ~30–60 seconds for the remaining ~1,800 descriptions).

- [ ] **Step 5: Verify final state**

```bash
psql "$DATABASE_URL" -c "
SELECT c.display_name, COUNT(*) AS unique_descs
  FROM rm_description_categories rdc
  JOIN rm_categories c ON rdc.category_id = c.id
 GROUP BY c.display_name
 ORDER BY 2 DESC;
"
```

Expected outcomes:
- All 4 new categories have non-zero counts.
- `Other / Uncategorised` is between 400 and 700 (10–18% of 3,871).
- Existing operational categories (Pumps, Generators, Compressors, Plumbing, Electrical, etc.) all grew somewhat.

- [ ] **Step 6: Visit the Maintenance and Helpdesk dashboards**

Open `/dashboard/maintenance` and `/dashboard/helpdesk`. Confirm:
- Category Breakdown chart on Maintenance shows the 4 new categories with non-trivial slices.
- Helpdesk Top Recurring panel shows reduced "Other" categorization.
- The InvoiceDrawer's category dropdown lists all 17 categories.

- [ ] **Step 7: Report any anomalies**

Note any rule that over-matches or any unexpected category assignment. Those can be fixed by:
- Disabling the rule (toggle Active off on the Rules page)
- Reclassifying specific descriptions via the drawer
- Adding a more-specific competing rule (longest-pattern-wins)
