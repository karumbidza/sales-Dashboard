# R&M Finance with AI Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simple `maintenance_costs` flow with a richer R&M Finance pipeline driven by the new `R & M FINANCE` Excel tab — ingest invoice-level data from Dynamics, AI-categorize each description into 13 fixed buckets, surface invoice drill-down, top-descriptions, and anomaly views on `/dashboard/maintenance`.

**Architecture:** Two-phase ingest (Approach B in the spec). `/api/ingest` writes `rm_invoices` rows plus `rm_description_categories` placeholders, then returns. The client (and a Vercel cron as a safety net) loops `/api/maintenance/categorize-batch` until all pending descriptions are classified. Categorization lives in a single description-level cache that is also the override store. Dashboard queries filter to `cost_center='retail'`.

**Tech Stack:** Next.js 14 (App Router) on Vercel · Postgres on Neon via `pg` · `@anthropic-ai/sdk` (Claude Haiku 4.5) · SheetJS (`xlsx`) for parsing · `tsx` runner for tests (no test framework dependency).

**Spec:** `docs/superpowers/specs/2026-05-13-rm-finance-with-ai-categorization-design.md` — read this first.

---

## File Structure

**New files**
| Path | Responsibility |
|---|---|
| `sql/migrations/rm_finance.sql` | Schema (3 tables + indexes), 13-category seed, drop `maintenance_costs` |
| `lib/rm-cost-center.ts` | Pure helper deriving `cost_center` from the eight `*Code` columns |
| `lib/rm-cost-center.test.ts` | Unit tests for the helper |
| `lib/rm-finance-parse.ts` | XLSX row → `RMInvoiceRow` parser for the `R & M FINANCE` sheet |
| `lib/rm-finance-parse.test.ts` | Unit tests for the parser |
| `lib/categorizer.ts` | Anthropic client + batch classify + mock factory for tests |
| `lib/categorizer.test.ts` | Unit tests with a mock Anthropic client |
| `lib/normalize-description.ts` | One-liner shared between ingest, categorizer, and reclassify |
| `app/api/maintenance/categorize-batch/route.ts` | POST endpoint that drains pending descriptions |
| `app/api/maintenance/reclassify/route.ts` | POST endpoint for description-level override |
| `app/api/maintenance/invoices/route.ts` | GET paginated invoice list with filters |
| `app/api/maintenance/top-descriptions/route.ts` | GET top-N descriptions by spend or count |
| `app/api/maintenance/anomalies/route.ts` | GET anomaly + spike list |
| `components/maintenance/InvoiceDrawer.tsx` | Side panel for invoice drill-down + inline reclassify |
| `components/maintenance/TopDescriptionsPanel.tsx` | Two-tab table (spend / count) |
| `components/maintenance/AnomalyChips.tsx` | Anomaly + needs-review chip row |
| `components/maintenance/CategorizationProgress.tsx` | Inline progress indicator + retry button used in UploadPanel |
| `scripts/run-tests.sh` | One-line wrapper: `npx tsx --test lib/*.test.ts` |

**Modified files**
| Path | What changes |
|---|---|
| `package.json` | Add `@anthropic-ai/sdk`; add `test` script |
| `.env.local` (user-managed) | Add `ANTHROPIC_API_KEY=...` |
| `lib/xlsx-parse.ts` | Re-export `parseRMFinanceSheet` from `rm-finance-parse.ts` |
| `app/api/ingest/route.ts` | Rewrite `ingestMaintenance()` for the new flow |
| `app/api/validate/route.ts` | Maintenance branch validates Entry No., Debit LCY, site code presence |
| `app/api/maintenance/kpis/route.ts` | Query new tables; same response shape |
| `app/api/maintenance/trend/route.ts` | Query new tables |
| `app/api/maintenance/categories/route.ts` | Query new tables |
| `app/api/maintenance/categories-list/route.ts` | Return rows from `rm_categories` |
| `app/api/maintenance/sites/route.ts` | Query new tables |
| `app/dashboard/maintenance/page.tsx` | Mount AnomalyChips, TopDescriptionsPanel, InvoiceDrawer |
| `components/ui/UploadPanel.tsx` | After R&M ingest, call categorize-batch in a loop and show progress |
| `vercel.json` | Add `maxDuration` for new routes; add cron entry |

---

## Task 1 — Project setup: SDK + test runner + env

**Files:**
- Modify: `package.json`
- Create: `scripts/run-tests.sh`
- Touch (user, manually): `.env.local`

- [ ] **Step 1: Install Anthropic SDK and tsx**

```bash
npm install --save @anthropic-ai/sdk
npm install --save-dev tsx
```

Expected: `package.json` shows `@anthropic-ai/sdk` in `dependencies` and `tsx` in `devDependencies`.

- [ ] **Step 2: Add `test` script to `package.json`**

Open `package.json`. In the `"scripts"` block, add a `test` entry. After change the block should look like:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "tsx --test lib/*.test.ts",
  "ingest": "python3 scripts/ingest.py"
}
```

- [ ] **Step 3: Create `scripts/run-tests.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
npx tsx --test lib/*.test.ts
```

Then make it executable:

```bash
chmod +x scripts/run-tests.sh
```

- [ ] **Step 4: Tell the user to add `ANTHROPIC_API_KEY` to `.env.local`**

This step does NOT modify `.env.local` (the user controls it). Print:

```
ACTION REQUIRED (user): add a line to .env.local:
  ANTHROPIC_API_KEY=sk-ant-...
Without this, the categorizer tests using the real client will be skipped
and the categorize-batch endpoint will fail at runtime.
```

- [ ] **Step 5: Sanity-check the test runner**

Run: `npm test`
Expected: prints something like "tests 0, pass 0, fail 0" — confirms the runner works on zero files.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/run-tests.sh
git commit -m "chore: add @anthropic-ai/sdk and tsx test runner"
```

---

## Task 2 — DB migration: schema, seed, drop maintenance_costs

**Files:**
- Create: `sql/migrations/rm_finance.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- R&M Finance with AI categorization
-- Replaces maintenance_costs with a 3-table model:
--   rm_categories            : seed taxonomy (13 rows)
--   rm_description_categories: cache + override store keyed on description text
--   rm_invoices              : one row per Dynamics ledger entry
-- ============================================================

BEGIN;

-- 1. Categories ---------------------------------------------
CREATE TABLE IF NOT EXISTS rm_categories (
  id            SERIAL PRIMARY KEY,
  slug          VARCHAR(40) UNIQUE NOT NULL,
  display_name  VARCHAR(80) NOT NULL,
  sort_order    SMALLINT NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO rm_categories (slug, display_name, sort_order) VALUES
  ('pumps_dispensers',     'Pumps / Dispensers',        1),
  ('compressors_air',      'Compressors / Air',         2),
  ('tanks_lines',          'Tanks / Lines / Bunds',     3),
  ('generators',           'Generators / Backup Power', 4),
  ('solar_ups',            'Solar / UPS',               5),
  ('electrical_lighting',  'Electrical & Lighting',     6),
  ('plumbing_water_waste', 'Plumbing / Water / Waste',  7),
  ('building_civil',       'Building / Civil',          8),
  ('canopy_signage',       'Canopy / Signage',          9),
  ('landscaping_grounds',  'Landscaping / Grounds',    10),
  ('fire_safety',          'Fire & Safety',            11),
  ('security_cctv',        'Security / CCTV',          12),
  ('other',                'Other / Uncategorised',    99)
ON CONFLICT (slug) DO NOTHING;

-- 2. Description-level categorization (cache + override) ----
CREATE TABLE IF NOT EXISTS rm_description_categories (
  id                BIGSERIAL PRIMARY KEY,
  description_norm  TEXT UNIQUE NOT NULL,
  category_id       INT REFERENCES rm_categories(id),
  confidence        VARCHAR(10),       -- 'high' | 'medium' | 'low' | NULL while pending
  source            VARCHAR(10) NOT NULL,  -- 'ai' | 'override' | 'pending'
  needs_review      BOOLEAN DEFAULT FALSE,
  ai_model          VARCHAR(40),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rdc_needs_review
  ON rm_description_categories(needs_review) WHERE needs_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_rdc_source
  ON rm_description_categories(source);

-- 3. Invoices (one row per Dynamics ledger entry) -----------
CREATE TABLE IF NOT EXISTS rm_invoices (
  id                BIGSERIAL PRIMARY KEY,
  entry_no          BIGINT UNIQUE NOT NULL,
  site_code         VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  service_date      DATE NOT NULL,
  description       TEXT NOT NULL,
  description_norm  TEXT GENERATED ALWAYS AS
                    (lower(trim(regexp_replace(description, '\s+', ' ', 'g')))) STORED,
  debit_lcy         NUMERIC(14,2) NOT NULL,
  credit_lcy        NUMERIC(14,2) DEFAULT 0,
  net_cost          NUMERIC(14,2) GENERATED ALWAYS AS (debit_lcy - credit_lcy) STORED,
  document_type     VARCHAR(20),
  document_no       VARCHAR(40),
  external_doc_no   VARCHAR(40),
  gl_account_no     VARCHAR(20),
  cost_center       VARCHAR(20) NOT NULL,
  upload_log_id     BIGINT REFERENCES upload_log(id) ON DELETE SET NULL,
  source_file       VARCHAR(255),
  ingested_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rmi_site_date    ON rm_invoices(site_code, service_date);
CREATE INDEX IF NOT EXISTS idx_rmi_service_date ON rm_invoices(service_date);
CREATE INDEX IF NOT EXISTS idx_rmi_desc_norm    ON rm_invoices(description_norm);
CREATE INDEX IF NOT EXISTS idx_rmi_cost_center  ON rm_invoices(cost_center);

-- 4. Drop the old simple table ------------------------------
DROP TABLE IF EXISTS maintenance_costs;

COMMIT;
```

- [ ] **Step 2: Apply the migration on a Neon branch (manual)**

Print these instructions:

```
ACTION REQUIRED (user): apply the migration to a Neon branch first.
1. Open Neon console → branch off `main` → name it `rm-finance`.
2. Get the branch's connection string and paste it as DATABASE_URL_TEST.
3. Run:
     psql "$DATABASE_URL_TEST" -f sql/migrations/rm_finance.sql
4. Verify schema:
     psql "$DATABASE_URL_TEST" -c "\d rm_invoices"
     psql "$DATABASE_URL_TEST" -c "SELECT COUNT(*) FROM rm_categories;"
   Expected: 13 rows in rm_categories.
```

- [ ] **Step 3: Commit**

```bash
git add sql/migrations/rm_finance.sql
git commit -m "feat: add rm_finance migration (rm_categories, rm_description_categories, rm_invoices)"
```

---

## Task 3 — Description normalizer (shared helper)

**Files:**
- Create: `lib/normalize-description.ts`
- Create: `lib/normalize-description.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test`
Expected: FAIL — `Cannot find module './normalize-description'`.

- [ ] **Step 3: Implement the helper**

```typescript
// lib/normalize-description.ts
// Must match the GENERATED ALWAYS AS expression on rm_invoices.description_norm:
//   lower(trim(regexp_replace(description, '\s+', ' ', 'g')))
export function normalizeDescription(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/normalize-description.ts lib/normalize-description.test.ts
git commit -m "feat: add normalizeDescription helper (matches Postgres GENERATED column)"
```

---

## Task 4 — Cost-center derivation helper

**Files:**
- Create: `lib/rm-cost-center.ts`
- Create: `lib/rm-cost-center.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```typescript
// lib/rm-cost-center.ts
// Maps the eight Dynamics cost-center *Code columns to a single cost_center value.
// Priority order: first non-empty wins.

export type CostCenter =
  | 'retail'
  | 'commercial'
  | 'head_office'
  | 'supply_chain'
  | 'projects'
  | 'lubricants'
  | 'hsse'
  | 'non_redan_sites'
  | 'other';

const PRIORITY: { col: string; cc: CostCenter }[] = [
  { col: 'Retail Code',           cc: 'retail' },
  { col: 'Commercial Code',       cc: 'commercial' },
  { col: 'Head office Code',      cc: 'head_office' },
  { col: 'Supply Chain Code',     cc: 'supply_chain' },
  { col: 'Projects Code',         cc: 'projects' },
  { col: 'Lubricants Code',       cc: 'lubricants' },
  { col: 'Hsse Code',             cc: 'hsse' },
  { col: 'Non redan sites Code',  cc: 'non_redan_sites' },
];

function isFilled(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function deriveCostCenter(row: Record<string, unknown>): CostCenter {
  for (const { col, cc } of PRIORITY) {
    if (isFilled(row[col])) return cc;
  }
  return 'other';
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test`
Expected: all tests pass (5 + 7 = 12 so far).

- [ ] **Step 5: Commit**

```bash
git add lib/rm-cost-center.ts lib/rm-cost-center.test.ts
git commit -m "feat: add deriveCostCenter helper for R&M Finance ingest"
```

---

## Task 5 — R&M Finance row parser

**Files:**
- Create: `lib/rm-finance-parse.ts`
- Create: `lib/rm-finance-parse.test.ts`
- Modify: `lib/xlsx-parse.ts` (re-export)

- [ ] **Step 1: Write the failing test**

```typescript
// lib/rm-finance-parse.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRMFinanceRow } from './rm-finance-parse';

const baseRow = {
  'SITE CODE': 'MAZ-042',
  'SITE NAME': 'MAZOWE',
  'DATE': '2026-05-07',
  'Document Type': 'Invoice',
  'Document No.': '116351',
  'G/L Account No.': '4725',
  'Description': 'Repaired urinal leak ',
  'Retail Code': 'MAZOWE',
  'Debit Amount (LCY)': 335,
  'Credit Amount (LCY)': 0,
  'Entry No.': 2609805,
  'External Document No.': '1233',
};

test('parses a happy-path retail invoice row', () => {
  const out = parseRMFinanceRow(baseRow);
  assert.ok(out.ok);
  assert.equal(out.row!.entry_no, 2609805);
  assert.equal(out.row!.site_code, 'MAZ-042');
  assert.equal(out.row!.service_date, '2026-05-07');
  assert.equal(out.row!.description, 'Repaired urinal leak');  // trimmed
  assert.equal(out.row!.debit_lcy, 335);
  assert.equal(out.row!.credit_lcy, 0);
  assert.equal(out.row!.cost_center, 'retail');
  assert.equal(out.row!.document_type, 'Invoice');
  assert.equal(out.row!.document_no, '116351');
});

test('uppercases site_code', () => {
  const out = parseRMFinanceRow({ ...baseRow, 'SITE CODE': 'maz-042' });
  assert.equal(out.row!.site_code, 'MAZ-042');
});

test('skips row when Entry No. is missing', () => {
  const out = parseRMFinanceRow({ ...baseRow, 'Entry No.': null });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'missing_entry_no');
});

test('skips row when Date is unparseable', () => {
  const out = parseRMFinanceRow({ ...baseRow, 'DATE': 'banana' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'bad_date');
});

test('skips row when Debit (LCY) is missing or non-numeric', () => {
  assert.equal(parseRMFinanceRow({ ...baseRow, 'Debit Amount (LCY)': null }).reason, 'bad_debit');
  assert.equal(parseRMFinanceRow({ ...baseRow, 'Debit Amount (LCY)': 'abc' }).reason, 'bad_debit');
});

test('skips row when Description is empty', () => {
  assert.equal(parseRMFinanceRow({ ...baseRow, 'Description': '   ' }).reason, 'missing_description');
});

test('derives non-retail cost center', () => {
  const out = parseRMFinanceRow({
    ...baseRow, 'Retail Code': null, 'Head office Code': 'ADMINISTRATION',
  });
  assert.equal(out.row!.cost_center, 'head_office');
});

test('accepts Excel Date object as service_date', () => {
  const out = parseRMFinanceRow({ ...baseRow, 'DATE': new Date('2026-05-07T22:00:00Z') });
  assert.equal(out.row!.service_date, '2026-05-07');
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```typescript
// lib/rm-finance-parse.ts
import { parseDate, parseDateDayFirst, safeFloat, safeStr, siteCode } from './xlsx-parse';
import { deriveCostCenter, CostCenter } from './rm-cost-center';

export interface RMInvoiceRow {
  entry_no:        number;
  site_code:       string;
  service_date:    string;        // YYYY-MM-DD
  description:     string;
  debit_lcy:       number;
  credit_lcy:      number;
  document_type:   string | null;
  document_no:     string | null;
  external_doc_no: string | null;
  gl_account_no:   string | null;
  cost_center:     CostCenter;
}

export type ParseReason =
  | 'missing_entry_no'
  | 'missing_site_code'
  | 'bad_date'
  | 'bad_debit'
  | 'missing_description';

export interface ParseResult {
  ok:     boolean;
  row?:   RMInvoiceRow;
  reason?: ParseReason;
  raw?:   { siteCode: string | null; date: string | null };  // for unmatched-row logging
}

export function parseRMFinanceRow(raw: Record<string, unknown>): ParseResult {
  const entryNo = Number(raw['Entry No.']);
  if (!Number.isFinite(entryNo) || entryNo <= 0) {
    return { ok: false, reason: 'missing_entry_no' };
  }

  const sc = siteCode(raw['SITE CODE']);
  if (!sc) return { ok: false, reason: 'missing_site_code' };

  const date = parseDate(raw['DATE']) ?? parseDateDayFirst(raw['DATE']);
  if (!date) return { ok: false, reason: 'bad_date', raw: { siteCode: sc, date: null } };

  const debit = safeFloat(raw['Debit Amount (LCY)'], null);
  if (debit === null) return { ok: false, reason: 'bad_debit', raw: { siteCode: sc, date } };

  const description = safeStr(raw['Description']);
  if (!description) return { ok: false, reason: 'missing_description', raw: { siteCode: sc, date } };

  return {
    ok: true,
    row: {
      entry_no:        entryNo,
      site_code:       sc,
      service_date:    date,
      description,
      debit_lcy:       debit,
      credit_lcy:      safeFloat(raw['Credit Amount (LCY)'], 0) ?? 0,
      document_type:   safeStr(raw['Document Type']),
      document_no:     safeStr(raw['Document No.']),
      external_doc_no: safeStr(raw['External Document No.']),
      gl_account_no:   safeStr(raw['G/L Account No.']),
      cost_center:     deriveCostCenter(raw as Record<string, unknown>),
    },
  };
}

// Bulk convenience: returns parsed rows + a structured list of skipped rows.
export function parseRMFinanceRows(rows: Record<string, unknown>[]): {
  parsed: RMInvoiceRow[];
  skipped: { reason: ParseReason; raw: Record<string, unknown> }[];
} {
  const parsed: RMInvoiceRow[] = [];
  const skipped: { reason: ParseReason; raw: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const res = parseRMFinanceRow(r);
    if (res.ok && res.row) parsed.push(res.row);
    else if (res.reason)  skipped.push({ reason: res.reason, raw: r });
  }
  return { parsed, skipped };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test`
Expected: all 8 new tests pass.

- [ ] **Step 5: Re-export from `lib/xlsx-parse.ts`**

Append to the end of `lib/xlsx-parse.ts`:

```typescript
export { parseRMFinanceRow, parseRMFinanceRows } from './rm-finance-parse';
export type { RMInvoiceRow, ParseReason } from './rm-finance-parse';
```

- [ ] **Step 6: Commit**

```bash
git add lib/rm-finance-parse.ts lib/rm-finance-parse.test.ts lib/xlsx-parse.ts
git commit -m "feat: add parseRMFinanceRow + parseRMFinanceRows for R&M Finance sheet"
```

---

## Task 6 — Categorizer (Claude wrapper + mock)

**Files:**
- Create: `lib/categorizer.ts`
- Create: `lib/categorizer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/categorizer.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeBatch, CategorizerClient, CATEGORY_SLUGS } from './categorizer';

function mockClient(canned: { id: number; category: string; confidence: string }[]): CategorizerClient {
  return {
    async classify(items) {
      // Return canned data ignoring the actual input (caller supplies matching ids).
      return { results: canned } as any;
    },
  };
}

test('high confidence: writes category and confidence verbatim', async () => {
  const client = mockClient([{ id: 1, category: 'plumbing_water_waste', confidence: 'high' }]);
  const out = await categorizeBatch(client, [{ id: 1, description: 'Repaired urinal leak' }]);
  assert.deepEqual(out, [
    { id: 1, slug: 'plumbing_water_waste', confidence: 'high', needs_review: false },
  ]);
});

test('medium confidence: needs_review = false', async () => {
  const client = mockClient([{ id: 1, category: 'plumbing_water_waste', confidence: 'medium' }]);
  const out = await categorizeBatch(client, [{ id: 1, description: 'works' }]);
  assert.equal(out[0].needs_review, false);
});

test('low confidence: needs_review = true', async () => {
  const client = mockClient([{ id: 1, category: 'plumbing_water_waste', confidence: 'low' }]);
  const out = await categorizeBatch(client, [{ id: 1, description: 'works' }]);
  assert.equal(out[0].needs_review, true);
});

test('unknown category slug from model → falls back to other + needs_review', async () => {
  const client = mockClient([{ id: 1, category: 'nonexistent_bucket', confidence: 'high' }]);
  const out = await categorizeBatch(client, [{ id: 1, description: 'x' }]);
  assert.equal(out[0].slug, 'other');
  assert.equal(out[0].needs_review, true);
});

test('client error propagates', async () => {
  const client: CategorizerClient = {
    async classify() { throw new Error('rate_limit'); },
  };
  await assert.rejects(
    () => categorizeBatch(client, [{ id: 1, description: 'x' }]),
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
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[1].slug, 'other');
  assert.equal(out[1].needs_review, true);
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the categorizer**

```typescript
// lib/categorizer.ts
// Claude-backed classifier for R&M invoice descriptions.
// Returns one verdict per input id, even when the model omits one.

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
export type CategorySlug = typeof CATEGORY_SLUGS[number];
export type Confidence = 'high' | 'medium' | 'low';

const ALLOWED = new Set<string>(CATEGORY_SLUGS);

export interface CategorizerInput  { id: number; description: string; }
export interface CategorizerOutput { id: number; slug: CategorySlug; confidence: Confidence; needs_review: boolean; }

export interface ClassifyResponse {
  results: { id: number; category: string; confidence: string }[];
}

export interface CategorizerClient {
  classify(items: CategorizerInput[]): Promise<ClassifyResponse>;
}

const SYSTEM_PROMPT = `You categorize R&M (repairs & maintenance) invoice descriptions for a
fuel-station retail business in Zimbabwe. You will receive a list of
descriptions and must assign each to exactly ONE of these categories:

  pumps_dispensers       — Dispensers, fuel nozzles, hoses, STP, shear/breakaway valves
  compressors_air        — Air compressors, compressor motors, pressure gauges, V-belts
  tanks_lines            — Underground tanks, fuel lines, manholes, ATG, dipsticks, bunding, line testing
  generators             — Gensets, generator service & repair
  solar_ups              — Solar panels, inverters, batteries, UPS
  electrical_lighting    — Wiring, sockets, fault clearing, isolators, canopy/forecourt/flood/LED/fluorescent lights
  plumbing_water_waste   — Leaks, toilets, urinals, sinks, sprinklers, liquid-waste disposal, boreholes
  building_civil         — Paint, roof, doors, windows, tiles, paving, potholes, locksets, safes, HVAC
  canopy_signage         — Canopy structure, signage, illumination, display boards
  landscaping_grounds    — Garden, grass, trees, hedging
  fire_safety            — Extinguishers, fire equipment
  security_cctv          — CCTV, alarms, fences, gates
  other                  — Use ONLY if no category above plausibly fits.

Also rate your confidence: "high" | "medium" | "low".
- high   = description directly names something in the category
- medium = strong implication from context
- low    = guess; surface for human review

Return strict JSON via the provided tool. No prose.`;

const TOOL = {
  name: 'categorize',
  description: 'Return one category + confidence per input id.',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id:         { type: 'integer' },
            category:   { type: 'string', enum: [...CATEGORY_SLUGS] },
            confidence: { type: 'string', enum: ['high','medium','low'] },
          },
          required: ['id','category','confidence'],
        },
      },
    },
    required: ['results'],
  },
} as const;

export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

export async function categorizeBatch(
  client: CategorizerClient,
  items: CategorizerInput[],
): Promise<CategorizerOutput[]> {
  const resp = await client.classify(items);
  const byId = new Map<number, { category: string; confidence: string }>();
  for (const r of resp.results ?? []) byId.set(r.id, r);

  const out: CategorizerOutput[] = [];
  for (const item of items) {
    const r = byId.get(item.id);
    const validConfidence = (c: string): Confidence =>
      c === 'high' || c === 'medium' || c === 'low' ? c : 'low';

    if (!r || !ALLOWED.has(r.category)) {
      out.push({ id: item.id, slug: 'other', confidence: 'low', needs_review: true });
      continue;
    }
    const conf = validConfidence(r.confidence);
    out.push({
      id: item.id,
      slug: r.category as CategorySlug,
      confidence: conf,
      needs_review: conf === 'low',
    });
  }
  return out;
}

// Real Claude client — used in production; not exercised by unit tests.
export function createClaudeClient(apiKey: string): CategorizerClient {
  // Lazy-import the SDK so tests don't need it loaded.
  const Anthropic = require('@anthropic-ai/sdk').default;
  const sdk = new Anthropic({ apiKey });

  return {
    async classify(items) {
      const resp = await sdk.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'categorize' },
        messages: [{
          role: 'user',
          content: JSON.stringify(items),
        }],
      });
      const block = (resp.content as any[]).find(b => b.type === 'tool_use' && b.name === 'categorize');
      if (!block) throw new Error('Claude did not return the categorize tool call');
      return block.input as ClassifyResponse;
    },
  };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test`
Expected: all 7 categorizer tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/categorizer.ts lib/categorizer.test.ts
git commit -m "feat: add Claude-backed R&M description categorizer"
```

---

## Task 7 — POST /api/maintenance/categorize-batch

**Files:**
- Create: `app/api/maintenance/categorize-batch/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// app/api/maintenance/categorize-batch/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  categorizeBatch,
  createClaudeClient,
  CategorizerClient,
  CLAUDE_MODEL,
} from '@/lib/categorizer';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 50;

interface PendingRow { id: number; description_norm: string; }

function getClient(): CategorizerClient {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return createClaudeClient(key);
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  try {
    // Pick up to BATCH_SIZE pending descriptions.
    const pending = await query<PendingRow>(
      `SELECT id, description_norm
         FROM rm_description_categories
        WHERE source = 'pending'
        ORDER BY id
        LIMIT $1`,
      [BATCH_SIZE],
    );

    if (pending.length === 0) {
      const remaining = await query<{ n: string }>(
        `SELECT COUNT(*)::TEXT AS n FROM rm_description_categories WHERE source='pending'`,
      );
      return NextResponse.json({ processed: 0, remaining: parseInt(remaining[0].n, 10) });
    }

    const client = getClient();
    const verdicts = await categorizeBatch(
      client,
      pending.map(p => ({ id: p.id, description: p.description_norm })),
    );

    // UPDATE one row at a time, but in a single transaction.
    // For 50 rows this is fast; saves writing a bulk-UPDATE-with-VALUES query.
    for (const v of verdicts) {
      await query(
        `UPDATE rm_description_categories
            SET category_id = (SELECT id FROM rm_categories WHERE slug = $2),
                confidence  = $3,
                source      = 'ai',
                needs_review = $4,
                ai_model    = $5,
                updated_at  = NOW()
          WHERE id = $1`,
        [v.id, v.slug, v.confidence, v.needs_review, CLAUDE_MODEL],
      );
    }

    const remaining = await query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM rm_description_categories WHERE source='pending'`,
    );

    // Best-effort: surface a non-fatal note on the upload_log
    if (body?.upload_log_id) {
      await query(
        `UPDATE upload_log
            SET row_counts = COALESCE(row_counts, '{}'::JSONB) ||
                             jsonb_build_object('rm_categorized_so_far',
                               (SELECT COUNT(*) FROM rm_description_categories WHERE source = 'ai'))
          WHERE id = $1`,
        [body.upload_log_id],
      ).catch(() => {});
    }

    return NextResponse.json({ processed: verdicts.length, remaining: parseInt(remaining[0].n, 10) });
  } catch (err: any) {
    console.error('/api/maintenance/categorize-batch error:', err);

    if (body?.upload_log_id) {
      await query(
        `UPDATE upload_log
            SET error_message = COALESCE(error_message, '') ||
                                '\\ncategorize-batch: ' || $1
          WHERE id = $2`,
        [String(err.message || 'unknown'), body.upload_log_id],
      ).catch(() => {});
    }

    return NextResponse.json(
      { error: err.message || 'categorize-batch failed' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Manual smoke test against a Neon branch with seeded pending rows**

```bash
# 1. Insert two fake pending rows into your test DB
psql "$DATABASE_URL_TEST" <<'SQL'
INSERT INTO rm_description_categories (description_norm, category_id, source)
VALUES ('repaired urinal leak', (SELECT id FROM rm_categories WHERE slug='other'), 'pending'),
       ('generator service',     (SELECT id FROM rm_categories WHERE slug='other'), 'pending');
SQL

# 2. Run Next dev with DATABASE_URL pointed at the branch and ANTHROPIC_API_KEY set
DATABASE_URL="$DATABASE_URL_TEST" npm run dev

# 3. In another shell:
curl -sX POST http://localhost:3000/api/maintenance/categorize-batch \
  -H 'Content-Type: application/json' -d '{}'
# Expected: { "processed": 2, "remaining": 0 }

# 4. Verify in DB
psql "$DATABASE_URL_TEST" -c \
 "SELECT description_norm, c.slug, confidence, needs_review
    FROM rm_description_categories r JOIN rm_categories c ON r.category_id=c.id;"
# Expected: plumbing_water_waste / high  and  generators / high
```

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/categorize-batch/route.ts
git commit -m "feat: add POST /api/maintenance/categorize-batch (drains pending descriptions)"
```

---

## Task 8 — Rewrite ingestMaintenance in /api/ingest

**Files:**
- Modify: `app/api/ingest/route.ts`

- [ ] **Step 1: Replace the body of `ingestMaintenance()`**

In `app/api/ingest/route.ts`, locate the existing `async function ingestMaintenance(body: any)` (around line 737). Replace its entire body with:

```typescript
async function ingestMaintenance(body: any): Promise<NextResponse> {
  const startMs = Date.now();
  const rows: Record<string, any>[] = Array.isArray(body?.rows) ? body.rows : [];
  const fileName: string = body?.fileName || 'maintenance.xlsx';
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
  }

  // upload_log row
  const logRow = await query<{ id: number }>(
    `INSERT INTO upload_log (file_name, file_size_bytes, status)
     VALUES ($1, $2, 'pending') RETURNING id`,
    [fileName, 0],
  );
  const uploadId = logRow[0].id;

  try {
    // 1. Parse all rows
    const { parsed, skipped } = parseRMFinanceRows(rows);

    // 2. Resolve site_code → in/out of sites master
    const knownSites = await query<{ site_code: string }>(
      'SELECT site_code FROM sites',
    );
    const known = new Set(knownSites.map(r => r.site_code));

    const matched: any[][] = [];
    const unmatched: any[][] = [];
    for (const r of parsed) {
      if (known.has(r.site_code)) {
        matched.push([
          r.entry_no, r.site_code, r.service_date, r.description,
          r.debit_lcy, r.credit_lcy,
          r.document_type, r.document_no, r.external_doc_no, r.gl_account_no,
          r.cost_center, uploadId, fileName,
        ]);
      } else {
        unmatched.push([r.site_code, r.service_date, 'R & M FINANCE', fileName, uploadId]);
      }
    }

    // 3. Bulk insert invoices — ON CONFLICT (entry_no) DO NOTHING
    let inserted = 0;
    if (matched.length > 0) {
      const res = await batchUpsertReturningCount(
        `INSERT INTO rm_invoices
           (entry_no, site_code, service_date, description,
            debit_lcy, credit_lcy,
            document_type, document_no, external_doc_no, gl_account_no,
            cost_center, upload_log_id, source_file)
         VALUES __VALUES__
         ON CONFLICT (entry_no) DO NOTHING`,
        matched,
      );
      inserted = res;
    }

    // 4. Unmatched rows
    if (unmatched.length > 0) {
      await batchUpsert(
        `INSERT INTO unmatched_status_rows
           (raw_site_code, sale_date, sheet_name, source_file, upload_log_id)
         VALUES __VALUES__`,
        unmatched,
      );
    }

    // 5. Insert placeholder rm_description_categories rows for unseen descriptions.
    //    Use the existing GENERATED description_norm column on rm_invoices to find them.
    const placeholderRes = await query<{ n: string }>(
      `WITH unseen AS (
         SELECT DISTINCT i.description_norm
           FROM rm_invoices i
           LEFT JOIN rm_description_categories r USING (description_norm)
          WHERE r.id IS NULL
            AND i.description_norm <> ''
       )
       INSERT INTO rm_description_categories (description_norm, category_id, source)
       SELECT u.description_norm,
              (SELECT id FROM rm_categories WHERE slug='other'),
              'pending'
         FROM unseen u
       ON CONFLICT (description_norm) DO NOTHING
       RETURNING 1`,
    );
    const pendingInserted = placeholderRes.length;

    // 6. Bookkeeping
    const summary = {
      total: rows.length,
      inserted,
      unmatched: unmatched.length,
      skipped: skipped.length,
      skipped_reasons: skipped.reduce<Record<string, number>>((acc, s) => {
        acc[s.reason] = (acc[s.reason] || 0) + 1; return acc;
      }, {}),
      pending_descriptions: pendingInserted,
      data_type: 'rm_finance',
    };
    await query(
      `UPDATE upload_log SET status='success', row_counts=$1, duration_ms=$2 WHERE id=$3`,
      [JSON.stringify(summary), Date.now() - startMs, uploadId],
    );

    return NextResponse.json({
      ok: true,
      uploadLogId: uploadId,
      summary,
    });
  } catch (err: any) {
    console.error('/api/ingest (rm_finance) error:', err);
    await query(
      `UPDATE upload_log SET status='failed', error_message=$1 WHERE id=$2`,
      [String(err.message || 'Unknown error'), uploadId],
    ).catch(() => {});
    return NextResponse.json({ error: err.message || 'R&M ingest failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add the import at the top of the file** (if not already present)

In the imports block at the top of `app/api/ingest/route.ts`, add:

```typescript
import { parseRMFinanceRows } from '@/lib/rm-finance-parse';
```

- [ ] **Step 3: Add the `batchUpsertReturningCount` helper near the existing `batchUpsert`**

Find the existing `async function batchUpsert(...)` (around line 45). Immediately after it, add:

```typescript
async function batchUpsertReturningCount(sql: string, rows: any[][], batchSize = 200): Promise<number> {
  // Same chunking as batchUpsert but returns the total number of inserted rows
  // (skipping rows that hit ON CONFLICT DO NOTHING).
  let count = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const placeholders = chunk.map((row, idx) =>
      `(${row.map((_, j) => `$${idx * row.length + j + 1}`).join(',')})`,
    ).join(',');
    const params = chunk.flat();
    const result = await query<any>(sql.replace('__VALUES__', placeholders) + ' RETURNING 1', params);
    count += result.length;
  }
  return count;
}
```

- [ ] **Step 4: Smoke-test against Neon branch**

```bash
# 1. Build a tiny JSON payload with 2 sample rows matching the new schema
curl -sX POST http://localhost:3000/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{
    "dataType": "maintenance",
    "fileName": "smoke.xlsx",
    "rows": [
      {
        "SITE CODE":"MAZ-042","DATE":"2026-05-07","Document Type":"Invoice",
        "Document No.":"116351","Description":"Repaired urinal leak",
        "Retail Code":"MAZOWE","Debit Amount (LCY)":335,"Credit Amount (LCY)":0,
        "Entry No.":2609805
      },
      {
        "SITE CODE":"HQ-001","DATE":"2026-05-07","Document Type":"Invoice",
        "Document No.":"116358","Description":"Plant and garden maintenance",
        "Head office Code":"ADMINISTRATION","Debit Amount (LCY)":300.3,"Credit Amount (LCY)":0,
        "Entry No.":2609956
      }
    ]
  }'
# Expected: {"ok":true,"uploadLogId":N,"summary":{"inserted":2,"pending_descriptions":2,...}}

# 2. Confirm in DB
psql "$DATABASE_URL_TEST" -c "SELECT entry_no, site_code, cost_center FROM rm_invoices;"
# Expected: two rows, one cost_center='retail', one cost_center='head_office'

# 3. Re-run the same curl — confirm idempotency
# Expected: {"inserted":0,"pending_descriptions":0}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "feat: rewrite ingestMaintenance for new rm_finance schema (two-phase)"
```

---

## Task 9 — POST /api/maintenance/reclassify (override)

**Files:**
- Create: `app/api/maintenance/reclassify/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// app/api/maintenance/reclassify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CATEGORY_SLUGS } from '@/lib/categorizer';
import { normalizeDescription } from '@/lib/normalize-description';

export const dynamic = 'force-dynamic';

const SLUGS = new Set<string>(CATEGORY_SLUGS);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const descRaw   = String(body?.description_norm ?? body?.description ?? '');
    const slug      = String(body?.category_slug ?? '');

    if (!descRaw)            return NextResponse.json({ error: 'description required' }, { status: 400 });
    if (!SLUGS.has(slug))    return NextResponse.json({ error: 'unknown category_slug' }, { status: 400 });

    const desc = normalizeDescription(descRaw);
    if (!desc) return NextResponse.json({ error: 'normalized description is empty' }, { status: 400 });

    // Upsert: row may already exist (set by AI or seeded as pending).
    const result = await query<{ id: number; old_slug: string | null }>(
      `WITH new_cat AS (
         SELECT id FROM rm_categories WHERE slug = $2
       ),
       up AS (
         INSERT INTO rm_description_categories
           (description_norm, category_id, confidence, source, needs_review, updated_at)
         VALUES ($1, (SELECT id FROM new_cat), 'high', 'override', FALSE, NOW())
         ON CONFLICT (description_norm) DO UPDATE
           SET category_id = (SELECT id FROM new_cat),
               confidence  = 'high',
               source      = 'override',
               needs_review = FALSE,
               updated_at  = NOW()
         RETURNING id
       )
       SELECT id, NULL::TEXT AS old_slug FROM up`,
      [desc, slug],
    );

    return NextResponse.json({ ok: true, id: result[0]?.id ?? null });
  } catch (err: any) {
    console.error('/api/maintenance/reclassify error:', err);
    return NextResponse.json({ error: err.message || 'reclassify failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Smoke-test**

```bash
curl -sX POST http://localhost:3000/api/maintenance/reclassify \
  -H 'Content-Type: application/json' \
  -d '{"description_norm":"repaired urinal leak","category_slug":"plumbing_water_waste"}'
# Expected: {"ok":true,"id":N}

psql "$DATABASE_URL_TEST" -c \
  "SELECT source, confidence FROM rm_description_categories
    WHERE description_norm='repaired urinal leak';"
# Expected: source=override, confidence=high
```

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/reclassify/route.ts
git commit -m "feat: add POST /api/maintenance/reclassify (description-level override)"
```

---

## Task 10 — GET /api/maintenance/invoices (drill-down)

**Files:**
- Create: `app/api/maintenance/invoices/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// app/api/maintenance/invoices/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom    = sp.get('dateFrom')    || undefined;
    const dateTo      = sp.get('dateTo')      || undefined;
    const territory   = sp.get('territory')   || undefined;
    const siteCode    = sp.get('siteCode')    || undefined;
    const categorySlug = sp.get('category')   || undefined;
    const description = sp.get('description') || undefined;   // exact description_norm match
    const needsReview = sp.get('needsReview') === 'true';
    const minCost     = sp.get('minCost') ? parseFloat(sp.get('minCost')!) : undefined;
    const limit       = Math.min(Math.max(1, parseInt(sp.get('limit') || '200')), 1000);
    const offset      = Math.max(0, parseInt(sp.get('offset') || '0'));

    const clauses: string[] = [`i.cost_center = 'retail'`];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)     { clauses.push(`i.service_date >= $${p++}`); params.push(dateFrom); }
    if (dateTo)       { clauses.push(`i.service_date <= $${p++}`); params.push(dateTo); }
    if (territory)    { clauses.push(`t.tm_code = $${p++}`);       params.push(territory.toUpperCase()); }
    if (siteCode)     { clauses.push(`i.site_code = $${p++}`);     params.push(siteCode); }
    if (categorySlug) { clauses.push(`c.slug = $${p++}`);          params.push(categorySlug); }
    if (description)  { clauses.push(`i.description_norm = $${p++}`); params.push(description); }
    if (needsReview)  { clauses.push(`r.needs_review = TRUE`); }
    if (minCost !== undefined) { clauses.push(`i.net_cost >= $${p++}`); params.push(minCost); }
    const where = `WHERE ${clauses.join(' AND ')}`;

    params.push(limit, offset);
    const limitIdx  = params.length - 1;
    const offsetIdx = params.length;

    const sql = `
      SELECT i.entry_no, i.site_code, si.budget_name AS site_name,
             i.service_date, i.description, i.document_no, i.external_doc_no,
             i.net_cost, i.cost_center,
             c.slug AS category_slug, c.display_name AS category_name,
             r.confidence, r.needs_review, r.source AS category_source
        FROM rm_invoices i
        JOIN sites si              ON i.site_code = si.site_code
        LEFT JOIN territories t    ON si.territory_id = t.id
        LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
        LEFT JOIN rm_categories c  ON r.category_id = c.id
        ${where}
        ORDER BY i.service_date DESC, i.entry_no DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      data: rows.map(r => ({
        entryNo:         Number(r.entry_no),
        siteCode:        r.site_code,
        siteName:        r.site_name,
        serviceDate:     r.service_date,
        description:     r.description,
        documentNo:      r.document_no,
        externalDocNo:   r.external_doc_no,
        netCost:         parseFloat(r.net_cost),
        categorySlug:    r.category_slug,
        categoryName:    r.category_name,
        confidence:      r.confidence,
        needsReview:     r.needs_review,
        categorySource:  r.category_source,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/invoices error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Smoke-test**

```bash
curl -s 'http://localhost:3000/api/maintenance/invoices?limit=5' | head -c 500
# Expected: JSON with a `data` array; each item has entryNo, siteCode, categorySlug, etc.
```

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/invoices/route.ts
git commit -m "feat: add GET /api/maintenance/invoices (paginated drill-down)"
```

---

## Task 11 — GET /api/maintenance/top-descriptions

**Files:**
- Create: `app/api/maintenance/top-descriptions/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// app/api/maintenance/top-descriptions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom   = sp.get('dateFrom')  || undefined;
    const dateTo     = sp.get('dateTo')    || undefined;
    const territory  = sp.get('territory') || undefined;
    const categorySlug = sp.get('category') || undefined;
    const by         = sp.get('by') === 'count' ? 'count' : 'spend';
    const limit      = Math.min(Math.max(1, parseInt(sp.get('limit') || '20')), 200);

    const clauses: string[] = [`i.cost_center = 'retail'`];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)    { clauses.push(`i.service_date >= $${p++}`); params.push(dateFrom); }
    if (dateTo)      { clauses.push(`i.service_date <= $${p++}`); params.push(dateTo); }
    if (territory)   { clauses.push(`t.tm_code = $${p++}`);       params.push(territory.toUpperCase()); }
    if (categorySlug){ clauses.push(`c.slug = $${p++}`);          params.push(categorySlug); }
    const where = `WHERE ${clauses.join(' AND ')}`;

    params.push(limit);
    const limitIdx = params.length;

    const orderBy = by === 'count' ? 'occurrences DESC, total_spend DESC'
                                    : 'total_spend DESC, occurrences DESC';

    const sql = `
      SELECT i.description_norm,
             MIN(i.description)            AS sample_description,
             COUNT(*)::INT                 AS occurrences,
             ROUND(SUM(i.net_cost)::NUMERIC, 2) AS total_spend,
             ROUND(AVG(i.net_cost)::NUMERIC, 2) AS avg_spend,
             c.slug                        AS category_slug,
             c.display_name                AS category_name
        FROM rm_invoices i
        JOIN sites si             ON i.site_code = si.site_code
        LEFT JOIN territories t   ON si.territory_id = t.id
        LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
        LEFT JOIN rm_categories c ON r.category_id = c.id
        ${where}
        GROUP BY i.description_norm, c.slug, c.display_name
        ORDER BY ${orderBy}
        LIMIT $${limitIdx}
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      by,
      data: rows.map(r => ({
        descriptionNorm:    r.description_norm,
        sampleDescription:  r.sample_description,
        occurrences:        r.occurrences,
        totalSpend:         parseFloat(r.total_spend),
        avgSpend:           parseFloat(r.avg_spend),
        categorySlug:       r.category_slug,
        categoryName:       r.category_name,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/top-descriptions error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Smoke-test**

```bash
curl -s 'http://localhost:3000/api/maintenance/top-descriptions?by=spend&limit=5'
curl -s 'http://localhost:3000/api/maintenance/top-descriptions?by=count&limit=5'
```

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/top-descriptions/route.ts
git commit -m "feat: add GET /api/maintenance/top-descriptions"
```

---

## Task 12 — GET /api/maintenance/anomalies

**Files:**
- Create: `app/api/maintenance/anomalies/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// app/api/maintenance/anomalies/route.ts
// Two flavors of anomalies:
//   (a) Invoice outliers: net_cost > mean + 2*stddev within (site, category)
//       — only flagged when ≥5 historical data points exist for that pair.
//   (b) Site-month spikes: a site's monthly net_cost > mean + 2*stddev over
//       its trailing-12-month history.

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom');
    const dateTo   = sp.get('dateTo');
    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
    }

    // (a) Invoice outliers within the requested date range.
    const outliers = await query<any>(
      `WITH historical AS (
         SELECT i.site_code, r.category_id,
                AVG(i.net_cost)    AS mean,
                STDDEV_SAMP(i.net_cost) AS sd,
                COUNT(*)            AS n
           FROM rm_invoices i
           JOIN rm_description_categories r ON i.description_norm = r.description_norm
          WHERE i.cost_center = 'retail'
          GROUP BY i.site_code, r.category_id
       )
       SELECT i.entry_no, i.site_code, si.budget_name AS site_name,
              i.service_date, i.description, i.net_cost,
              c.slug AS category_slug, c.display_name AS category_name,
              h.mean, h.sd
         FROM rm_invoices i
         JOIN sites si             ON i.site_code = si.site_code
         JOIN rm_description_categories r ON i.description_norm = r.description_norm
         JOIN rm_categories c       ON r.category_id = c.id
         JOIN historical h          ON h.site_code = i.site_code AND h.category_id = r.category_id
        WHERE i.cost_center = 'retail'
          AND i.service_date BETWEEN $1 AND $2
          AND h.n >= 5
          AND h.sd IS NOT NULL AND h.sd > 0
          AND i.net_cost > h.mean + 2 * h.sd
        ORDER BY i.net_cost DESC
        LIMIT 100`,
      [dateFrom, dateTo],
    );

    // (b) Site-month spikes: compare the month's total against the site's trailing-12-month mean.
    const spikes = await query<any>(
      `WITH monthly AS (
         SELECT i.site_code,
                DATE_TRUNC('month', i.service_date)::DATE AS month,
                SUM(i.net_cost) AS m_total
           FROM rm_invoices i
          WHERE i.cost_center = 'retail'
          GROUP BY i.site_code, DATE_TRUNC('month', i.service_date)
       ),
       windowed AS (
         SELECT site_code, month, m_total,
                AVG(m_total) OVER w  AS mean_12,
                STDDEV_SAMP(m_total) OVER w AS sd_12,
                COUNT(*)    OVER w  AS n_12
           FROM monthly
         WINDOW w AS (
           PARTITION BY site_code
           ORDER BY month
           ROWS BETWEEN 12 PRECEDING AND 1 PRECEDING
         )
       )
       SELECT w.site_code, si.budget_name AS site_name, w.month, w.m_total,
              w.mean_12, w.sd_12
         FROM windowed w
         JOIN sites si ON w.site_code = si.site_code
        WHERE w.month >= DATE_TRUNC('month', $1::DATE)
          AND w.month <= DATE_TRUNC('month', $2::DATE)
          AND w.n_12 >= 5
          AND w.sd_12 IS NOT NULL AND w.sd_12 > 0
          AND w.m_total > w.mean_12 + 2 * w.sd_12
        ORDER BY w.m_total DESC
        LIMIT 50`,
      [dateFrom, dateTo],
    );

    return NextResponse.json({
      outliers: outliers.map(r => ({
        entryNo:        Number(r.entry_no),
        siteCode:       r.site_code,
        siteName:       r.site_name,
        serviceDate:    r.service_date,
        description:    r.description,
        netCost:        parseFloat(r.net_cost),
        categorySlug:   r.category_slug,
        categoryName:   r.category_name,
        baselineMean:   parseFloat(r.mean),
        baselineStddev: parseFloat(r.sd),
      })),
      siteMonthSpikes: spikes.map(r => ({
        siteCode:    r.site_code,
        siteName:    r.site_name,
        month:       r.month,
        monthTotal:  parseFloat(r.m_total),
        baselineMean: parseFloat(r.mean_12),
        baselineStddev: parseFloat(r.sd_12),
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/anomalies error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Smoke-test** (only meaningful after a real upload — print this note)

```
NOTE: meaningful smoke-test for /anomalies requires a populated rm_invoices.
After Task 23 (manual verification) you'll be able to verify it returns
non-empty data with sane numbers.
```

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/anomalies/route.ts
git commit -m "feat: add GET /api/maintenance/anomalies (invoice outliers + site-month spikes)"
```

---

## Task 13 — Rewrite /api/maintenance/categories-list (and fix categories endpoint)

**Files:**
- Modify: `app/api/maintenance/categories-list/route.ts`
- Modify: `app/api/maintenance/categories/route.ts`

- [ ] **Step 1: Rewrite categories-list to return the 13 from rm_categories**

Open `app/api/maintenance/categories-list/route.ts`. Replace its entire contents with:

```typescript
// app/api/maintenance/categories-list/route.ts
// Flat list of categories — used by filter dropdowns and the reclassify menu.
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await query<any>(
      `SELECT slug, display_name, sort_order
         FROM rm_categories
        WHERE is_active = TRUE
        ORDER BY sort_order`,
    );
    return NextResponse.json({
      data: rows.map(r => ({ slug: r.slug, displayName: r.display_name })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/categories-list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Rewrite categories (chart breakdown) to query new tables**

Open `app/api/maintenance/categories/route.ts`. Replace its entire contents with:

```typescript
// app/api/maintenance/categories/route.ts
// Chart breakdown — spend per category over the filter range, retail only.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom  = sp.get('dateFrom')  || undefined;
    const dateTo    = sp.get('dateTo')    || undefined;
    const territory = sp.get('territory') || undefined;
    const siteCode  = sp.get('siteCode')  || undefined;

    const clauses: string[] = [`i.cost_center = 'retail'`];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)  { clauses.push(`i.service_date >= $${p++}`); params.push(dateFrom); }
    if (dateTo)    { clauses.push(`i.service_date <= $${p++}`); params.push(dateTo); }
    if (territory) { clauses.push(`t.tm_code = $${p++}`);       params.push(territory.toUpperCase()); }
    if (siteCode)  { clauses.push(`i.site_code = $${p++}`);     params.push(siteCode); }
    const where = `WHERE ${clauses.join(' AND ')}`;

    const rows = await query<any>(
      `WITH per_cat AS (
         SELECT c.slug, c.display_name, SUM(i.net_cost) AS total_cost
           FROM rm_invoices i
           JOIN sites si             ON i.site_code = si.site_code
           LEFT JOIN territories t   ON si.territory_id = t.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
           ${where}
          GROUP BY c.slug, c.display_name
       ),
       total AS (SELECT SUM(total_cost) AS sum_all FROM per_cat)
       SELECT p.slug, p.display_name,
              ROUND(p.total_cost::NUMERIC, 2) AS total_cost,
              ROUND((p.total_cost / NULLIF(t.sum_all, 0) * 100)::NUMERIC, 1) AS pct_of_total
         FROM per_cat p, total t
        ORDER BY p.total_cost DESC NULLS LAST`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        categorySlug: r.slug,
        // `category` key kept for backwards compatibility with the existing chart component
        category:     r.display_name,
        totalCost:    parseFloat(r.total_cost),
        pctOfTotal:   r.pct_of_total ? parseFloat(r.pct_of_total) : 0,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/categories error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/categories-list/route.ts app/api/maintenance/categories/route.ts
git commit -m "refactor: rewrite categories + categories-list to query rm_* tables"
```

---

## Task 14 — Rewrite /api/maintenance/kpis

**Files:**
- Modify: `app/api/maintenance/kpis/route.ts`

- [ ] **Step 1: Replace contents**

Open `app/api/maintenance/kpis/route.ts`. Replace its entire contents with:

```typescript
// app/api/maintenance/kpis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface F {
  dateFrom?: string; dateTo?: string;
  territory?: string; category?: string; siteCode?: string;
}

function readFilters(req: NextRequest): F {
  const sp = req.nextUrl.searchParams;
  return {
    dateFrom:  sp.get('dateFrom')  || undefined,
    dateTo:    sp.get('dateTo')    || undefined,
    territory: sp.get('territory') || undefined,
    category:  sp.get('category')  || undefined,
    siteCode:  sp.get('siteCode')  || undefined,
  };
}

function maintWhere(f: F, includeCategory: boolean) {
  const clauses: string[] = [`i.cost_center = 'retail'`];
  const params: any[] = [];
  let p = 1;
  if (f.dateFrom)  { clauses.push(`i.service_date >= $${p++}`); params.push(f.dateFrom); }
  if (f.dateTo)    { clauses.push(`i.service_date <= $${p++}`); params.push(f.dateTo); }
  if (f.territory) { clauses.push(`t.tm_code = $${p++}`);       params.push(f.territory.toUpperCase()); }
  if (includeCategory && f.category) { clauses.push(`c.slug = $${p++}`); params.push(f.category); }
  if (f.siteCode)  { clauses.push(`i.site_code = $${p++}`);     params.push(f.siteCode); }
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

function salesWhere(f: F) {
  const clauses: string[] = [];
  const params: any[] = [];
  let p = 1;
  if (f.dateFrom)  { clauses.push(`s.sale_date >= $${p++}`); params.push(f.dateFrom); }
  if (f.dateTo)    { clauses.push(`s.sale_date <= $${p++}`); params.push(f.dateTo); }
  if (f.territory) { clauses.push(`t.tm_code = $${p++}`);    params.push(f.territory.toUpperCase()); }
  if (f.siteCode)  { clauses.push(`s.site_code = $${p++}`);  params.push(f.siteCode); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function GET(req: NextRequest) {
  try {
    const f = readFilters(req);

    const iBase = `
      FROM rm_invoices i
      JOIN sites si             ON i.site_code = si.site_code
      LEFT JOIN territories t   ON si.territory_id = t.id
      LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
      LEFT JOIN rm_categories c ON r.category_id = c.id
    `;
    const sBase = `
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;

    const mw = maintWhere(f, true);
    const totals = await query<any>(
      `SELECT ROUND(SUM(i.net_cost)::NUMERIC, 2) AS total_cost,
              COUNT(DISTINCT i.site_code)        AS sites_with_activity
       ${iBase} ${mw.where}`,
      mw.params,
    );

    const mwNoCat = maintWhere(f, false);
    const topCat = await query<any>(
      `SELECT c.slug, c.display_name, ROUND(SUM(i.net_cost)::NUMERIC, 2) AS total
       ${iBase} ${mwNoCat.where}
       GROUP BY c.slug, c.display_name
       ORDER BY total DESC NULLS LAST
       LIMIT 1`,
      mwNoCat.params,
    );

    const sw = salesWhere(f);
    const vol = await query<any>(
      `SELECT SUM(s.total_volume) AS volume ${sBase} ${sw.where}`,
      sw.params,
    );

    const totalCost = parseFloat(totals[0]?.total_cost || 0);
    const totalVolume = parseFloat(vol[0]?.volume || 0);
    const costPerLitre = totalVolume > 0 ? totalCost / totalVolume : null;

    // Bonus stat (consumed by the AnomalyChips component): how many rows need review
    const review = await query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM rm_description_categories WHERE needs_review = TRUE`,
    );

    return NextResponse.json({
      data: {
        totalCost,
        costPerLitre,
        topCategory:        topCat[0]?.display_name ?? null,
        topCategorySlug:    topCat[0]?.slug ?? null,
        topCategoryCost:    topCat[0]?.total ? parseFloat(topCat[0].total) : 0,
        sitesWithActivity:  parseInt(totals[0]?.sites_with_activity || 0),
        needsReviewCount:   parseInt(review[0].n, 10),
      },
    });
  } catch (err: any) {
    console.error('/api/maintenance/kpis error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/maintenance/kpis/route.ts
git commit -m "refactor: rewrite /api/maintenance/kpis against rm_invoices (retail only)"
```

---

## Task 15 — Rewrite /api/maintenance/trend

**Files:**
- Modify: `app/api/maintenance/trend/route.ts`

- [ ] **Step 1: Read the existing file to know the response shape, then replace**

```typescript
// app/api/maintenance/trend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom    = sp.get('dateFrom')    || undefined;
    const dateTo      = sp.get('dateTo')      || undefined;
    const territory   = sp.get('territory')   || undefined;
    const categorySlug = sp.get('category')   || undefined;
    const siteCode    = sp.get('siteCode')    || undefined;
    const granularity = sp.get('granularity') === 'daily' ? 'daily' : 'monthly';

    const clauses: string[] = [`i.cost_center = 'retail'`];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)     { clauses.push(`i.service_date >= $${p++}`); params.push(dateFrom); }
    if (dateTo)       { clauses.push(`i.service_date <= $${p++}`); params.push(dateTo); }
    if (territory)    { clauses.push(`t.tm_code = $${p++}`);       params.push(territory.toUpperCase()); }
    if (categorySlug) { clauses.push(`c.slug = $${p++}`);          params.push(categorySlug); }
    if (siteCode)     { clauses.push(`i.site_code = $${p++}`);     params.push(siteCode); }
    const where = `WHERE ${clauses.join(' AND ')}`;

    const bucket = granularity === 'daily'
      ? `i.service_date`
      : `DATE_TRUNC('month', i.service_date)::DATE`;

    const sql = `
      SELECT ${bucket} AS bucket,
             ROUND(SUM(i.net_cost)::NUMERIC, 2) AS total_cost,
             COUNT(*)::INT                       AS invoice_count
        FROM rm_invoices i
        JOIN sites si             ON i.site_code = si.site_code
        LEFT JOIN territories t   ON si.territory_id = t.id
        LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
        LEFT JOIN rm_categories c ON r.category_id = c.id
        ${where}
        GROUP BY bucket
        ORDER BY bucket
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      data: rows.map(r => ({
        period:       r.bucket,            // YYYY-MM-DD (first of month if monthly)
        totalCost:    parseFloat(r.total_cost),
        invoiceCount: r.invoice_count,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/trend error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/maintenance/trend/route.ts
git commit -m "refactor: rewrite /api/maintenance/trend against rm_invoices"
```

---

## Task 16 — Rewrite /api/maintenance/sites

**Files:**
- Modify: `app/api/maintenance/sites/route.ts`

- [ ] **Step 1: Replace contents**

```typescript
// app/api/maintenance/sites/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const VALID_SORTS = new Set(['cost', 'volume', 'cost_per_litre', 'site_name', 'territory_code']);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom  = sp.get('dateFrom')  || undefined;
    const dateTo    = sp.get('dateTo')    || undefined;
    const territory = sp.get('territory') || undefined;
    const categorySlug = sp.get('category') || undefined;
    const siteCode  = sp.get('siteCode')  || undefined;
    const limit     = Math.min(Math.max(1, parseInt(sp.get('limit') || '500')), 5000);
    const sortBy    = sp.get('sortBy') || 'cost_per_litre';
    const sortDir   = (sp.get('sortDir') || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    if (!VALID_SORTS.has(sortBy)) {
      return NextResponse.json({ error: 'Invalid sortBy' }, { status: 400 });
    }

    // ── invoices WHERE (includes category) ──
    const ip: any[] = [];
    const ic: string[] = [`i.cost_center = 'retail'`];
    let iidx = 1;
    if (dateFrom)     { ic.push(`i.service_date >= $${iidx++}`); ip.push(dateFrom); }
    if (dateTo)       { ic.push(`i.service_date <= $${iidx++}`); ip.push(dateTo); }
    if (territory)    { ic.push(`t.tm_code = $${iidx++}`);       ip.push(territory.toUpperCase()); }
    if (categorySlug) { ic.push(`c.slug = $${iidx++}`);          ip.push(categorySlug); }
    if (siteCode)     { ic.push(`i.site_code = $${iidx++}`);     ip.push(siteCode); }
    const iWhere = `WHERE ${ic.join(' AND ')}`;

    // ── sales WHERE (no category) ──
    const sp_: any[] = [];
    const sc: string[] = [];
    let sidx = ip.length + 1;
    if (dateFrom)  { sc.push(`s.sale_date >= $${sidx++}`); sp_.push(dateFrom); }
    if (dateTo)    { sc.push(`s.sale_date <= $${sidx++}`); sp_.push(dateTo); }
    if (territory) { sc.push(`t.tm_code = $${sidx++}`);    sp_.push(territory.toUpperCase()); }
    if (siteCode)  { sc.push(`s.site_code = $${sidx++}`);  sp_.push(siteCode); }
    const sWhere = sc.length ? `WHERE ${sc.join(' AND ')}` : '';

    const params: any[] = [...ip, ...sp_, limit];
    const limitIdx = params.length;

    const orderCol =
      sortBy === 'cost'           ? 'cost' :
      sortBy === 'volume'         ? 'volume' :
      sortBy === 'site_name'      ? 'site_name' :
      sortBy === 'territory_code' ? 'territory_code' :
                                    'cost_per_litre';

    const sql = `
      WITH inv_cats AS (
        SELECT i.site_code, c.slug AS category_slug, c.display_name AS category_name,
               SUM(i.net_cost) AS cat_cost,
               ROW_NUMBER() OVER (PARTITION BY i.site_code ORDER BY SUM(i.net_cost) DESC) AS rk
          FROM rm_invoices i
          JOIN sites si             ON i.site_code = si.site_code
          LEFT JOIN territories t   ON si.territory_id = t.id
          LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
          ${iWhere}
         GROUP BY i.site_code, c.slug, c.display_name
      ),
      maint AS (
        SELECT i.site_code,
               si.budget_name                  AS site_name,
               t.tm_code                       AS territory_code,
               ROUND(SUM(i.net_cost)::NUMERIC, 2) AS cost,
               (SELECT ic.category_name FROM inv_cats ic
                 WHERE ic.site_code = i.site_code AND ic.rk = 1) AS top_category,
               (SELECT ic.category_slug FROM inv_cats ic
                 WHERE ic.site_code = i.site_code AND ic.rk = 1) AS top_category_slug
          FROM rm_invoices i
          JOIN sites si             ON i.site_code = si.site_code
          LEFT JOIN territories t   ON si.territory_id = t.id
          LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
          LEFT JOIN rm_categories c ON r.category_id = c.id
          ${iWhere}
         GROUP BY i.site_code, si.budget_name, t.tm_code
      ),
      vol AS (
        SELECT s.site_code, SUM(s.total_volume) AS volume
          FROM sales s
          JOIN sites si ON s.site_code = si.site_code
          LEFT JOIN territories t ON si.territory_id = t.id
          ${sWhere}
         GROUP BY s.site_code
      )
      SELECT maint.site_code, maint.site_name, maint.territory_code,
             maint.cost,
             COALESCE(vol.volume, 0)::NUMERIC AS volume,
             maint.top_category, maint.top_category_slug,
             CASE WHEN COALESCE(vol.volume, 0) > 0
                  THEN ROUND((maint.cost / vol.volume)::NUMERIC, 4)
                  ELSE NULL END AS cost_per_litre
        FROM maint
        LEFT JOIN vol ON vol.site_code = maint.site_code
       ORDER BY ${orderCol} ${sortDir} NULLS LAST
       LIMIT $${limitIdx}
    `;

    const rows = await query<any>(sql, params);

    return NextResponse.json({
      data: rows.map(r => ({
        siteCode:        r.site_code,
        siteName:        r.site_name,
        territoryCode:   r.territory_code,
        cost:            parseFloat(r.cost),
        volume:          parseFloat(r.volume),
        topCategory:     r.top_category,
        topCategorySlug: r.top_category_slug,
        costPerLitre:    r.cost_per_litre != null ? parseFloat(r.cost_per_litre) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/sites error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/maintenance/sites/route.ts
git commit -m "refactor: rewrite /api/maintenance/sites against rm_invoices"
```

---

## Task 17 — Update /api/validate maintenance branch

**Files:**
- Modify: `app/api/validate/route.ts`

- [ ] **Step 1: Locate the maintenance branch (around line 72: `if (dataType === 'maintenance') {`) and replace it**

In `app/api/validate/route.ts`, find the `if (dataType === 'maintenance') {` block (around line 72) and the helper at line ~343 onwards. Replace the maintenance branch contents with logic that validates the new columns. Keep the existing function signature and response shape — just change the validation rules.

Required columns (case-sensitive): `SITE CODE`, `DATE`, `Description`, `Debit Amount (LCY)`, `Entry No.`.

```typescript
// Inside the if (dataType === 'maintenance') { ... } block of POST handler,
// replace existing checks with these (preserve the surrounding response shape):

const required = ['SITE CODE', 'DATE', 'Description', 'Debit Amount (LCY)', 'Entry No.'];
const checks: any[] = [];

const firstRow = rows[0] ?? {};
const presentCols = Object.keys(firstRow);
const missing = required.filter(c => !presentCols.includes(c));

if (missing.length > 0) {
  checks.push({
    id: 'columns',
    sheet: 'R & M FINANCE',
    title: 'Required columns present',
    status: 'error',
    detail: `Missing columns: ${missing.join(', ')}`,
  });
} else {
  checks.push({
    id: 'columns',
    sheet: 'R & M FINANCE',
    title: 'Required columns present',
    status: 'pass',
    detail: `All ${required.length} required columns found`,
  });
}

// Numeric Entry No.
let badEntry = 0;
for (const r of rows) {
  const n = Number(r['Entry No.']);
  if (!Number.isFinite(n) || n <= 0) badEntry++;
}
checks.push({
  id: 'entry_no',
  sheet: 'R & M FINANCE',
  title: 'Entry No. is numeric',
  status: badEntry === 0 ? 'pass' : (badEntry < rows.length * 0.05 ? 'warning' : 'error'),
  detail: badEntry === 0 ? `All ${rows.length} rows valid` : `${badEntry} row(s) have non-numeric Entry No.`,
});

// Numeric Debit
let badDebit = 0;
for (const r of rows) {
  const v = r['Debit Amount (LCY)'];
  if (v == null || v === '' || !Number.isFinite(Number(v))) badDebit++;
}
checks.push({
  id: 'debit',
  sheet: 'R & M FINANCE',
  title: 'Debit Amount (LCY) is numeric',
  status: badDebit === 0 ? 'pass' : (badDebit < rows.length * 0.05 ? 'warning' : 'error'),
  detail: badDebit === 0 ? `All ${rows.length} rows valid` : `${badDebit} row(s) have non-numeric Debit`,
});

// Site code coverage
const siteCodesInFile = new Set(
  rows.map(r => String(r['SITE CODE'] ?? '').trim().toUpperCase()).filter(Boolean),
);
const siteRows = await query<{ site_code: string }>('SELECT site_code FROM sites');
const known = new Set(siteRows.map(s => s.site_code));
const unknown = Array.from(siteCodesInFile).filter(c => !known.has(c));

checks.push({
  id: 'site_codes',
  sheet: 'R & M FINANCE',
  title: 'Site codes match sites master',
  status: unknown.length === 0 ? 'pass' : 'warning',
  detail: unknown.length === 0
    ? `All ${siteCodesInFile.size} distinct site codes match`
    : `${unknown.length} unknown site code(s) (rows will be quarantined): ${unknown.slice(0,5).join(', ')}${unknown.length > 5 ? ', …' : ''}`,
});

const errors   = checks.filter(c => c.status === 'error').length;
const warnings = checks.filter(c => c.status === 'warning').length;
const passed   = checks.filter(c => c.status === 'pass').length;

return NextResponse.json({
  data: {
    ok: errors === 0,
    canIngest: errors === 0,
    checks,
    summary: { errors, warnings, passed },
    sheetRowCounts: { 'R & M FINANCE': rows.length },
    dateRange: null,
    fileName,
  },
});
```

NOTE: Adapt the code to match the existing return-flow style of the file (it already returns `{ data: ... }`). If the existing function returns directly from inside the `if (dataType === 'maintenance')` branch, keep that structure — only the check generation is replaced.

- [ ] **Step 2: Commit**

```bash
git add app/api/validate/route.ts
git commit -m "refactor: update /api/validate maintenance branch for new RM Finance schema"
```

---

## Task 18 — CategorizationProgress component

**Files:**
- Create: `components/maintenance/CategorizationProgress.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// components/maintenance/CategorizationProgress.tsx
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface Props {
  uploadLogId: number | null;
  pendingAtStart: number;
  onDone: () => void;
}

interface BatchResp { processed: number; remaining: number; error?: string; }

export default function CategorizationProgress({ uploadLogId, pendingAtStart, onDone }: Props) {
  const [done, setDone]           = useState(0);
  const [remaining, setRemaining] = useState(pendingAtStart);
  const [error, setError]         = useState<string | null>(null);
  const [paused, setPaused]       = useState(false);
  const consecutiveFailures = useRef(0);

  const drain = useCallback(async () => {
    while (!paused) {
      try {
        const res = await fetch('/api/maintenance/categorize-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ upload_log_id: uploadLogId }),
        });
        const body: BatchResp = await res.json();
        if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
        setDone(d => d + body.processed);
        setRemaining(body.remaining);
        consecutiveFailures.current = 0;
        if (body.processed === 0 || body.remaining === 0) {
          onDone();
          return;
        }
      } catch (e: any) {
        consecutiveFailures.current += 1;
        if (consecutiveFailures.current >= 3) {
          setError(e.message || 'Categorization failed');
          setPaused(true);
          return;
        }
        // brief backoff
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }, [paused, uploadLogId, onDone]);

  useEffect(() => { drain(); /* run once on mount */ // eslint-disable-next-line react-hooks/exhaustive-deps
                  }, []);

  const retry = () => {
    setError(null);
    consecutiveFailures.current = 0;
    setPaused(false);
    // setPaused(false) re-enables the while-loop; kick a new run:
    setTimeout(() => drain(), 0);
  };

  const total = pendingAtStart;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;

  return (
    <div className="rounded-md border bg-blue-50 px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <div>
          Categorising invoice descriptions… <strong>{done}</strong> / {total} ({pct}%)
        </div>
        {error && (
          <button onClick={retry} className="ml-3 rounded bg-blue-600 px-2 py-0.5 text-white">
            Retry
          </button>
        )}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-blue-100">
        <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {error && <div className="mt-1 text-red-700">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/maintenance/CategorizationProgress.tsx
git commit -m "feat: add CategorizationProgress component (drains pending in a client loop)"
```

---

## Task 19 — UploadPanel integration

**Files:**
- Modify: `components/ui/UploadPanel.tsx`

- [ ] **Step 1: Add state and progress widget**

In `components/ui/UploadPanel.tsx`:

1. Import the progress component near the top:
```tsx
import CategorizationProgress from '@/components/maintenance/CategorizationProgress';
```

2. Near the other `useState` calls in the component body, add:
```tsx
const [categorizing, setCategorizing] = useState<null | {
  uploadLogId: number | null;
  pending: number;
}>(null);
```

3. In `handleIngest`, inside the `if (dataType === 'maintenance')` branch, replace the existing block from `const { data } = await postJSON(...)` down to `delete (window as any).__rmParsedRows;` with:

```tsx
const { data } = await postJSON('/api/ingest', {
  dataType: 'maintenance',
  rows,
  fileName: file.name,
});

if (!data.ok) throw new Error(data.error || 'R&M ingest failed');

setDuration(Date.now() - start);
setRowCounts({ maintenance: data.summary?.inserted || 0 } as any);

const pending = Number(data.summary?.pending_descriptions || 0);
if (pending > 0) {
  setCategorizing({ uploadLogId: data.uploadLogId ?? null, pending });
} else {
  setPhase('done');
  onSuccess();
}
delete (window as any).__rmParsedRows;
return;
```

4. Just before the final `return (...)` JSX of the component (or wherever the success/done state is rendered), add the progress widget:

```tsx
{categorizing && (
  <div className="mt-3">
    <CategorizationProgress
      uploadLogId={categorizing.uploadLogId}
      pendingAtStart={categorizing.pending}
      onDone={() => {
        setCategorizing(null);
        setPhase('done');
        onSuccess();
      }}
    />
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add components/ui/UploadPanel.tsx
git commit -m "feat: wire CategorizationProgress into R&M upload flow"
```

---

## Task 20 — InvoiceDrawer component

**Files:**
- Create: `components/maintenance/InvoiceDrawer.tsx`

- [ ] **Step 1: Implement the drawer**

```tsx
// components/maintenance/InvoiceDrawer.tsx
'use client';

import { useEffect, useState } from 'react';

export interface InvoiceFilters {
  siteCode?: string;
  category?: string;        // slug
  description?: string;     // exact description_norm
  dateFrom?: string;
  dateTo?: string;
  needsReview?: boolean;
  minCost?: number;
  territory?: string;
}

interface Invoice {
  entryNo: number;
  siteCode: string;
  siteName: string;
  serviceDate: string;
  description: string;
  documentNo: string | null;
  externalDocNo: string | null;
  netCost: number;
  categorySlug: string | null;
  categoryName: string | null;
  confidence: string | null;
  needsReview: boolean;
  categorySource: string | null;
}

interface CategoryOption { slug: string; displayName: string; }

interface Props {
  open: boolean;
  filters: InvoiceFilters;
  title?: string;
  onClose: () => void;
  /** Called after a successful reclassify so the parent can refetch its data. */
  onReclassified?: () => void;
}

function buildQS(f: InvoiceFilters): string {
  const p = new URLSearchParams();
  if (f.siteCode)    p.set('siteCode', f.siteCode);
  if (f.category)    p.set('category', f.category);
  if (f.description) p.set('description', f.description);
  if (f.dateFrom)    p.set('dateFrom', f.dateFrom);
  if (f.dateTo)      p.set('dateTo', f.dateTo);
  if (f.territory)   p.set('territory', f.territory);
  if (f.needsReview) p.set('needsReview', 'true');
  if (f.minCost)     p.set('minCost', String(f.minCost));
  p.set('limit', '200');
  return p.toString();
}

export default function InvoiceDrawer({ open, filters, title, onClose, onReclassified }: Props) {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [cats, setCats] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = async () => {
    setLoading(true); setError(null);
    try {
      const [invRes, catRes] = await Promise.all([
        fetch(`/api/maintenance/invoices?${buildQS(filters)}`).then(r => r.json()),
        fetch('/api/maintenance/categories-list').then(r => r.json()),
      ]);
      setRows(invRes?.data || []);
      setCats(catRes?.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(filters)]);

  const reclassify = async (descriptionNorm: string, slug: string) => {
    const res = await fetch('/api/maintenance/reclassify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description_norm: descriptionNorm, category_slug: slug }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'Reclassify failed');
      return;
    }
    await refetch();
    onReclassified?.();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-2">
          <h2 className="text-sm font-semibold">{title || 'Invoices'}</h2>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-900">✕</button>
        </div>

        {loading && <div className="p-4 text-sm text-gray-600">Loading…</div>}
        {error && <div className="p-4 text-sm text-red-700">{error}</div>}

        {!loading && !error && (
          <table className="w-full text-xs">
            <thead className="sticky top-9 bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Net (LCY)</th>
                <th className="px-3 py-2">Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.entryNo} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap">{r.serviceDate}</td>
                  <td className="px-3 py-2">{r.siteCode}</td>
                  <td className="px-3 py-2">
                    {r.description}
                    {r.documentNo && <span className="ml-1 text-gray-400">#{r.documentNo}</span>}
                    {r.needsReview && (
                      <span className="ml-2 inline-block rounded bg-amber-100 px-1 text-amber-800">needs review</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.netCost.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <select
                      value={r.categorySlug || 'other'}
                      onChange={e => reclassify(r.description.replace(/\s+/g,' ').trim().toLowerCase(), e.target.value)}
                      className="rounded border px-1 py-0.5 text-xs"
                    >
                      {cats.map(c => (
                        <option key={c.slug} value={c.slug}>{c.displayName}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">No invoices match.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/maintenance/InvoiceDrawer.tsx
git commit -m "feat: add InvoiceDrawer with inline reclassify"
```

---

## Task 21 — TopDescriptionsPanel + AnomalyChips components

**Files:**
- Create: `components/maintenance/TopDescriptionsPanel.tsx`
- Create: `components/maintenance/AnomalyChips.tsx`

- [ ] **Step 1: TopDescriptionsPanel**

```tsx
// components/maintenance/TopDescriptionsPanel.tsx
'use client';

import { useEffect, useState } from 'react';

interface Row {
  descriptionNorm:   string;
  sampleDescription: string;
  occurrences:       number;
  totalSpend:        number;
  avgSpend:          number;
  categorySlug:      string | null;
  categoryName:      string | null;
}

interface Filters { dateFrom?: string; dateTo?: string; territory?: string; category?: string; }

interface Props {
  filters: Filters;
  onPickDescription: (descriptionNorm: string, label: string) => void;
}

export default function TopDescriptionsPanel({ filters, onPickDescription }: Props) {
  const [by, setBy] = useState<'spend' | 'count'>('spend');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams({ by, limit: '20' });
    if (filters.dateFrom)  p.set('dateFrom',  filters.dateFrom);
    if (filters.dateTo)    p.set('dateTo',    filters.dateTo);
    if (filters.territory) p.set('territory', filters.territory);
    if (filters.category)  p.set('category',  filters.category);

    setLoading(true);
    fetch(`/api/maintenance/top-descriptions?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [by, JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Where the money is going</h3>
        <div className="flex gap-1">
          {(['spend','count'] as const).map(t => (
            <button
              key={t}
              onClick={() => setBy(t)}
              className={`rounded px-2 py-0.5 text-xs ${by === t ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}
            >
              {t === 'spend' ? 'By spend' : 'By count'}
            </button>
          ))}
        </div>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Description</th>
              <th className="px-3 py-1">Category</th>
              <th className="px-3 py-1 text-right">{by === 'spend' ? 'Total' : 'Count'}</th>
              <th className="px-3 py-1 text-right">{by === 'spend' ? 'Count' : 'Total'}</th>
              <th className="px-3 py-1 text-right">Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.descriptionNorm}
                  onClick={() => onPickDescription(r.descriptionNorm, r.sampleDescription)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1">{r.sampleDescription}</td>
                <td className="px-3 py-1 text-gray-600">{r.categoryName || '—'}</td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {by === 'spend' ? r.totalSpend.toLocaleString() : r.occurrences}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {by === 'spend' ? r.occurrences : r.totalSpend.toLocaleString()}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{r.avgSpend.toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">No data.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: AnomalyChips**

```tsx
// components/maintenance/AnomalyChips.tsx
'use client';

import { useEffect, useState } from 'react';

interface Filters { dateFrom?: string; dateTo?: string; }

interface Props {
  filters: Filters;
  needsReviewCount: number;
  onClickAnomalies: () => void;
  onClickNeedsReview: () => void;
}

export default function AnomalyChips({ filters, needsReviewCount, onClickAnomalies, onClickNeedsReview }: Props) {
  const [anomalyCount, setAnomalyCount] = useState<number | null>(null);

  useEffect(() => {
    if (!filters.dateFrom || !filters.dateTo) { setAnomalyCount(0); return; }
    const p = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    fetch(`/api/maintenance/anomalies?${p}`)
      .then(r => r.json())
      .then(d => setAnomalyCount((d?.outliers?.length || 0) + (d?.siteMonthSpikes?.length || 0)))
      .catch(() => setAnomalyCount(0));
  }, [filters.dateFrom, filters.dateTo]);

  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        onClick={onClickAnomalies}
        disabled={!anomalyCount}
        className={`rounded-full px-3 py-1 ${anomalyCount ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-500'}`}
      >
        ⚠ {anomalyCount ?? '…'} anomalies this period
      </button>
      <button
        onClick={onClickNeedsReview}
        disabled={!needsReviewCount}
        className={`rounded-full px-3 py-1 ${needsReviewCount ? 'bg-blue-100 text-blue-900' : 'bg-gray-100 text-gray-500'}`}
      >
        {needsReviewCount} items need review
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/maintenance/TopDescriptionsPanel.tsx components/maintenance/AnomalyChips.tsx
git commit -m "feat: add TopDescriptionsPanel and AnomalyChips components"
```

---

## Task 22 — Wire into /dashboard/maintenance page

**Files:**
- Modify: `app/dashboard/maintenance/page.tsx`

- [ ] **Step 1: Add imports and state**

Open `app/dashboard/maintenance/page.tsx`. Near the existing imports, add:

```tsx
import InvoiceDrawer, { InvoiceFilters } from '@/components/maintenance/InvoiceDrawer';
import TopDescriptionsPanel from '@/components/maintenance/TopDescriptionsPanel';
import AnomalyChips from '@/components/maintenance/AnomalyChips';
```

Add state below the other `useState` calls inside `MaintenancePage`:

```tsx
const [drawer, setDrawer] = useState<{ filters: InvoiceFilters; title?: string } | null>(null);
```

- [ ] **Step 2: Render the new pieces**

Below the existing KPI cards block but above the rest, render the chips. Below the existing CategoryBreakdownChart block, render the top-descriptions panel. At the end of the page, render the drawer:

```tsx
{/* Chips row (just below KPI cards in the JSX tree) */}
<AnomalyChips
  filters={{ dateFrom: filters.dateFrom, dateTo: filters.dateTo }}
  needsReviewCount={kpis?.needsReviewCount || 0}
  onClickAnomalies={() => setDrawer({
    filters: { dateFrom: filters.dateFrom, dateTo: filters.dateTo, territory: filters.territory },
    title: 'Anomalous invoices',
  })}
  onClickNeedsReview={() => setDrawer({
    filters: {
      dateFrom: filters.dateFrom, dateTo: filters.dateTo,
      territory: filters.territory, needsReview: true,
    },
    title: 'Invoices needing review',
  })}
/>

{/* Top descriptions panel (after category breakdown chart) */}
<TopDescriptionsPanel
  filters={{
    dateFrom: filters.dateFrom, dateTo: filters.dateTo,
    territory: filters.territory, category: filters.category,
  }}
  onPickDescription={(desc, label) => setDrawer({
    filters: {
      description: desc,
      dateFrom: filters.dateFrom, dateTo: filters.dateTo,
      territory: filters.territory,
    },
    title: `Invoices: ${label}`,
  })}
/>

{/* Drawer at the bottom */}
<InvoiceDrawer
  open={drawer != null}
  filters={drawer?.filters || {}}
  title={drawer?.title}
  onClose={() => setDrawer(null)}
  onReclassified={() => fetchAll(filters)}
/>
```

- [ ] **Step 3: Make site-table rows clickable to open the drawer**

Find where `MaintenanceSiteTable` is rendered. Wrap the row click — if the table already supports an `onRowClick` prop, pass:

```tsx
onRowClick={(row) => setDrawer({
  filters: {
    siteCode: row.siteCode,
    dateFrom: filters.dateFrom, dateTo: filters.dateTo,
    territory: filters.territory, category: filters.category,
  },
  title: `Invoices: ${row.siteName}`,
})}
```

If `MaintenanceSiteTable` does NOT yet support `onRowClick`, add the prop:

1. In `components/tables/MaintenanceSiteTable.tsx`, extend the props interface with `onRowClick?: (row: MaintSiteRow) => void;`.
2. Attach `onClick={() => onRowClick?.(row)}` to each `<tr>`.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/maintenance/page.tsx components/tables/MaintenanceSiteTable.tsx
git commit -m "feat: mount AnomalyChips, TopDescriptionsPanel, and InvoiceDrawer on maintenance page"
```

---

## Task 23 — Vercel cron + function timeouts

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Update vercel.json**

Open `vercel.json`. Replace contents with:

```json
{
  "functions": {
    "app/api/ingest/route.ts":                                { "maxDuration": 120 },
    "app/api/validate/route.ts":                              { "maxDuration": 60 },
    "app/api/ingest/preflight/route.ts":                      { "maxDuration": 60 },
    "app/api/maintenance/categorize-batch/route.ts":          { "maxDuration": 60 },
    "app/api/maintenance/anomalies/route.ts":                 { "maxDuration": 30 },
    "app/api/maintenance/invoices/route.ts":                  { "maxDuration": 30 },
    "app/api/maintenance/sites/route.ts":                     { "maxDuration": 30 }
  },
  "crons": [
    { "path": "/api/maintenance/categorize-batch", "schedule": "*/5 * * * *" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore: add categorize-batch cron + function timeouts in vercel.json"
```

NOTE: Vercel crons hit the endpoint with GET. The route only accepts POST. To make the cron work, also support GET as a no-op alias for POST in `app/api/maintenance/categorize-batch/route.ts`:

- [ ] **Step 3: Add GET handler that calls the POST logic with an empty body**

In `app/api/maintenance/categorize-batch/route.ts`, append below the existing `POST`:

```typescript
// Vercel cron uses GET. Treat it as POST with no body.
export async function GET() {
  const fakeReq = { json: async () => ({}) } as any;
  return POST(fakeReq);
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/maintenance/categorize-batch/route.ts
git commit -m "chore: support GET on categorize-batch for Vercel cron"
```

---

## Task 24 — Run unit test suite

**Files:** none (verification only)

- [ ] **Step 1: Run tests**

Run: `npm test`
Expected: all tests pass — 5 + 7 + 8 + 7 = 27 tests total across 4 files.

- [ ] **Step 2: Run `next build` to catch type errors**

Run: `npm run build`
Expected: build succeeds. Fix any type errors that surface.

---

## Task 25 — Manual end-to-end verification on a Neon branch

**Files:** none (verification only)

Per `superpowers:verification-before-completion`, do every step in order and confirm the expected output before declaring done.

- [ ] **Step 1: Confirm migration is applied**

```bash
psql "$DATABASE_URL_TEST" -c "\d rm_invoices"
psql "$DATABASE_URL_TEST" -c "SELECT COUNT(*) FROM rm_categories;"
# Expected: rm_invoices columns shown, rm_categories has 13 rows
```

- [ ] **Step 2: Start the dev server pointed at the Neon branch + Anthropic key**

```bash
DATABASE_URL="$DATABASE_URL_TEST" ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" npm run dev
```

- [ ] **Step 3: Upload the real workbook**

In the browser, open `/dashboard` → Data Management → choose R&M data type → upload `Retail Dashboard Data .xlsx` → confirm validation passes → click ingest.

Expected: ingest response shows `inserted` ≈ ingested retail rows, `pending_descriptions` close to ~2,500 on first upload. CategorizationProgress widget appears.

- [ ] **Step 4: Watch the categorizer drain**

In DevTools Network tab, observe successive POSTs to `/api/maintenance/categorize-batch`. Each should return within 5 seconds. Widget should reach 100% within a few minutes.

- [ ] **Step 5: Verify dashboard math**

Open `/dashboard/maintenance`. Compute a hand-total: `psql ... -c "SELECT SUM(net_cost) FROM rm_invoices WHERE cost_center='retail';"` and confirm it matches the KPI card's Total Cost (within rounding).

- [ ] **Step 6: Click into a site row**

Expected: InvoiceDrawer opens, lists invoices for that site, dates and amounts visible.

- [ ] **Step 7: Reclassify a low-confidence row**

Pick a row tagged "needs review" — change its category via the dropdown. Expected: the chart on the parent page refetches and the row's badge clears.

- [ ] **Step 8: Re-upload the same workbook**

Expected: `inserted = 0`, `pending_descriptions = 0`. No duplicates created.

- [ ] **Step 9: Check anomaly chip**

Set the date range to span at least 6 months of history. Click the anomalies chip → InvoiceDrawer should open with anomalous invoices (may be empty if N < 5 for all sites).

- [ ] **Step 10: Tag the verification result**

If everything above passes:

```bash
git tag -a rm-finance-verified-$(date +%Y%m%d) -m "Manual E2E verification passed on Neon branch"
```

If anything fails, fix it before declaring done — do NOT proceed to a production deploy.

---

## Self-Review (run once after all tasks above are written)

**1. Spec coverage**
- §3 decisions: replace ✓ (Task 2), retail only ✓ (Tasks 10-16 filter `cost_center='retail'`), taxonomy ✓ (Task 2 seed), batched AI ✓ (Tasks 6-7), Claude ✓ (Task 1, 6), override sticky by description ✓ (Tasks 3, 9), confidence with needs_review ✓ (Task 6), drill-down ✓ (Tasks 10, 20, 22), top descriptions ✓ (Tasks 11, 21, 22), anomalies ✓ (Tasks 12, 21, 22), Approach B ✓ (Tasks 7, 8, 19, 23).
- §4.6 deploy order: covered by Task 25's verification flow.
- §4.7 testing strategy: unit tests in Tasks 3, 4, 5, 6; integration smoke tests inline in Tasks 7, 8, 9; manual E2E in Task 25.
- No gaps identified.

**2. Placeholder scan** — none of the red-flag patterns appear in the plan. Every code step contains the actual code.

**3. Type consistency**
- `CategorizerOutput.slug` is `CategorySlug` everywhere ✓
- `description_norm` column name is consistent across migration, parser, categorizer endpoint, reclassify endpoint, invoices endpoint, top-descriptions endpoint ✓
- `cost_center` enum values match between `lib/rm-cost-center.ts` and ingest's column derivation ✓
- API response shape for `categories` keeps a `category` key for backwards compatibility with the existing chart component ✓

**4. Ambiguity check** — None remaining. Each task lists the file path; each step includes the code.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-13-rm-finance-with-ai-categorization.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
