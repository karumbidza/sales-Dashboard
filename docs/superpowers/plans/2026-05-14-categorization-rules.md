# Categorization Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-authored keyword-rules layer that retroactively reclassifies R&M descriptions before Claude sees them, with a CRUD admin page and an "Make this a rule?" shortcut in the InvoiceDrawer.

**Architecture:** A single new table `rm_keyword_rules`. Rule application is a single SQL statement that updates `rm_description_categories.source` to `'rule'` for the best-matching (longest-pattern) active rule, never touching `source='override'`. Each rule-write endpoint runs that SQL synchronously. Ingest also runs it after placeholder discovery. Rule deletion adds a reset-orphans pass that flips lost rules back to `source='pending'` so the cron re-Claudes them.

**Tech Stack:** Next.js 14 App Router, TypeScript, Postgres (via `lib/db.ts`), Tailwind CSS, `node:test` for unit tests on pure functions.

**Spec reference:** `docs/superpowers/specs/2026-05-14-categorization-rules-design.md`

**Prerequisite:** PR #7 (`feat/invoice-drawer-batch-save`) must be merged before Task 11, which depends on the `norm`, `staged`, and `isModified` row-render variables introduced there. Tasks 1–10 are independent of PR #7 and can land first if needed.

---

## File Map

**Create:**
- `sql/migrations/rm_keyword_rules.sql` — new table + index
- `lib/rm-rules.ts` — pattern normalizer + the two SQL constants
- `lib/rm-rules.test.ts` — unit tests for the pattern normalizer
- `app/api/maintenance/rules/route.ts` — GET (list), POST (create)
- `app/api/maintenance/rules/[id]/route.ts` — PUT (update), DELETE (delete + reset orphans)
- `app/dashboard/maintenance/rules/page.tsx` — admin UI

**Modify:**
- `app/api/ingest/route.ts` — call rule matcher after placeholder discovery in `ingestMaintenance`
- `app/dashboard/maintenance/page.tsx` — add `Rules` link to tab strip
- `components/maintenance/InvoiceDrawer.tsx` — add "Make this a rule?" link beside staged rows

---

## Task 1: Database migration

**Files:**
- Create: `sql/migrations/rm_keyword_rules.sql`

- [ ] **Step 1: Write the migration SQL**

Create `sql/migrations/rm_keyword_rules.sql` with:

```sql
-- ============================================================
-- Keyword rules layer for R&M categorization.
-- Each rule maps a case-insensitive substring pattern to a
-- category. Matching happens via LIKE '%' || lower(pattern) || '%'
-- on rm_description_categories.description_norm. Longest pattern
-- wins on conflict.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS rm_keyword_rules (
  id          BIGSERIAL PRIMARY KEY,
  pattern     TEXT NOT NULL,
  category_id INT NOT NULL REFERENCES rm_categories(id),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rm_keyword_rules_active
  ON rm_keyword_rules(is_active) WHERE is_active = TRUE;

COMMIT;
```

- [ ] **Step 2: Apply the migration against the database**

Run:
```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/rm_keyword_rules.sql
```

Expected: `BEGIN ... CREATE TABLE ... CREATE INDEX ... COMMIT`.

- [ ] **Step 3: Verify the table exists**

Run:
```bash
psql "$DATABASE_URL" -c "\d rm_keyword_rules"
```

Expected: a table description with columns id, pattern, category_id, is_active, notes, created_at, updated_at.

- [ ] **Step 4: Commit**

```bash
git add sql/migrations/rm_keyword_rules.sql
git commit -m "feat: add rm_keyword_rules schema for categorization rules"
```

---

## Task 2: Pattern normalizer helper + tests

**Files:**
- Create: `lib/rm-rules.ts`
- Create: `lib/rm-rules.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/rm-rules.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePattern } from './rm-rules';

test('lowercases input', () => {
  assert.equal(normalizePattern('PUMP'), 'pump');
});

test('trims surrounding whitespace', () => {
  assert.equal(normalizePattern('  pump  '), 'pump');
});

test('collapses internal whitespace runs to a single space', () => {
  assert.equal(normalizePattern('pump\t  truck\n'), 'pump truck');
});

test('strips SQL LIKE wildcards % and _ to avoid runaway matches', () => {
  assert.equal(normalizePattern('pump%'), 'pump');
  assert.equal(normalizePattern('pump_truck'), 'pumptruck');
  assert.equal(normalizePattern('\\backslash'), 'backslash');
});

test('returns empty string for null, undefined, or empty input', () => {
  assert.equal(normalizePattern(null), '');
  assert.equal(normalizePattern(undefined), '');
  assert.equal(normalizePattern(''), '');
  assert.equal(normalizePattern('   '), '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: failures referencing `Cannot find module './rm-rules'`.

- [ ] **Step 3: Implement the minimum to make tests pass**

Create `lib/rm-rules.ts`:

```typescript
// lib/rm-rules.ts
// Keyword-rule layer for R&M categorization. Pattern matching happens
// in Postgres via LIKE; this file owns the small bits of pure JS that
// surround it (input normalization, the two SQL constants used by the
// API routes and ingest path).

export function normalizePattern(input: string | null | undefined): string {
  if (input == null) return '';
  return String(input)
    .replace(/[%_\\]/g, '')   // strip SQL LIKE wildcards and escape char
    .replace(/\s+/g, ' ')     // collapse whitespace
    .trim()
    .toLowerCase();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all 5 new tests pass alongside the existing 29 (34 total).

- [ ] **Step 5: Commit**

```bash
git add lib/rm-rules.ts lib/rm-rules.test.ts
git commit -m "feat: add normalizePattern helper for keyword rules"
```

---

## Task 3: Apply-rules and reset-orphans SQL constants

**Files:**
- Modify: `lib/rm-rules.ts`

- [ ] **Step 1: Add the two SQL constants**

Append to `lib/rm-rules.ts`:

```typescript
// Bulk-update SQL — picks the longest-pattern active rule that matches
// each description and flips it to source='rule'. Excludes source='override'
// (manual reclassifies always win). The IS DISTINCT FROM guard makes this
// a no-op when nothing changed. Append RETURNING 1 so callers can count
// the number of rows actually changed.
export const APPLY_RULES_SQL = `
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
  AND (rdc.category_id IS DISTINCT FROM bm.category_id OR rdc.source != 'rule')
RETURNING 1
`;

// Reverts source='rule' rows whose patterns no longer exist (e.g. after
// rule deletion or toggle-off) back to 'pending', so the cron re-Claudes
// them. Reset to category 'other' as a sane default.
export const RESET_ORPHANS_SQL = `
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
  )
RETURNING 1
`;
```

- [ ] **Step 2: Run typecheck to confirm clean**

```bash
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 3: Run tests to confirm nothing regressed**

```bash
npm test
```

Expected: all 34 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add lib/rm-rules.ts
git commit -m "feat: add APPLY_RULES_SQL and RESET_ORPHANS_SQL constants"
```

---

## Task 4: GET /api/maintenance/rules (list with match counts)

**Files:**
- Create: `app/api/maintenance/rules/route.ts`

- [ ] **Step 1: Implement the GET handler**

Create `app/api/maintenance/rules/route.ts`:

```typescript
// app/api/maintenance/rules/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CATEGORY_SLUGS } from '@/lib/categorizer';
import { APPLY_RULES_SQL, normalizePattern } from '@/lib/rm-rules';

export const dynamic = 'force-dynamic';

const VALID_SLUGS = new Set<string>(CATEGORY_SLUGS);

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

    return NextResponse.json({
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

- [ ] **Step 2: Verify the endpoint returns an empty list**

Start the dev server:
```bash
npm run dev
```

In a separate terminal:
```bash
curl -s http://localhost:3000/api/maintenance/rules | head -1
```

Expected: `{"data":[]}` (since no rules exist yet).

Stop the dev server with `Ctrl+C` once verified.

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/rules/route.ts
git commit -m "feat: add GET /api/maintenance/rules with match counts"
```

---

## Task 5: POST /api/maintenance/rules (create + apply)

**Files:**
- Modify: `app/api/maintenance/rules/route.ts`

- [ ] **Step 1: Add POST handler to the existing route file**

Append to `app/api/maintenance/rules/route.ts`:

```typescript
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pattern = normalizePattern(body?.pattern);
    const slug    = String(body?.category_slug ?? '');
    const notes   = body?.notes != null ? String(body.notes).slice(0, 500) : null;

    if (!pattern) return NextResponse.json({ error: 'pattern required' }, { status: 400 });
    if (pattern.length > 200) return NextResponse.json({ error: 'pattern too long (max 200 chars)' }, { status: 400 });
    if (!VALID_SLUGS.has(slug)) return NextResponse.json({ error: 'unknown category_slug' }, { status: 400 });

    // Reject duplicate active patterns.
    const dup = await query<{ id: number }>(
      `SELECT id FROM rm_keyword_rules WHERE lower(pattern) = $1 AND is_active = TRUE LIMIT 1`,
      [pattern],
    );
    if (dup.length > 0) {
      return NextResponse.json({ error: 'rule already exists for this pattern' }, { status: 409 });
    }

    const ins = await query<{ id: number }>(
      `INSERT INTO rm_keyword_rules (pattern, category_id, notes)
       VALUES ($1, (SELECT id FROM rm_categories WHERE slug = $2), $3)
       RETURNING id`,
      [pattern, slug, notes],
    );

    const applied = await query<any>(APPLY_RULES_SQL);
    return NextResponse.json({ id: ins[0].id, applied_count: applied.length });
  } catch (err: any) {
    console.error('/api/maintenance/rules POST error:', err);
    return NextResponse.json({ error: err.message || 'create failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify create + duplicate check + bad slug**

Start dev server: `npm run dev`

```bash
# Create rule — expect 200 with applied_count
curl -s -X POST http://localhost:3000/api/maintenance/rules \
  -H 'Content-Type: application/json' \
  -d '{"pattern":"garden","category_slug":"landscaping_grounds"}'

# Duplicate — expect 409
curl -s -X POST http://localhost:3000/api/maintenance/rules \
  -H 'Content-Type: application/json' \
  -d '{"pattern":"garden","category_slug":"landscaping_grounds"}'

# Bad slug — expect 400
curl -s -X POST http://localhost:3000/api/maintenance/rules \
  -H 'Content-Type: application/json' \
  -d '{"pattern":"foo","category_slug":"nope"}'

# Confirm DB:
psql "$DATABASE_URL" -c "SELECT id, pattern, source FROM rm_description_categories WHERE source='rule' LIMIT 10;"
```

Expected: first call returns `{"id":1,"applied_count":N}` where N is the number of descriptions containing "garden". DB query shows those rows have source='rule'.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/rules/route.ts
git commit -m "feat: add POST /api/maintenance/rules with retroactive apply"
```

---

## Task 6: PUT /api/maintenance/rules/[id] (update + re-apply)

**Files:**
- Create: `app/api/maintenance/rules/[id]/route.ts`

- [ ] **Step 1: Implement PUT handler**

Create `app/api/maintenance/rules/[id]/route.ts`:

```typescript
// app/api/maintenance/rules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CATEGORY_SLUGS } from '@/lib/categorizer';
import { APPLY_RULES_SQL, RESET_ORPHANS_SQL, normalizePattern } from '@/lib/rm-rules';

export const dynamic = 'force-dynamic';

const VALID_SLUGS = new Set<string>(CATEGORY_SLUGS);

export async function PUT(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const setClauses: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (typeof body.pattern === 'string') {
      const pattern = normalizePattern(body.pattern);
      if (!pattern) return NextResponse.json({ error: 'pattern required' }, { status: 400 });
      if (pattern.length > 200) return NextResponse.json({ error: 'pattern too long' }, { status: 400 });
      setClauses.push(`pattern = $${p++}`);
      params.push(pattern);
    }
    if (typeof body.category_slug === 'string') {
      if (!VALID_SLUGS.has(body.category_slug)) {
        return NextResponse.json({ error: 'unknown category_slug' }, { status: 400 });
      }
      setClauses.push(`category_id = (SELECT id FROM rm_categories WHERE slug = $${p++})`);
      params.push(body.category_slug);
    }
    if (typeof body.is_active === 'boolean') {
      setClauses.push(`is_active = $${p++}`);
      params.push(body.is_active);
    }
    if (typeof body.notes === 'string' || body.notes === null) {
      setClauses.push(`notes = $${p++}`);
      params.push(body.notes == null ? null : String(body.notes).slice(0, 500));
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    await query(
      `UPDATE rm_keyword_rules SET ${setClauses.join(', ')} WHERE id = $${p}`,
      params,
    );

    // Re-apply (in case pattern/category/is_active changed) and reset
    // orphans (in case is_active flipped off and rows lost their rule).
    const applied = await query<any>(APPLY_RULES_SQL);
    const orphans = await query<any>(RESET_ORPHANS_SQL);
    return NextResponse.json({
      applied_count: applied.length,
      orphans_reset: orphans.length,
    });
  } catch (err: any) {
    console.error('/api/maintenance/rules/[id] PUT error:', err);
    return NextResponse.json({ error: err.message || 'update failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify update**

Start dev server: `npm run dev`

```bash
# Toggle the rule from Task 5 off
curl -s -X PUT http://localhost:3000/api/maintenance/rules/1 \
  -H 'Content-Type: application/json' \
  -d '{"is_active":false}'

# Check it now reports 0 match counts
curl -s http://localhost:3000/api/maintenance/rules | head -1

# Confirm orphans reset
psql "$DATABASE_URL" -c "SELECT source, COUNT(*) FROM rm_description_categories WHERE description_norm LIKE '%garden%' GROUP BY source;"

# Re-enable
curl -s -X PUT http://localhost:3000/api/maintenance/rules/1 \
  -H 'Content-Type: application/json' \
  -d '{"is_active":true}'
```

Expected: toggling off resets matched descriptions back to `pending`. Toggling on re-applies them.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/rules/\[id\]/route.ts
git commit -m "feat: add PUT /api/maintenance/rules/:id with re-apply and orphan reset"
```

---

## Task 7: DELETE /api/maintenance/rules/[id] (delete + reset)

**Files:**
- Modify: `app/api/maintenance/rules/[id]/route.ts`

- [ ] **Step 1: Add DELETE handler to the existing file**

Append to `app/api/maintenance/rules/[id]/route.ts`:

```typescript
export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = parseInt(ctx.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    const del = await query<{ id: number }>(
      `DELETE FROM rm_keyword_rules WHERE id = $1 RETURNING id`,
      [id],
    );
    if (del.length === 0) {
      return NextResponse.json({ error: 'rule not found' }, { status: 404 });
    }

    // Re-apply remaining rules (in case any other rule covers some of the
    // descriptions this one matched), then reset whatever's left over.
    const applied = await query<any>(APPLY_RULES_SQL);
    const orphans = await query<any>(RESET_ORPHANS_SQL);
    return NextResponse.json({
      applied_count: applied.length,
      orphans_reset: orphans.length,
    });
  } catch (err: any) {
    console.error('/api/maintenance/rules/[id] DELETE error:', err);
    return NextResponse.json({ error: err.message || 'delete failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify delete**

Start dev server: `npm run dev`

```bash
# Delete rule 1
curl -s -X DELETE http://localhost:3000/api/maintenance/rules/1

# Confirm rule gone, descriptions reset
curl -s http://localhost:3000/api/maintenance/rules | head -1
psql "$DATABASE_URL" -c "SELECT source, COUNT(*) FROM rm_description_categories WHERE description_norm LIKE '%garden%' GROUP BY source;"

# Delete non-existent — expect 404
curl -s -X DELETE http://localhost:3000/api/maintenance/rules/99999
```

Expected: rule disappears from list; descriptions revert to `source='pending'`; non-existent id returns 404.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/rules/\[id\]/route.ts
git commit -m "feat: add DELETE /api/maintenance/rules/:id with orphan reset"
```

---

## Task 8: Ingest integration — apply rules after placeholder discovery

**Files:**
- Modify: `app/api/ingest/route.ts` — the `ingestMaintenance` function

- [ ] **Step 1: Import APPLY_RULES_SQL**

Find the existing imports at the top of `app/api/ingest/route.ts` and add the rules import. The first imports block currently reads:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { parseRMFinanceRows } from '@/lib/rm-finance-parse';
import {
  parseExcelBuffer, compactToSheets, safeFloat, safeStr, siteCode,
  parseBudgetMonthCol, parseDate, parseDateDayFirst,
} from '@/lib/xlsx-parse';
```

Add this line after the `parseRMFinanceRows` import:

```typescript
import { APPLY_RULES_SQL } from '@/lib/rm-rules';
```

- [ ] **Step 2: Call APPLY_RULES_SQL after placeholder discovery**

In `ingestMaintenance` (later in the same file), locate the block that ends with `const pendingInserted = placeholderRes.length;` — it follows the `WITH unseen AS ...` CTE that inserts pending placeholders.

After that line and BEFORE `// 6. Bookkeeping`, insert:

```typescript
    // 5b. Apply any active keyword rules to the newly-inserted placeholders
    //     so the cron has less work to do and rule-matched rows show up
    //     immediately on the dashboard.
    await query(APPLY_RULES_SQL).catch(e => console.warn('rule apply failed:', e));
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "feat: apply keyword rules during R&M ingest after placeholder discovery"
```

---

## Task 9: Add Rules link to Maintenance page tab strip

**Files:**
- Modify: `app/dashboard/maintenance/page.tsx`

- [ ] **Step 1: Add the link**

In `app/dashboard/maintenance/page.tsx`, locate the tab strip block:

```tsx
        {/* Tab strip — Link tabs cross-route back to dashboard. Labels mirror
            the Sales Dashboard header so navigation feels consistent. */}
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <span                   className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Maintenance</span>
        </div>
```

Replace it with:

```tsx
        {/* Tab strip — Link tabs cross-route back to dashboard. Labels mirror
            the Sales Dashboard header so navigation feels consistent. */}
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <span                   className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Maintenance</span>
          <Link href="/dashboard/maintenance/rules" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
        </div>
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/maintenance/page.tsx
git commit -m "feat: add Rules tab link to Maintenance page header"
```

---

## Task 10: Rules admin page

**Files:**
- Create: `app/dashboard/maintenance/rules/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/dashboard/maintenance/rules/page.tsx`:

```tsx
'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface Rule {
  id:           number;
  pattern:      string;
  categorySlug: string;
  categoryName: string;
  isActive:     boolean;
  notes:        string | null;
  matchCount:   number;
}

interface CategoryOption { slug: string; displayName: string; }

function RulesPageInner() {
  const sp = useSearchParams();

  const [rules,   setRules]   = useState<Rule[]>([]);
  const [cats,    setCats]    = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  // Prefill from query params (used by InvoiceDrawer "Make this a rule?" link).
  const [newPattern, setNewPattern] = useState(sp.get('pattern')       ?? '');
  const [newSlug,    setNewSlug]    = useState(sp.get('category_slug') ?? '');
  const [showAdd,    setShowAdd]    = useState(Boolean(sp.get('pattern')));

  const refetch = async () => {
    setLoading(true); setError(null);
    try {
      const [rRes, cRes] = await Promise.all([
        fetch('/api/maintenance/rules').then(r => r.json()),
        fetch('/api/maintenance/categories-list').then(r => r.json()),
      ]);
      setRules(rRes?.data || []);
      setCats(cRes?.data || []);
    } catch (e: any) {
      setError(e.message || 'load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refetch(); }, []);

  const addRule = async () => {
    if (!newPattern.trim() || !newSlug) {
      setError('pattern and category required');
      return;
    }
    const res = await fetch('/api/maintenance/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: newPattern, category_slug: newSlug }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'add failed');
      return;
    }
    setNewPattern(''); setNewSlug(''); setShowAdd(false); setError(null);
    await refetch();
  };

  const updateRule = async (id: number, body: any) => {
    const res = await fetch(`/api/maintenance/rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'update failed');
      return;
    }
    setEditing(null);
    await refetch();
  };

  const deleteRule = async (id: number) => {
    const ok = window.confirm(
      'Delete this rule? Descriptions it matched will revert to pending and be re-categorized by the AI.',
    );
    if (!ok) return;
    const res = await fetch(`/api/maintenance/rules/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'delete failed');
      return;
    }
    await refetch();
  };

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between text-white">
          <h1 className="text-base font-bold">Redan Sales Dashboard — Rules</h1>
        </div>
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"             className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"             className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <Link href="/dashboard/maintenance" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <span                               className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Rules</span>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Categorization Rules</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Patterns are matched case-insensitive against the invoice description. Longest matching pattern wins.
              </p>
            </div>
            <button
              onClick={() => setShowAdd(s => !s)}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              {showAdd ? 'Cancel' : '+ Add rule'}
            </button>
          </div>

          {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          {showAdd && (
            <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-semibold mb-1">Pattern</label>
                  <input
                    value={newPattern}
                    onChange={e => setNewPattern(e.target.value)}
                    placeholder="e.g. pump"
                    className="w-full text-sm border rounded px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Category</label>
                  <select
                    value={newSlug}
                    onChange={e => setNewSlug(e.target.value)}
                    className="text-sm border rounded px-2 py-1"
                  >
                    <option value="">Choose category</option>
                    {cats.map(c => <option key={c.slug} value={c.slug}>{c.displayName}</option>)}
                  </select>
                </div>
                <button
                  onClick={addRule}
                  className="rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Save rule
                </button>
              </div>
            </div>
          )}

          {loading && <div className="text-sm text-gray-600 py-4">Loading…</div>}

          {!loading && (
            <table className="w-full text-xs">
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
      </main>
    </div>
  );
}

function RuleRow({ rule, cats, editing, onEdit, onCancel, onSave, onToggle, onDelete }: {
  rule: Rule;
  cats: CategoryOption[];
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (pattern: string, slug: string) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [pattern, setPattern] = useState(rule.pattern);
  const [slug,    setSlug]    = useState(rule.categorySlug);

  // Reset local state when leaving edit mode without saving.
  useEffect(() => {
    if (!editing) { setPattern(rule.pattern); setSlug(rule.categorySlug); }
  }, [editing, rule.pattern, rule.categorySlug]);

  if (editing) {
    return (
      <tr className="border-b bg-yellow-50">
        <td className="px-3 py-2">
          <input value={pattern} onChange={e => setPattern(e.target.value)}
                 className="w-full text-xs border rounded px-1 py-0.5 font-mono" />
        </td>
        <td className="px-3 py-2">
          <select value={slug} onChange={e => setSlug(e.target.value)}
                  className="text-xs border rounded px-1 py-0.5">
            {cats.map(c => <option key={c.slug} value={c.slug}>{c.displayName}</option>)}
          </select>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{rule.matchCount}</td>
        <td className="px-3 py-2 text-center">—</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button onClick={() => onSave(pattern, slug)} className="text-emerald-700 hover:underline mr-2">Save</button>
          <button onClick={onCancel} className="text-gray-500 hover:underline">Cancel</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-b hover:bg-gray-50 ${rule.isActive ? '' : 'opacity-50'}`}>
      <td className="px-3 py-2 font-mono">{rule.pattern}</td>
      <td className="px-3 py-2">{rule.categoryName}</td>
      <td className="px-3 py-2 text-right tabular-nums">{rule.matchCount}</td>
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={rule.isActive} onChange={onToggle} />
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button onClick={onEdit}   className="text-blue-600 hover:underline mr-2">Edit</button>
        <button onClick={onDelete} className="text-red-600  hover:underline">Delete</button>
      </td>
    </tr>
  );
}

export default function RulesPage() {
  // useSearchParams requires a Suspense boundary in Next 14 App Router.
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-500">Loading…</div>}>
      <RulesPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Smoke test the page in the dev server**

```bash
npm run dev
```

Open `http://localhost:3000/dashboard/maintenance/rules` in a browser. Verify:
- Page loads, table shows existing rules from Task 5 (or "No rules yet")
- `+ Add rule` opens the inline form
- Adding a rule (e.g. `pattern=fire`, `category=Fire & Safety`) saves and refreshes
- Edit + cancel restores the original values
- Edit + save updates the row
- Active checkbox toggle works
- Delete prompts for confirmation, then removes the row

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/maintenance/rules/page.tsx
git commit -m "feat: add categorization Rules admin page"
```

---

## Task 11: "Make this a rule?" link in InvoiceDrawer

**Files:**
- Modify: `components/maintenance/InvoiceDrawer.tsx`

- [ ] **Step 1: Add the link beside staged rows**

In `components/maintenance/InvoiceDrawer.tsx`, locate the row render block. The relevant section currently includes:

```tsx
                    <td className="px-3 py-2">
                      {r.description}
                      {r.documentNo && <span className="ml-1 text-gray-400">#{r.documentNo}</span>}
                      {r.needsReview && (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1 text-amber-800">needs review</span>
                      )}
                      {isModified && (
                        <span className="ml-2 inline-block rounded bg-blue-100 px-1 text-blue-800">modified</span>
                      )}
                    </td>
```

Replace it with:

```tsx
                    <td className="px-3 py-2">
                      {r.description}
                      {r.documentNo && <span className="ml-1 text-gray-400">#{r.documentNo}</span>}
                      {r.needsReview && (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1 text-amber-800">needs review</span>
                      )}
                      {isModified && (
                        <>
                          <span className="ml-2 inline-block rounded bg-blue-100 px-1 text-blue-800">modified</span>
                          <a
                            href={`/dashboard/maintenance/rules?pattern=${encodeURIComponent(norm)}&category_slug=${encodeURIComponent(staged ?? '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-blue-600 hover:underline"
                            title="Open the Rules page with this pattern prefilled"
                          >
                            Make this a rule?
                          </a>
                        </>
                      )}
                    </td>
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Smoke test the link**

```bash
npm run dev
```

Open the Maintenance page, click any site row to open the drawer, change a category in one row. The "Make this a rule?" link should appear next to the row. Clicking it opens `/dashboard/maintenance/rules` in a new tab with the pattern and category prefilled in the Add Rule form.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add components/maintenance/InvoiceDrawer.tsx
git commit -m "feat: add 'Make this a rule?' shortcut from InvoiceDrawer to Rules page"
```

---

## Task 12: End-to-end smoke test against the deployed environment

**Files:**
- None (manual verification)

- [ ] **Step 1: Open a PR and merge**

The branch should have 11 commits at this point. Open a PR:

```bash
gh pr create --title "feat: keyword-based categorization rules" --body "Implements docs/superpowers/specs/2026-05-14-categorization-rules-design.md"
```

Merge via GitHub UI. Wait for Vercel to deploy.

- [ ] **Step 2: Apply the migration to production**

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/rm_keyword_rules.sql
```

Verify:
```bash
psql "$DATABASE_URL" -c "\d rm_keyword_rules"
```

- [ ] **Step 3: Author a rule on production and verify retroactive apply**

In the live app, open `/dashboard/maintenance/rules` and add a rule (e.g. `pattern=pump`, `category=Pumps / Dispensers`). Confirm:
- The match count column updates after save
- The Maintenance page's top-category and category-breakdown chart refresh
- Opening the drawer for any site shows previously-Other descriptions now in Pumps / Dispensers

- [ ] **Step 4: Verify "Make this a rule?" loop end-to-end**

On the Maintenance page, open the drawer for a site that has uncategorized invoices. Change one row's category, click "Make this a rule?". The Rules page should open with the pattern prefilled. Save the rule. Reopen the drawer — other rows with the same description should now show the new category (some from the rule, some from your manual override; both end up displaying the same category).

- [ ] **Step 5: Verify rule delete reverts cleanly**

On the Rules page, delete the rule you just made. Wait ~5 min for the cron to fire (or trigger a manual POST to `/api/maintenance/categorize-batch`). Reopen the drawer — the descriptions that previously matched the deleted rule should now show whatever Claude reassigns them.

- [ ] **Step 6: Record any issues**

If anything fails, capture the response from the failing endpoint via DevTools Network tab and stop. Otherwise, the feature is shipped.
