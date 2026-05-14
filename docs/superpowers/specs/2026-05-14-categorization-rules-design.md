# Categorization Rules — Design

**Date:** 2026-05-14
**Status:** Design approved, ready for implementation plan
**Context:** Follow-on to the R&M Finance AI categorization feature

## Problem

The Claude-backed categorizer in `lib/categorizer.ts` is too cautious on the user's real R&M data, defaulting many descriptions to `other`. The user wants direct, deterministic control over how common keywords map to categories — without losing the AI as a fallback for genuinely novel descriptions. The user is non-technical and wants a simple admin UI to author rules like "anything containing 'pump' → Pumps / Dispensers" and have those rules apply retroactively to the existing categorized data.

## Goals

- A keyword-based rules system the user maintains via a dashboard UI.
- New rules apply immediately to existing categorized descriptions (retroactive).
- AI categorization remains as the fallback for descriptions that don't match any rule.
- Manual reclassifies in the InvoiceDrawer (`source='override'`) are never overwritten by rules.
- Deleting a rule cleanly reverts the affected descriptions (re-Claude'd via the existing pending queue).

## Non-goals

- Regex matching, glob patterns, or fuzzy/embedding-based matching. Plain case-insensitive substring is enough.
- Rule priority controls (drag-to-reorder, explicit priority numbers). Longest-pattern-wins is the only precedence.
- Per-cost-center or per-site rule scoping. Rules are global.
- Improving the Claude prompt with few-shot examples. That's a separate future enhancement (Option B in brainstorming, deferred).
- Authoring rules via a "promote this reclassify to a rule" wizard. Replaced by a lighter "Make this a rule?" link that pre-fills the rules form.

## Source-of-truth precedence

For any description in `rm_description_categories`, the resolved category comes from whichever of these is set first (top wins):

1. `source = 'override'` — user manually reclassified via InvoiceDrawer
2. `source = 'rule'` — a keyword rule matched
3. `source = 'ai'` — Claude assigned a category
4. `source = 'pending'` — not yet processed

A rule never overwrites an `override`. A reclassify always overwrites a `rule` or `ai`. Deleting a rule sends affected descriptions back to `pending` so the cron re-Claudes them.

## Architecture

### Data flow

```
Upload (existing)
   ↓
Parse rows → insert into rm_invoices (existing)
   ↓
Discover unseen description_norm → insert placeholders with source='pending' (existing)
   ↓
★ Run keyword rules: bulk SQL update flips matching pending rows to source='rule'
   ↓
Cron / client drain → Claude processes remaining pending → source='ai' (existing)
```

The new step ★ runs:

- At the end of `ingestMaintenance` (after the placeholder discovery).
- After any create/edit/delete/toggle of a rule.

### Schema

New table:

```sql
CREATE TABLE rm_keyword_rules (
  id          BIGSERIAL PRIMARY KEY,
  pattern     TEXT NOT NULL,
  category_id INT NOT NULL REFERENCES rm_categories(id),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rm_keyword_rules_active
  ON rm_keyword_rules(is_active) WHERE is_active = TRUE;
```

Existing `rm_description_categories.source` column gains a new allowed value: `'rule'`. The column is already a free-text `VARCHAR(10)` so no schema change is needed; application code adds the value.

### Matching SQL

Runs as a single statement after any rule write or ingest:

```sql
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
```

Precedence: longest pattern wins on ties; rule id breaks further ties deterministically. The trailing `IS DISTINCT FROM` clause makes re-running the query when nothing changed a no-op (no spurious `updated_at` churn).

### Reset-orphans SQL

Runs after a rule is deleted or toggled off. Returns descriptions whose `source='rule'` no longer corresponds to any active rule back to `'pending'` so the cron re-Claudes them:

```sql
UPDATE rm_description_categories rdc
SET source       = 'pending',
    category_id  = (SELECT id FROM rm_categories WHERE slug='other'),
    confidence   = NULL,
    needs_review = FALSE,
    updated_at   = NOW()
WHERE rdc.source = 'rule'
  AND NOT EXISTS (
    SELECT 1 FROM rm_keyword_rules r
    WHERE r.is_active = TRUE
      AND rdc.description_norm LIKE '%' || lower(r.pattern) || '%'
  );
```

## API surface

All routes live under `app/api/maintenance/rules/`:

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/maintenance/rules` | — | `{ data: Rule[] }` with `match_count` joined per rule |
| `POST` | `/api/maintenance/rules` | `{ pattern, category_slug, notes? }` | Created rule + `applied_count` |
| `PUT` | `/api/maintenance/rules/:id` | partial `{ pattern?, category_slug?, is_active?, notes? }` | Updated rule + `applied_count` |
| `DELETE` | `/api/maintenance/rules/:id` | — | `{ orphans_reset: number }` |

Each write endpoint runs the matching SQL inside the same request, and `DELETE` additionally runs the reset-orphans SQL. Both queries are single statements; latency is acceptable for the expected scale (tens of rules, low thousands of descriptions).

Validation:
- `pattern` is non-empty, trimmed, max length 200, stored lowercased to match the `LIKE` comparison.
- `category_slug` must exist in `rm_categories`.
- On `POST`, reject duplicate `(pattern, is_active=true)` rows with a 409.

## UI

### New page: `/dashboard/maintenance/rules`

Reachable from a new **Rules** link in the Maintenance page header tab strip.

Layout:

```
Categorization Rules                              [+ Add rule]
Patterns are matched case-insensitive against the invoice
description. Longest matching pattern wins.

Pattern              Category               Matches  Active
garden               Landscaping / Grounds   142     [✓] [edit] [⌫]
pump                 Pumps / Dispensers      318     [✓] [edit] [⌫]
fire extinguisher    Fire & Safety            47     [✓] [edit] [⌫]
…
```

- `Matches` column shows the count of `rm_description_categories` rows currently matched by this rule (live, computed in the `GET` query).
- Active toggle disables the rule without deleting it; re-runs the matcher.
- Add rule opens a small inline form: `pattern`, `category` dropdown, optional `notes`. On save: insert, run matcher, refetch the list.
- Edit is inline. On save: re-run matcher.
- Delete: confirm dialog → DELETE → matcher + reset-orphans, refetch.

### Cross-link from InvoiceDrawer

Next to each reclassified row in the drawer, show a small **"Make this a rule?"** link. Clicking it pre-fills the rules form (`pattern` = the description's significant word, `category` = the slug just picked) and routes to the rules page. The user reviews and saves.

This is a UX accelerator, not a separate flow — the underlying rules table and API are the same.

## Edge cases and decisions

1. **Override protection.** Rules never touch `source='override'` rows. The matching SQL excludes them.
2. **Re-Claude on rule delete.** Orphan descriptions go back to `pending`; the existing cron drains them. Costs a small Claude bill for each rule deletion. Acceptable for the predictability gain.
3. **Conflicting rules.** "Longest pattern wins" handles e.g. `pump` vs `pump truck` cleanly. If patterns are the same length, the older rule (`ORDER BY id`) wins — deterministic but arbitrary; documented in the rules page intro.
4. **Disabled rules.** `is_active = FALSE` rules are skipped by the matcher and don't show in matches. Toggling re-runs matcher.
5. **No duplicate patterns.** `(pattern, is_active=true)` uniqueness enforced at the API layer, not the DB (so the user can re-enable an old rule after disabling).
6. **Match count performance.** Computed by joining `rm_keyword_rules` against `rm_description_categories` in the `GET`. With ~1300 descriptions and tens of rules this is sub-second. If it grows large enough to matter, we cache in a column.

## Migration / rollout

- Migration `sql/migrations/rm_keyword_rules.sql` adds the new table and index. Idempotent (`CREATE TABLE IF NOT EXISTS`).
- No data backfill needed. Existing descriptions retain their current `source` until a rule is authored.
- The categorize-batch cron continues to drain `pending` descriptions; rules just reduce the number that reach Claude.

## Out of scope / future work

- Few-shot examples in the Claude prompt (Option B from brainstorming).
- Rule export/import (CSV).
- "Bulk reclassify by description" actions in the InvoiceDrawer.
- Per-cost-center rules.
- Match-count caching.
