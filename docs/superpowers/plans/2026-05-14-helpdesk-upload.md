# R&M Helpdesk Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the Freshdesk-style R&M Helpdesk sheet alongside R&M Finance invoices, share categorization via the existing `rm_description_categories` cache, and build a dedicated `/dashboard/helpdesk` page with KPIs, site ranking, recurring problems, contractor view, volume trend, and open-ticket aging.

**Architecture:** New table `rm_helpdesk_tickets` with a GENERATED `description_norm` column that joins to the shared categorization cache. Mirrors the R&M Finance ingest flow (chunked uploads, ON CONFLICT UPDATE on mutable fields, post-ingest rule application). Dashboard reuses the recharts/Tailwind patterns from the Maintenance page. The `TicketDrawer` component parallels `InvoiceDrawer`, sharing the same `/api/maintenance/reclassify` endpoint so reclassifications propagate across both data sources.

**Tech Stack:** TypeScript, Next.js 14 App Router, Postgres (via `lib/db.ts`), SheetJS, Recharts, Tailwind, `node:test`.

**Spec reference:** `docs/superpowers/specs/2026-05-14-helpdesk-upload-design.md`

---

## File Map

**Create:**
- `sql/migrations/rm_helpdesk_tickets.sql` — new table + indexes
- `lib/helpdesk-parse.ts` — `parseHelpdeskRow`, `parseHelpdeskRows`, `parseHelpdeskDate`, `parseResolutionMinutes`
- `lib/helpdesk-parse.test.ts` — parser unit tests
- `app/api/helpdesk/kpis/route.ts` — KPI cards endpoint
- `app/api/helpdesk/trend/route.ts` — monthly volume trend
- `app/api/helpdesk/recurring/route.ts` — top recurring problems
- `app/api/helpdesk/sites/route.ts` — tickets per site
- `app/api/helpdesk/contractors/route.ts` — service provider performance
- `app/api/helpdesk/open/route.ts` — open tickets by aging
- `app/api/helpdesk/tickets/route.ts` — paginated drill-down
- `app/dashboard/helpdesk/page.tsx` — the dashboard page
- `components/helpdesk/HelpdeskKPICards.tsx`
- `components/helpdesk/TopRecurringPanel.tsx`
- `components/helpdesk/SitesPanel.tsx`
- `components/helpdesk/ContractorsPanel.tsx`
- `components/helpdesk/OpenTicketsPanel.tsx`
- `components/helpdesk/TicketDrawer.tsx`

**Modify:**
- `app/api/ingest/route.ts` — add `ingestHelpdesk(body)` branch
- `app/api/validate/route.ts` — add `validateHelpdesk(req)` branch
- `components/ui/UploadPanel.tsx` — extend `dataType` to include `'helpdesk'`
- `app/dashboard/page.tsx` — add `Helpdesk` tab link
- `app/dashboard/maintenance/page.tsx` — add `Helpdesk` tab link
- `app/dashboard/maintenance/rules/page.tsx` — add `Helpdesk` tab link

---

## Task 1: Database migration

**Files:**
- Create: `sql/migrations/rm_helpdesk_tickets.sql`

- [ ] **Step 1: Write the migration**

Create `sql/migrations/rm_helpdesk_tickets.sql` with:

```sql
-- ============================================================
-- R&M Helpdesk tickets — Freshdesk export.
-- description_norm is the SAME normalisation used by rm_invoices,
-- so tickets and invoices SHARE the rm_description_categories cache.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS rm_helpdesk_tickets (
  id                  BIGSERIAL PRIMARY KEY,
  ticket_id           BIGINT UNIQUE NOT NULL,
  site_code           VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  subject             TEXT NOT NULL,
  description_norm    TEXT GENERATED ALWAYS AS
                      (lower(trim(regexp_replace(subject, '\s+', ' ', 'g')))) STORED,
  status              VARCHAR(20) NOT NULL,
  priority            VARCHAR(20),
  source              VARCHAR(20),
  ticket_group        VARCHAR(40),
  agent               VARCHAR(80),
  equipment           VARCHAR(40),
  service_provider    VARCHAR(80),
  created_time        TIMESTAMPTZ NOT NULL,
  due_time            TIMESTAMPTZ,
  resolved_time       TIMESTAMPTZ,
  closed_time         TIMESTAMPTZ,
  resolution_minutes  INTEGER,
  resolution_status   VARCHAR(20),
  upload_log_id       BIGINT REFERENCES upload_log(id) ON DELETE SET NULL,
  source_file         VARCHAR(255),
  ingested_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_helpdesk_site_created ON rm_helpdesk_tickets(site_code, created_time);
CREATE INDEX IF NOT EXISTS idx_helpdesk_status      ON rm_helpdesk_tickets(status);
CREATE INDEX IF NOT EXISTS idx_helpdesk_desc_norm   ON rm_helpdesk_tickets(description_norm);
CREATE INDEX IF NOT EXISTS idx_helpdesk_priority    ON rm_helpdesk_tickets(priority);

COMMIT;
```

- [ ] **Step 2: Apply against Neon**

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/rm_helpdesk_tickets.sql
```

Expected: `BEGIN ... CREATE TABLE ... CREATE INDEX ... CREATE INDEX ... CREATE INDEX ... CREATE INDEX ... COMMIT`.

- [ ] **Step 3: Verify**

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -c "\d rm_helpdesk_tickets"
```

Expected: table description showing all 20 columns including `description_norm` as a generated column.

- [ ] **Step 4: Commit**

```bash
git add sql/migrations/rm_helpdesk_tickets.sql
git commit -m "feat: add rm_helpdesk_tickets schema with shared description_norm"
```

---

## Task 2: Parser with TDD tests

**Files:**
- Create: `lib/helpdesk-parse.ts`
- Create: `lib/helpdesk-parse.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/helpdesk-parse.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHelpdeskRow,
  parseHelpdeskDate,
  parseResolutionMinutes,
} from './helpdesk-parse';

const baseRow = {
  'SITE CODE':                    'RUW-063',
  'Ticket ID':                    '12288',
  'Subject':                      'forecourt canopy lights need attention',
  'Status':                       'Closed',
  'Priority':                     'Urgent',
  'Source':                       'Portal',
  'Group':                        'Reactive Maintenance',
  'Agent':                        'Allen Karumbidza',
  'Equipment ':                   'Canopy',
  'Service provider':             'ACME Engineering',
  'Created time':                 '11/13/25 10:09',
  'Due by Time':                  '11/16/25 10:09',
  'Resolved time':                '2/9/26 13:41',
  'Closed time':                  '2/9/26 13:41',
  'Resolution time (in hrs)':     '534:31:57',
  'Resolution status':            'SLA Violated',
};

test('parseHelpdeskDate: parses M/D/YY H:MM format', () => {
  assert.equal(parseHelpdeskDate('11/13/25 10:09'), '2025-11-13T10:09:00.000Z');
});

test('parseHelpdeskDate: parses M/D/YY H:MM:SS format', () => {
  assert.equal(parseHelpdeskDate('2/9/26 13:41:30'), '2026-02-09T13:41:30.000Z');
});

test('parseHelpdeskDate: parses 4-digit year', () => {
  assert.equal(parseHelpdeskDate('1/15/2027 09:00'), '2027-01-15T09:00:00.000Z');
});

test('parseHelpdeskDate: returns null for null/empty/garbage', () => {
  assert.equal(parseHelpdeskDate(null), null);
  assert.equal(parseHelpdeskDate(''), null);
  assert.equal(parseHelpdeskDate('not a date'), null);
});

test('parseHelpdeskDate: accepts native Date object', () => {
  const d = new Date('2026-05-14T12:00:00Z');
  assert.equal(parseHelpdeskDate(d), '2026-05-14T12:00:00.000Z');
});

test('parseResolutionMinutes: parses H:MM:SS with large hours', () => {
  // 534h 31m 57s ≈ 32072 minutes (57s rounds to 1m)
  assert.equal(parseResolutionMinutes('534:31:57'), 32072);
});

test('parseResolutionMinutes: small values round correctly', () => {
  assert.equal(parseResolutionMinutes('0:28:25'), 28);   // ~28 min
  assert.equal(parseResolutionMinutes('1:00:00'), 60);
});

test('parseResolutionMinutes: returns null on bad input', () => {
  assert.equal(parseResolutionMinutes(null), null);
  assert.equal(parseResolutionMinutes(''), null);
  assert.equal(parseResolutionMinutes('not time'), null);
});

test('parseHelpdeskRow: happy path', () => {
  const out = parseHelpdeskRow(baseRow);
  assert.ok(out.ok);
  assert.equal(out.row!.ticket_id, 12288);
  assert.equal(out.row!.site_code, 'RUW-063');
  assert.equal(out.row!.subject, 'forecourt canopy lights need attention');
  assert.equal(out.row!.status, 'Closed');
  assert.equal(out.row!.priority, 'Urgent');
  assert.equal(out.row!.equipment, 'Canopy');
  assert.equal(out.row!.service_provider, 'ACME Engineering');
  assert.equal(out.row!.created_time, '2025-11-13T10:09:00.000Z');
  assert.equal(out.row!.resolution_minutes, 32072);
  assert.equal(out.row!.resolution_status, 'SLA Violated');
});

test('parseHelpdeskRow: uppercases site_code', () => {
  const out = parseHelpdeskRow({ ...baseRow, 'SITE CODE': 'ruw-063' });
  assert.equal(out.row!.site_code, 'RUW-063');
});

test('parseHelpdeskRow: skips when Ticket ID missing or non-numeric', () => {
  assert.equal(parseHelpdeskRow({ ...baseRow, 'Ticket ID': null }).reason, 'missing_ticket_id');
  assert.equal(parseHelpdeskRow({ ...baseRow, 'Ticket ID': 'abc' }).reason, 'missing_ticket_id');
});

test('parseHelpdeskRow: skips when SITE CODE missing', () => {
  assert.equal(parseHelpdeskRow({ ...baseRow, 'SITE CODE': null }).reason, 'missing_site_code');
});

test('parseHelpdeskRow: skips when Subject empty', () => {
  assert.equal(parseHelpdeskRow({ ...baseRow, 'Subject': '   ' }).reason, 'missing_subject');
});

test('parseHelpdeskRow: skips when Created time is unparseable', () => {
  assert.equal(parseHelpdeskRow({ ...baseRow, 'Created time': 'banana' }).reason, 'bad_created_time');
});

test('parseHelpdeskRow: nullable fields tolerated as null', () => {
  const out = parseHelpdeskRow({
    ...baseRow,
    'Service provider':         null,
    'Resolved time':            null,
    'Closed time':              null,
    'Resolution time (in hrs)': null,
    'Resolution status':        null,
  });
  assert.ok(out.ok);
  assert.equal(out.row!.service_provider, null);
  assert.equal(out.row!.resolved_time, null);
  assert.equal(out.row!.closed_time, null);
  assert.equal(out.row!.resolution_minutes, null);
  assert.equal(out.row!.resolution_status, null);
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test
```

Expected: failures referencing `Cannot find module './helpdesk-parse'`.

- [ ] **Step 3: Implement the parser**

Create `lib/helpdesk-parse.ts`:

```typescript
// lib/helpdesk-parse.ts
// Pure parsers for R&M Helpdesk rows (Freshdesk export).
// Handles M/D/YY date format and H:MM:SS resolution time format with
// arbitrarily large hour values (e.g. 534:31:57 for ~22 days).

import { safeStr, siteCode } from './xlsx-parse';

export interface HelpdeskTicket {
  ticket_id:          number;
  site_code:          string;
  subject:            string;
  status:             string;
  priority:           string | null;
  source:             string | null;
  ticket_group:       string | null;
  agent:              string | null;
  equipment:          string | null;
  service_provider:   string | null;
  created_time:       string;        // ISO
  due_time:           string | null;
  resolved_time:      string | null;
  closed_time:        string | null;
  resolution_minutes: number | null;
  resolution_status:  string | null;
}

export type ParseReason =
  | 'missing_ticket_id'
  | 'missing_site_code'
  | 'missing_subject'
  | 'bad_created_time';

export interface ParseResult {
  ok:      boolean;
  row?:    HelpdeskTicket;
  reason?: ParseReason;
  raw?:    { ticketId: string | null; siteCode: string | null };
}

export function parseHelpdeskDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, mo, d, y, h, min, sec] = m;
  const yyyy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  const date = new Date(Date.UTC(
    yyyy,
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    parseInt(h, 10),
    parseInt(min, 10),
    sec ? parseInt(sec, 10) : 0,
  ));
  return isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseResolutionMinutes(v: unknown): number | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const [, h, min, sec] = m;
  return parseInt(h, 10) * 60 + parseInt(min, 10) + Math.round(parseInt(sec, 10) / 60);
}

export function parseHelpdeskRow(raw: Record<string, unknown>): ParseResult {
  const ticketIdRaw = String(raw['Ticket ID'] ?? '').trim();
  const ticketId = Number(ticketIdRaw);
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return { ok: false, reason: 'missing_ticket_id', raw: { ticketId: ticketIdRaw || null, siteCode: null } };
  }

  const sc = siteCode(raw['SITE CODE']);
  if (!sc) return { ok: false, reason: 'missing_site_code', raw: { ticketId: ticketIdRaw, siteCode: null } };

  const subject = safeStr(raw['Subject']);
  if (!subject) return { ok: false, reason: 'missing_subject', raw: { ticketId: ticketIdRaw, siteCode: sc } };

  const created = parseHelpdeskDate(raw['Created time']);
  if (!created) return { ok: false, reason: 'bad_created_time', raw: { ticketId: ticketIdRaw, siteCode: sc } };

  return {
    ok: true,
    row: {
      ticket_id:          ticketId,
      site_code:          sc,
      subject,
      status:             safeStr(raw['Status']) ?? 'Open',
      priority:           safeStr(raw['Priority']),
      source:             safeStr(raw['Source']),
      ticket_group:       safeStr(raw['Group']),
      agent:              safeStr(raw['Agent']),
      // Note trailing space in column name — present in the Freshdesk export.
      equipment:          safeStr(raw['Equipment ']) ?? safeStr(raw['Equipment']),
      service_provider:   safeStr(raw['Service provider']),
      created_time:       created,
      due_time:           parseHelpdeskDate(raw['Due by Time']),
      resolved_time:      parseHelpdeskDate(raw['Resolved time']),
      closed_time:        parseHelpdeskDate(raw['Closed time']),
      resolution_minutes: parseResolutionMinutes(raw['Resolution time (in hrs)']),
      resolution_status:  safeStr(raw['Resolution status']),
    },
  };
}

export function parseHelpdeskRows(rows: Record<string, unknown>[]): {
  parsed:  HelpdeskTicket[];
  skipped: { reason: ParseReason; raw: Record<string, unknown> }[];
} {
  const parsed: HelpdeskTicket[] = [];
  const skipped: { reason: ParseReason; raw: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const res = parseHelpdeskRow(r);
    if (res.ok && res.row) parsed.push(res.row);
    else if (res.reason)  skipped.push({ reason: res.reason, raw: r });
  }
  return { parsed, skipped };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test
```

Expected: 57 pass, 0 fail (42 prior + 15 new).

- [ ] **Step 5: Commit**

```bash
git add lib/helpdesk-parse.ts lib/helpdesk-parse.test.ts
git commit -m "feat: add parseHelpdeskRow with date and resolution-time parsers"
```

---

## Task 3: validateHelpdesk in /api/validate

**Files:**
- Modify: `app/api/validate/route.ts`

- [ ] **Step 1: Add imports**

Open `app/api/validate/route.ts`. Find the existing imports block at the top. Find this line:

```typescript
import { parseRMFinanceRows, ParseReason } from '@/lib/rm-finance-parse';
```

Add this line immediately after it:

```typescript
import { parseHelpdeskRows, ParseReason as HelpdeskParseReason } from '@/lib/helpdesk-parse';
```

- [ ] **Step 2: Update dataType detection to recognize helpdesk**

Find the existing block that detects `dataType`:

```typescript
    let dataType: 'sales' | 'maintenance' = 'sales';
    try {
      if (contentType.includes('application/json')) {
        const peek = await req.clone().json();
        if (peek?.dataType === 'maintenance') dataType = 'maintenance';
      } else {
        const fd = await req.clone().formData();
        if (fd.get('dataType') === 'maintenance') dataType = 'maintenance';
      }
    } catch {
      // peek failed; fall through with default 'sales'
    }

    if (dataType === 'maintenance') {
      return validateMaintenance(req);
    }
```

Replace with:

```typescript
    let dataType: 'sales' | 'maintenance' | 'helpdesk' = 'sales';
    try {
      if (contentType.includes('application/json')) {
        const peek = await req.clone().json();
        if (peek?.dataType === 'maintenance') dataType = 'maintenance';
        else if (peek?.dataType === 'helpdesk') dataType = 'helpdesk';
      } else {
        const fd = await req.clone().formData();
        if (fd.get('dataType') === 'maintenance') dataType = 'maintenance';
        else if (fd.get('dataType') === 'helpdesk') dataType = 'helpdesk';
      }
    } catch {
      // peek failed; fall through with default 'sales'
    }

    if (dataType === 'maintenance') return validateMaintenance(req);
    if (dataType === 'helpdesk')    return validateHelpdesk(req);
```

- [ ] **Step 3: Add the validateHelpdesk function**

At the end of `app/api/validate/route.ts`, after the `validateMaintenance` function's closing brace, append:

```typescript
const HELPDESK_REQUIRED_COLS = ['SITE CODE', 'Ticket ID', 'Subject', 'Status', 'Created time'];

const HELPDESK_SKIP_LABEL: Record<HelpdeskParseReason, string> = {
  missing_ticket_id:  'Missing or invalid Ticket ID',
  missing_site_code:  'Missing SITE CODE',
  missing_subject:    'Missing Subject',
  bad_created_time:   'Unparseable Created time',
};

async function validateHelpdesk(req: NextRequest): Promise<NextResponse> {
  try {
    const contentType = req.headers.get('content-type') || '';

    let rows: Record<string, any>[];
    let fileName = 'helpdesk.xlsx';

    if (contentType.includes('application/json')) {
      const body = await req.json();
      rows = Array.isArray(body.rows) ? body.rows : [];
      fileName = body.fileName || fileName;
    } else {
      const fd = await req.formData();
      const file = fd.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = parseExcelBuffer(buffer);
      const sheetName = parsed.sheetNames[0];
      rows = parsed.sheets[sheetName] || [];
      fileName = file.name;
    }

    const checks: Check[] = [];
    const summary = { errors: 0, warnings: 0, passed: 0 };
    const addCheck = (id: string, sheet: string | null, title: string, status: Check['status'], detail: string) => {
      checks.push({ id, sheet, title, status, detail });
      if (status === 'error') summary.errors++;
      else if (status === 'warning') summary.warnings++;
      else summary.passed++;
    };

    const SHEET = 'R & M HELPDESK';
    const firstRow = rows.length > 0 ? rows[0] : {};

    // 1. Required columns
    const presentCols = Object.keys(firstRow);
    const missingCols = HELPDESK_REQUIRED_COLS.filter(c => !presentCols.includes(c));
    if (missingCols.length > 0) {
      addCheck('columns', SHEET, 'Required columns present', 'error',
        `Missing columns: ${missingCols.join(', ')}`);
    } else {
      addCheck('columns', SHEET, 'Required columns present', 'pass',
        `All ${HELPDESK_REQUIRED_COLS.length} required columns present`);
    }

    // 2. Parse-based skip diagnostics
    const { parsed, skipped } = parseHelpdeskRows(rows);
    const skipsByReason = skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] || 0) + 1; return acc;
    }, {});
    const totalSkipped = skipped.length;

    if (totalSkipped === 0) {
      addCheck('parseable', SHEET, 'Rows parseable for ingest', 'pass',
        `All ${rows.length} rows parse cleanly`);
    } else {
      const ratio = rows.length > 0 ? totalSkipped / rows.length : 0;
      const status: Check['status'] = ratio >= 0.05 ? 'error' : 'warning';
      const breakdown = Object.entries(skipsByReason)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${HELPDESK_SKIP_LABEL[k as HelpdeskParseReason] || k}`)
        .join('; ');
      addCheck('parseable', SHEET, 'Rows parseable for ingest', status,
        `${totalSkipped} of ${rows.length} row(s) will be skipped: ${breakdown}`);
    }

    // Date range
    let dateRange: { from: string; to: string } | null = null;
    if (parsed.length > 0) {
      let minD: string | null = null;
      let maxD: string | null = null;
      for (const p of parsed) {
        const day = p.created_time.slice(0, 10);
        if (!minD || day < minD) minD = day;
        if (!maxD || day > maxD) maxD = day;
      }
      if (minD && maxD) {
        dateRange = { from: minD, to: maxD };
        addCheck('date_range', SHEET, 'Date range detected', 'pass', `${minD} → ${maxD}`);
      }
    }

    // 3. Site codes vs DB
    const siteCodesInFile = Array.from(
      new Set(rows.map(r => String(r['SITE CODE'] ?? '').trim().toUpperCase()).filter(Boolean)),
    );
    try {
      const dbRows = await query<{ site_code: string }>('SELECT site_code FROM sites');
      const known = new Set(dbRows.map(r => r.site_code));
      const unknown = siteCodesInFile.filter(c => !known.has(c));
      if (unknown.length === 0) {
        addCheck('site_codes', SHEET, 'Site codes matched to DB', 'pass',
          `All ${siteCodesInFile.length} site code(s) recognised`);
      } else {
        addCheck('site_codes', SHEET, 'Site codes matched to DB', 'warning',
          `${unknown.length} unknown site code(s): ${unknown.slice(0, 5).join(', ')}`);
      }
    } catch {
      // DB unreachable — skip site check
    }

    const errors = summary.errors;
    const warnings = summary.warnings;
    const passed = summary.passed;
    const canIngest = errors === 0;

    return NextResponse.json({
      ok: canIngest,
      canIngest,
      checks,
      summary: { errors, warnings, passed },
      sheetRowCounts: { [SHEET]: rows.length },
      dateRange,
      fileName,
    });
  } catch (err: any) {
    console.error('/api/validate (helpdesk) error:', err);
    return NextResponse.json({
      ok: false, canIngest: false, error: err.message,
      checks: [{ id: 'system', sheet: null, title: 'Validator error', status: 'error', detail: err.message }],
      summary: { errors: 1, warnings: 0, passed: 0 },
    }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add app/api/validate/route.ts
git commit -m "feat: add validateHelpdesk branch with parse-skip diagnostics"
```

---

## Task 4: ingestHelpdesk in /api/ingest

**Files:**
- Modify: `app/api/ingest/route.ts`

- [ ] **Step 1: Add imports**

Open `app/api/ingest/route.ts`. Find this import:

```typescript
import { parseRMFinanceRows } from '@/lib/rm-finance-parse';
```

Add this line immediately after it:

```typescript
import { parseHelpdeskRows } from '@/lib/helpdesk-parse';
```

- [ ] **Step 2: Add helpdesk detection in the POST handler**

Find the existing block that detects R&M and forwards to `ingestMaintenance`:

```typescript
  if (contentType.includes('application/json')) {
    const peekBody = await req.clone().json().catch(() => ({}));
    if (peekBody?.dataType === 'maintenance') {
      return ingestMaintenance(peekBody);
    }
  }
```

Replace with:

```typescript
  if (contentType.includes('application/json')) {
    const peekBody = await req.clone().json().catch(() => ({}));
    if (peekBody?.dataType === 'maintenance') {
      return ingestMaintenance(peekBody);
    }
    if (peekBody?.dataType === 'helpdesk') {
      return ingestHelpdesk(peekBody);
    }
  }
```

- [ ] **Step 3: Add the ingestHelpdesk function**

At the end of `app/api/ingest/route.ts`, after the closing brace of `ingestMaintenance`, append:

```typescript
async function ingestHelpdesk(body: any): Promise<NextResponse> {
  const startMs = Date.now();
  const rows: Record<string, any>[] = Array.isArray(body?.rows) ? body.rows : [];
  const fileName: string = body?.fileName || 'helpdesk.xlsx';
  const incomingLogId: number | null =
    typeof body?.uploadLogId === 'number' ? body.uploadLogId : null;
  const isFinal: boolean = body?.final !== false;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
  }

  let uploadId: number;
  if (incomingLogId) {
    uploadId = incomingLogId;
  } else {
    const logRow = await query<{ id: number }>(
      `INSERT INTO upload_log (file_name, file_size_bytes, status)
       VALUES ($1, $2, 'pending') RETURNING id`,
      [fileName, 0],
    );
    uploadId = logRow[0].id;
  }

  try {
    // 1. Parse
    const { parsed, skipped } = parseHelpdeskRows(rows);

    // 2. Site code resolution
    const knownSites = await query<{ site_code: string }>('SELECT site_code FROM sites');
    const known = new Set(knownSites.map(r => r.site_code));

    const matched: any[][] = [];
    const unmatched: any[][] = [];
    for (const r of parsed) {
      if (known.has(r.site_code)) {
        matched.push([
          r.ticket_id, r.site_code, r.subject, r.status, r.priority,
          r.source, r.ticket_group, r.agent, r.equipment, r.service_provider,
          r.created_time, r.due_time, r.resolved_time, r.closed_time,
          r.resolution_minutes, r.resolution_status,
          uploadId, fileName,
        ]);
      } else {
        unmatched.push([r.site_code, r.created_time, 'R & M HELPDESK', fileName, uploadId]);
      }
    }

    // 3. Bulk upsert. ON CONFLICT updates only mutable fields.
    let upserted = 0;
    if (matched.length > 0) {
      const placeholders = matched.map((row, bi) => {
        const offset = bi * row.length;
        return `(${row.map((_, ci) => `$${offset + ci + 1}`).join(',')})`;
      }).join(',');
      const params = matched.flat();
      const result = await query<any>(
        `INSERT INTO rm_helpdesk_tickets
           (ticket_id, site_code, subject, status, priority,
            source, ticket_group, agent, equipment, service_provider,
            created_time, due_time, resolved_time, closed_time,
            resolution_minutes, resolution_status,
            upload_log_id, source_file)
         VALUES ${placeholders}
         ON CONFLICT (ticket_id) DO UPDATE SET
           status             = EXCLUDED.status,
           priority           = EXCLUDED.priority,
           agent              = EXCLUDED.agent,
           service_provider   = EXCLUDED.service_provider,
           due_time           = EXCLUDED.due_time,
           resolved_time      = EXCLUDED.resolved_time,
           closed_time        = EXCLUDED.closed_time,
           resolution_minutes = EXCLUDED.resolution_minutes,
           resolution_status  = EXCLUDED.resolution_status,
           upload_log_id      = EXCLUDED.upload_log_id,
           source_file        = EXCLUDED.source_file,
           ingested_at        = NOW()
         RETURNING 1`,
        params,
      );
      upserted = result.length;
    }

    // 4. Unmatched
    if (unmatched.length > 0) {
      const placeholders = unmatched.map((row, bi) => {
        const offset = bi * row.length;
        return `(${row.map((_, ci) => `$${offset + ci + 1}`).join(',')})`;
      }).join(',');
      const params = unmatched.flat();
      await query(
        `INSERT INTO unmatched_status_rows
           (raw_site_code, sale_date, sheet_name, source_file, upload_log_id)
         VALUES ${placeholders}`,
        params,
      );
    }

    // 5. Discover unseen description_norm from this upload's tickets,
    //    insert placeholders. Shared cache with invoices.
    const placeholderRes = await query<{ n: string }>(
      `WITH unseen AS (
         SELECT DISTINCT t.description_norm
           FROM rm_helpdesk_tickets t
           LEFT JOIN rm_description_categories r USING (description_norm)
          WHERE r.id IS NULL
            AND t.description_norm <> ''
            AND t.upload_log_id = $1
       )
       INSERT INTO rm_description_categories (description_norm, category_id, source)
       SELECT u.description_norm,
              (SELECT id FROM rm_categories WHERE slug='other'),
              'pending'
         FROM unseen u
       ON CONFLICT (description_norm) DO NOTHING
       RETURNING 1`,
      [uploadId],
    );
    const pendingInserted = placeholderRes.length;

    // 5b. Apply active keyword rules immediately so rule-matched subjects
    //     show up in the dashboard without waiting for the cron.
    await query(APPLY_RULES_SQL).catch(e => console.warn('rule apply failed:', e));

    // 6. Bookkeeping — accumulate across chunks.
    const chunkSummary = {
      total: rows.length,
      upserted,
      unmatched: unmatched.length,
      skipped: skipped.length,
      skipped_reasons: skipped.reduce<Record<string, number>>((acc, s) => {
        acc[s.reason] = (acc[s.reason] || 0) + 1; return acc;
      }, {}),
      pending_descriptions: pendingInserted,
      data_type: 'helpdesk',
    };

    const priorRow = await query<{ row_counts: any; duration_ms: number | null }>(
      `SELECT row_counts, duration_ms FROM upload_log WHERE id = $1`,
      [uploadId],
    );
    const prior = (priorRow[0]?.row_counts as Record<string, any>) || {};
    const priorReasons = (prior.skipped_reasons as Record<string, number>) || {};
    const mergedReasons: Record<string, number> = { ...priorReasons };
    for (const [k, v] of Object.entries(chunkSummary.skipped_reasons)) {
      mergedReasons[k] = (mergedReasons[k] || 0) + v;
    }
    const mergedSummary = {
      total:                (prior.total                || 0) + chunkSummary.total,
      upserted:             (prior.upserted             || 0) + chunkSummary.upserted,
      unmatched:            (prior.unmatched            || 0) + chunkSummary.unmatched,
      skipped:              (prior.skipped              || 0) + chunkSummary.skipped,
      skipped_reasons:      mergedReasons,
      pending_descriptions: (prior.pending_descriptions || 0) + chunkSummary.pending_descriptions,
      data_type:            'helpdesk',
    };
    const cumulativeMs = (priorRow[0]?.duration_ms || 0) + (Date.now() - startMs);

    await query(
      `UPDATE upload_log
          SET status      = $1,
              row_counts  = $2,
              duration_ms = $3
        WHERE id = $4`,
      [
        isFinal ? 'success' : 'pending',
        JSON.stringify(mergedSummary),
        cumulativeMs,
        uploadId,
      ],
    );

    return NextResponse.json({
      ok: true,
      uploadLogId: uploadId,
      summary: chunkSummary,
      cumulative: mergedSummary,
      final: isFinal,
    });
  } catch (err: any) {
    console.error('/api/ingest (helpdesk) error:', err);
    await query(
      `UPDATE upload_log SET status='failed', error_message=$1 WHERE id=$2`,
      [String(err.message || 'Unknown error'), uploadId],
    ).catch(() => {});
    return NextResponse.json({ error: err.message || 'Helpdesk ingest failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: 57 pass (no regression).

- [ ] **Step 6: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "feat: add ingestHelpdesk with chunked upload and shared categorization"
```

---

## Task 5: UploadPanel extension

**Files:**
- Modify: `components/ui/UploadPanel.tsx`

- [ ] **Step 1: Extend the dataType state**

Open `components/ui/UploadPanel.tsx`. Find:

```typescript
  const [dataType, setDataType]   = useState<'sales' | 'maintenance'>('sales');
```

Replace with:

```typescript
  const [dataType, setDataType]   = useState<'sales' | 'maintenance' | 'helpdesk'>('sales');
```

- [ ] **Step 2: Add Helpdesk option to the data type dropdown**

Find:

```tsx
        <select
          value={dataType}
          onChange={e => setDataType(e.target.value as 'sales' | 'maintenance')}
          disabled={phase !== 'idle' && phase !== 'error'}
          className="text-sm border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100 disabled:text-gray-400"
        >
          <option value="sales">Sales (Status Report)</option>
          <option value="maintenance">R&amp;M (Repairs &amp; Maintenance)</option>
        </select>
```

Replace with:

```tsx
        <select
          value={dataType}
          onChange={e => setDataType(e.target.value as 'sales' | 'maintenance' | 'helpdesk')}
          disabled={phase !== 'idle' && phase !== 'error'}
          className="text-sm border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100 disabled:text-gray-400"
        >
          <option value="sales">Sales (Status Report)</option>
          <option value="maintenance">R&amp;M (Repairs &amp; Maintenance)</option>
          <option value="helpdesk">R&amp;M Helpdesk</option>
        </select>
```

- [ ] **Step 3: Skip sales-style parsing when dataType is helpdesk**

Find:

```typescript
      if (dataType === 'maintenance') {
        // Maintenance uploads skip the sales-specific multi-sheet parser.
        // Parsing happens inside handleValidate instead.
        setParsing(false);
        return;
      }
```

Replace with:

```typescript
      if (dataType === 'maintenance' || dataType === 'helpdesk') {
        // R&M Finance and Helpdesk uploads skip the sales-specific multi-sheet
        // parser. Parsing happens inside handleValidate instead.
        setParsing(false);
        return;
      }
```

- [ ] **Step 4: Add helpdesk validation branch**

In `handleValidate`, find the maintenance branch (`if (dataType === 'maintenance') {`). Immediately AFTER the maintenance branch's closing `}` and BEFORE `// ──── Sales validation (unchanged below) ────`, insert:

```typescript
      if (dataType === 'helpdesk') {
        // Pick the R & M HELPDESK sheet by name.
        const xlsxModule = await import('xlsx');
        const XLSX = xlsxModule.default ?? xlsxModule;
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array', cellDates: true });

        const helpdeskSheetName =
          wb.SheetNames.find(n => n.trim().toUpperCase().replace(/\s+/g, ' ') === 'R & M HELPDESK')
          ?? (wb.SheetNames.length === 1 ? wb.SheetNames[0] : null);

        if (!helpdeskSheetName) {
          throw new Error(
            `Helpdesk ingest requires a sheet named "R & M HELPDESK". ` +
            `Found sheets: ${wb.SheetNames.join(', ')}`,
          );
        }

        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(
          wb.Sheets[helpdeskSheetName], { defval: null, raw: false }
        );

        const { data } = await postJSON('/api/validate', {
          dataType: 'helpdesk',
          rows,
          fileName: file.name,
        });

        (window as any).__helpdeskParsedRows = rows;

        setValidation({
          checks: [], summary: { errors: 0, warnings: 0, passed: 0 },
          sheetRowCounts: {}, dateRange: null, fileName: file.name, ok: false, canIngest: false,
          ...data,
        });
        setPhase('validated');
        return;
      }
```

- [ ] **Step 5: Add helpdesk ingest branch**

In `handleIngest`, find the maintenance branch (`if (dataType === 'maintenance') {`). The branch ends with `return;` followed by `}`. Immediately AFTER that closing `}` and BEFORE `// ──── Sales ingest (unchanged below) ────`, insert:

```typescript
      if (dataType === 'helpdesk') {
        const rows = (window as any).__helpdeskParsedRows;
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error('No parsed helpdesk rows available — please re-validate');
        }

        const CHUNK_SIZE = 2000;
        const totalChunks = Math.max(1, Math.ceil(rows.length / CHUNK_SIZE));
        let logId: number | null = null;
        let cumulative: any = null;

        for (let i = 0; i < totalChunks; i++) {
          const chunk = rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          const isFinal = i === totalChunks - 1;
          setIngestProgress({ current: i + 1, total: totalChunks });

          const { data } = await postJSON('/api/ingest', {
            dataType: 'helpdesk',
            rows: chunk,
            fileName: file.name,
            uploadLogId: logId,
            final: isFinal,
          });
          if (!data.ok) throw new Error(data.error || 'Helpdesk ingest failed');

          logId = data.uploadLogId ?? logId;
          cumulative = data.cumulative ?? cumulative;
        }

        setIngestProgress(null);
        setDuration(Date.now() - start);
        setRowCounts({ helpdesk: cumulative?.upserted || 0 } as any);

        const pending = Number(cumulative?.pending_descriptions || 0);
        if (pending > 0) {
          setCategorizing({ uploadLogId: logId, pending });
        } else {
          setPhase('done');
          onSuccess();
        }
        delete (window as any).__helpdeskParsedRows;
        return;
      }
```

- [ ] **Step 6: Update reset() to clear helpdesk parsed rows**

Find the `reset` function:

```typescript
  const reset = () => {
    setFile(null); setParsed(null); setParsing(false); setPeriod(''); setPhase('idle');
    setValidation(null); setPreflight(null); setRowCounts(null); setDuration(null);
    setIngestLog(''); setErrorMsg('');
    setIngestProgress(null); setCategorizing(null);
    delete (window as any).__rmParsedRows;
    if (inputRef.current) inputRef.current.value = '';
  };
```

Replace with:

```typescript
  const reset = () => {
    setFile(null); setParsed(null); setParsing(false); setPeriod(''); setPhase('idle');
    setValidation(null); setPreflight(null); setRowCounts(null); setDuration(null);
    setIngestLog(''); setErrorMsg('');
    setIngestProgress(null); setCategorizing(null);
    delete (window as any).__rmParsedRows;
    delete (window as any).__helpdeskParsedRows;
    if (inputRef.current) inputRef.current.value = '';
  };
```

- [ ] **Step 7: Update the validation button condition**

Find:

```tsx
      {file && (dataType === 'maintenance' || parsed) && phase === 'idle' && (
```

Replace with:

```tsx
      {file && (dataType === 'maintenance' || dataType === 'helpdesk' || parsed) && phase === 'idle' && (
```

- [ ] **Step 8: Update the "Upload" button condition**

Find:

```tsx
          {validation.canIngest && dataType === 'maintenance' && (
            <button onClick={handleIngest}
                    className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white
                               text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2">
              Upload R&amp;M Data
            </button>
          )}
```

Replace with:

```tsx
          {validation.canIngest && dataType === 'maintenance' && (
            <button onClick={handleIngest}
                    className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white
                               text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2">
              Upload R&amp;M Data
            </button>
          )}
          {validation.canIngest && dataType === 'helpdesk' && (
            <button onClick={handleIngest}
                    className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white
                               text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2">
              Upload Helpdesk Data
            </button>
          )}
```

- [ ] **Step 9: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add components/ui/UploadPanel.tsx
git commit -m "feat: add helpdesk option to UploadPanel with chunked ingest"
```

---

## Task 6: Read endpoints — KPIs, trend, open

**Files:**
- Create: `app/api/helpdesk/kpis/route.ts`
- Create: `app/api/helpdesk/trend/route.ts`
- Create: `app/api/helpdesk/open/route.ts`

- [ ] **Step 1: Create KPIs endpoint**

Create `app/api/helpdesk/kpis/route.ts`:

```typescript
// app/api/helpdesk/kpis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface F { dateFrom?: string; dateTo?: string; priority?: string; status?: string; category?: string; siteCode?: string; }

function readFilters(req: NextRequest): F {
  const sp = req.nextUrl.searchParams;
  return {
    dateFrom: sp.get('dateFrom') || undefined,
    dateTo:   sp.get('dateTo')   || undefined,
    priority: sp.get('priority') || undefined,
    status:   sp.get('status')   || undefined,
    category: sp.get('category') || undefined,
    siteCode: sp.get('siteCode') || undefined,
  };
}

function whereClause(f: F, includeCategory: boolean) {
  const clauses: string[] = ['1=1'];
  const params: any[] = [];
  let p = 1;
  if (f.dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(f.dateFrom); }
  if (f.dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(f.dateTo); }
  if (f.priority) { clauses.push(`t.priority = $${p++}`); params.push(f.priority); }
  if (f.status)   { clauses.push(`t.status = $${p++}`); params.push(f.status); }
  if (f.siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(f.siteCode); }
  if (includeCategory && f.category) { clauses.push(`c.slug = $${p++}`); params.push(f.category); }
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

export async function GET(req: NextRequest) {
  try {
    const f = readFilters(req);
    const base = `
      FROM rm_helpdesk_tickets t
      LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
      LEFT JOIN rm_categories c ON r.category_id = c.id
    `;
    const w = whereClause(f, true);

    // Total + open count
    const totals = await query<any>(
      `SELECT
         COUNT(*)::INT                                                            AS total,
         COUNT(*) FILTER (WHERE t.status NOT IN ('Closed', 'Resolved'))::INT       AS open_count,
         COUNT(*) FILTER (WHERE t.resolution_status = 'SLA Violated')::INT         AS sla_violated,
         AVG(t.resolution_minutes) FILTER (WHERE t.resolution_minutes IS NOT NULL) AS avg_resolution_minutes
       ${base} ${w.where}`,
      w.params,
    );

    // Open by priority
    const wOpen = { ...w };
    const openByPriority = await query<{ priority: string; n: string }>(
      `SELECT COALESCE(t.priority, 'Unspecified') AS priority, COUNT(*)::TEXT AS n
       ${base} ${w.where} AND t.status NOT IN ('Closed', 'Resolved')
       GROUP BY 1 ORDER BY 2 DESC`,
      w.params,
    );

    // Top equipment
    const topEquip = await query<{ equipment: string; n: string }>(
      `SELECT COALESCE(t.equipment, 'Unspecified') AS equipment, COUNT(*)::TEXT AS n
       ${base} ${w.where}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
      w.params,
    );

    const total = parseInt(totals[0]?.total || 0);
    const slaViolated = parseInt(totals[0]?.sla_violated || 0);
    const slaViolatedPct = total > 0 ? +(slaViolated * 100 / total).toFixed(1) : 0;
    const avgResMins = totals[0]?.avg_resolution_minutes != null
      ? Math.round(parseFloat(totals[0].avg_resolution_minutes))
      : null;

    const openByPriorityMap: Record<string, number> = {};
    for (const r of openByPriority) openByPriorityMap[r.priority] = parseInt(r.n, 10);

    return NextResponse.json({
      data: {
        openCount:            parseInt(totals[0]?.open_count || 0),
        openByPriority:       openByPriorityMap,
        slaViolatedCount:     slaViolated,
        slaViolatedPct,
        avgResolutionMinutes: avgResMins,
        topEquipment:         topEquip[0]?.equipment ?? null,
        topEquipmentCount:    topEquip[0]?.n ? parseInt(topEquip[0].n, 10) : 0,
      },
    });
  } catch (err: any) {
    console.error('/api/helpdesk/kpis error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create trend endpoint**

Create `app/api/helpdesk/trend/route.ts`:

```typescript
// app/api/helpdesk/trend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') || undefined;
    const dateTo   = sp.get('dateTo')   || undefined;
    const priority = sp.get('priority') || undefined;
    const status   = sp.get('status')   || undefined;
    const category = sp.get('category') || undefined;
    const siteCode = sp.get('siteCode') || undefined;
    const granularity = sp.get('granularity') === 'daily' ? 'daily' : 'monthly';

    const clauses: string[] = ['1=1'];
    const params: any[] = [];
    let p = 1;
    if (dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (priority) { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (status)   { clauses.push(`t.status = $${p++}`); params.push(status); }
    if (siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }
    if (category) { clauses.push(`c.slug = $${p++}`); params.push(category); }

    const bucket = granularity === 'daily'
      ? `t.created_time::DATE`
      : `DATE_TRUNC('month', t.created_time)::DATE`;

    const rows = await query<any>(
      `SELECT ${bucket} AS bucket, COUNT(*)::INT AS count
         FROM rm_helpdesk_tickets t
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY bucket
        ORDER BY bucket`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        period: r.bucket,
        count: r.count,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/trend error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create open tickets endpoint**

Create `app/api/helpdesk/open/route.ts`:

```typescript
// app/api/helpdesk/open/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const priority = sp.get('priority') || undefined;
    const siteCode = sp.get('siteCode') || undefined;
    const category = sp.get('category') || undefined;
    const limit    = Math.min(Math.max(1, parseInt(sp.get('limit') || '200')), 500);

    const clauses: string[] = [`t.status NOT IN ('Closed', 'Resolved')`];
    const params: any[] = [];
    let p = 1;
    if (priority) { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }
    if (category) { clauses.push(`c.slug = $${p++}`); params.push(category); }
    params.push(limit);

    const rows = await query<any>(
      `SELECT t.ticket_id, t.site_code, s.budget_name AS site_name,
              t.priority, t.created_time, t.subject,
              EXTRACT(EPOCH FROM (NOW() - t.created_time))::INT / 86400 AS days_open
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.created_time ASC
        LIMIT $${p}`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        ticketId:    r.ticket_id,
        siteCode:    r.site_code,
        siteName:    r.site_name,
        priority:    r.priority,
        createdTime: r.created_time,
        daysOpen:    r.days_open,
        subject:     r.subject,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/open error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/helpdesk/kpis/route.ts app/api/helpdesk/trend/route.ts app/api/helpdesk/open/route.ts
git commit -m "feat: add helpdesk KPIs, trend, and open-tickets endpoints"
```

---

## Task 7: Read endpoints — recurring, sites, contractors, tickets

**Files:**
- Create: `app/api/helpdesk/recurring/route.ts`
- Create: `app/api/helpdesk/sites/route.ts`
- Create: `app/api/helpdesk/contractors/route.ts`
- Create: `app/api/helpdesk/tickets/route.ts`

- [ ] **Step 1: Create recurring endpoint**

Create `app/api/helpdesk/recurring/route.ts`:

```typescript
// app/api/helpdesk/recurring/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') || undefined;
    const dateTo   = sp.get('dateTo')   || undefined;
    const priority = sp.get('priority') || undefined;
    const category = sp.get('category') || undefined;
    const siteCode = sp.get('siteCode') || undefined;
    const limit    = Math.min(Math.max(1, parseInt(sp.get('limit') || '20')), 100);

    const clauses: string[] = ['1=1'];
    const params: any[] = [];
    let p = 1;
    if (dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (priority) { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }
    if (category) { clauses.push(`c.slug = $${p++}`); params.push(category); }
    params.push(limit);

    const rows = await query<any>(
      `SELECT t.description_norm,
              MIN(t.subject) AS sample_subject,
              COUNT(*)::INT  AS count,
              c.slug         AS category_slug,
              c.display_name AS category_name
         FROM rm_helpdesk_tickets t
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY t.description_norm, c.slug, c.display_name
        ORDER BY count DESC
        LIMIT $${p}`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        descriptionNorm: r.description_norm,
        sampleSubject:   r.sample_subject,
        count:           r.count,
        categorySlug:    r.category_slug,
        categoryName:    r.category_name,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/recurring error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create sites endpoint**

Create `app/api/helpdesk/sites/route.ts`:

```typescript
// app/api/helpdesk/sites/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') || undefined;
    const dateTo   = sp.get('dateTo')   || undefined;
    const priority = sp.get('priority') || undefined;
    const category = sp.get('category') || undefined;

    const clauses: string[] = ['1=1'];
    const params: any[] = [];
    let p = 1;
    if (dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (priority) { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (category) { clauses.push(`c.slug = $${p++}`); params.push(category); }

    const rows = await query<any>(
      `SELECT t.site_code,
              s.budget_name AS site_name,
              COUNT(*)::INT AS total,
              COUNT(*) FILTER (WHERE t.status NOT IN ('Closed', 'Resolved'))::INT AS open,
              AVG(t.resolution_minutes) FILTER (WHERE t.resolution_minutes IS NOT NULL) AS avg_res
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY t.site_code, s.budget_name
        ORDER BY total DESC
        LIMIT 1000`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        siteCode: r.site_code,
        siteName: r.site_name,
        total:    r.total,
        open:     r.open,
        avgResolutionMinutes: r.avg_res != null ? Math.round(parseFloat(r.avg_res)) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/sites error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create contractors endpoint**

Create `app/api/helpdesk/contractors/route.ts`:

```typescript
// app/api/helpdesk/contractors/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') || undefined;
    const dateTo   = sp.get('dateTo')   || undefined;
    const siteCode = sp.get('siteCode') || undefined;

    const clauses: string[] = [`t.service_provider IS NOT NULL`, `t.service_provider <> ''`];
    const params: any[] = [];
    let p = 1;
    if (dateFrom) { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)   { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (siteCode) { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }

    const rows = await query<any>(
      `SELECT t.service_provider AS provider,
              COUNT(*)::INT AS ticket_count,
              AVG(t.resolution_minutes) FILTER (WHERE t.resolution_minutes IS NOT NULL) AS avg_res,
              ROUND(
                COUNT(*) FILTER (WHERE t.resolution_status = 'Within SLA')::NUMERIC
                / NULLIF(COUNT(*) FILTER (WHERE t.resolution_status IS NOT NULL), 0)
                * 100, 1
              ) AS sla_hit_pct
         FROM rm_helpdesk_tickets t
        WHERE ${clauses.join(' AND ')}
        GROUP BY t.service_provider
        ORDER BY ticket_count DESC
        LIMIT 200`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        provider:             r.provider,
        ticketCount:          r.ticket_count,
        avgResolutionMinutes: r.avg_res != null ? Math.round(parseFloat(r.avg_res)) : null,
        slaHitPct:            r.sla_hit_pct != null ? parseFloat(r.sla_hit_pct) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/contractors error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create tickets (drill-down) endpoint**

Create `app/api/helpdesk/tickets/route.ts`:

```typescript
// app/api/helpdesk/tickets/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom    = sp.get('dateFrom')    || undefined;
    const dateTo      = sp.get('dateTo')      || undefined;
    const priority    = sp.get('priority')    || undefined;
    const status      = sp.get('status')      || undefined;
    const category    = sp.get('category')    || undefined;
    const siteCode    = sp.get('siteCode')    || undefined;
    const provider    = sp.get('provider')    || undefined;
    const description = sp.get('description') || undefined;
    const limit       = Math.min(Math.max(1, parseInt(sp.get('limit') || '200')), 500);

    const clauses: string[] = ['1=1'];
    const params: any[] = [];
    let p = 1;
    if (dateFrom)    { clauses.push(`t.created_time::DATE >= $${p++}`); params.push(dateFrom); }
    if (dateTo)      { clauses.push(`t.created_time::DATE <= $${p++}`); params.push(dateTo); }
    if (priority)    { clauses.push(`t.priority = $${p++}`); params.push(priority); }
    if (status)      { clauses.push(`t.status = $${p++}`); params.push(status); }
    if (category)    { clauses.push(`c.slug = $${p++}`); params.push(category); }
    if (siteCode)    { clauses.push(`t.site_code = $${p++}`); params.push(siteCode); }
    if (provider)    { clauses.push(`t.service_provider = $${p++}`); params.push(provider); }
    if (description) { clauses.push(`t.description_norm = $${p++}`); params.push(description); }
    params.push(limit);

    const rows = await query<any>(
      `SELECT t.ticket_id, t.site_code, s.budget_name AS site_name,
              t.subject, t.status, t.priority, t.equipment,
              t.service_provider, t.created_time, t.resolved_time, t.closed_time,
              t.resolution_minutes, t.resolution_status,
              c.slug AS category_slug, c.display_name AS category_name,
              r.source AS category_source, r.needs_review,
              t.description_norm
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.created_time DESC
        LIMIT $${p}`,
      params,
    );

    return NextResponse.json({
      data: rows.map(r => ({
        ticketId:           r.ticket_id,
        siteCode:           r.site_code,
        siteName:           r.site_name,
        subject:            r.subject,
        descriptionNorm:    r.description_norm,
        status:             r.status,
        priority:           r.priority,
        equipment:          r.equipment,
        serviceProvider:    r.service_provider,
        createdTime:        r.created_time,
        resolvedTime:       r.resolved_time,
        closedTime:         r.closed_time,
        resolutionMinutes:  r.resolution_minutes,
        resolutionStatus:   r.resolution_status,
        categorySlug:       r.category_slug,
        categoryName:       r.category_name,
        categorySource:     r.category_source,
        needsReview:        r.needs_review,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/tickets error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/helpdesk/recurring/route.ts app/api/helpdesk/sites/route.ts app/api/helpdesk/contractors/route.ts app/api/helpdesk/tickets/route.ts
git commit -m "feat: add helpdesk recurring/sites/contractors/tickets endpoints"
```

---

## Task 8: HelpdeskKPICards and OpenTicketsPanel

**Files:**
- Create: `components/helpdesk/HelpdeskKPICards.tsx`
- Create: `components/helpdesk/OpenTicketsPanel.tsx`

- [ ] **Step 1: Create HelpdeskKPICards**

Create `components/helpdesk/HelpdeskKPICards.tsx`:

```tsx
'use client';

interface HelpdeskKpis {
  openCount: number;
  openByPriority: Record<string, number>;
  slaViolatedCount: number;
  slaViolatedPct: number;
  avgResolutionMinutes: number | null;
  topEquipment: string | null;
  topEquipmentCount: number;
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card flex-1 min-w-[180px]">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-800 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function fmtHours(mins: number | null) {
  if (mins == null) return '—';
  const hrs = mins / 60;
  if (hrs < 24) return `${hrs.toFixed(1)} hrs`;
  return `${(hrs / 24).toFixed(1)} days`;
}

export default function HelpdeskKPICards({ kpis }: { kpis: HelpdeskKpis | null }) {
  if (!kpis) return null;
  const urgent = kpis.openByPriority['Urgent'] || 0;
  return (
    <div className="flex flex-wrap gap-3">
      <Card
        label="Open Tickets"
        value={kpis.openCount.toLocaleString()}
        sub={urgent > 0 ? `${urgent} Urgent` : undefined}
      />
      <Card
        label="SLA Violated"
        value={`${kpis.slaViolatedCount.toLocaleString()} (${kpis.slaViolatedPct}%)`}
        sub="In filter window"
      />
      <Card
        label="Avg Resolution"
        value={fmtHours(kpis.avgResolutionMinutes)}
      />
      <Card
        label="Top Equipment"
        value={kpis.topEquipment || '—'}
        sub={kpis.topEquipmentCount > 0 ? `${kpis.topEquipmentCount} tickets` : undefined}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create OpenTicketsPanel**

Create `components/helpdesk/OpenTicketsPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface OpenTicket {
  ticketId:    number;
  siteCode:    string;
  siteName:    string;
  priority:    string | null;
  createdTime: string;
  daysOpen:    number;
  subject:     string;
}

interface Filters { priority?: string; siteCode?: string; category?: string; }

const PRIORITY_COLORS: Record<string, string> = {
  'Urgent': 'bg-red-100 text-red-800',
  'High':   'bg-orange-100 text-orange-800',
  'Medium': 'bg-amber-100 text-amber-800',
  'Low':    'bg-blue-100 text-blue-800',
};

interface Props {
  filters: Filters;
  onPickTicket: (ticketId: number) => void;
}

export default function OpenTicketsPanel({ filters, onPickTicket }: Props) {
  const [rows, setRows] = useState<OpenTicket[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.siteCode) p.set('siteCode', filters.siteCode);
    if (filters.category) p.set('category', filters.category);
    p.set('limit', '50');

    setLoading(true);
    fetch(`/api/helpdesk/open?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Open / Pending Tickets (oldest first)</h3>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Ticket</th>
              <th className="px-3 py-1">Site</th>
              <th className="px-3 py-1">Priority</th>
              <th className="px-3 py-1 text-right">Days Open</th>
              <th className="px-3 py-1">Subject</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ticketId}
                  onClick={() => onPickTicket(r.ticketId)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1 font-mono">{r.ticketId}</td>
                <td className="px-3 py-1">{r.siteName}</td>
                <td className="px-3 py-1">
                  {r.priority && (
                    <span className={`inline-block rounded px-1.5 ${PRIORITY_COLORS[r.priority] || 'bg-gray-100 text-gray-700'}`}>
                      {r.priority}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1 text-right tabular-nums">{r.daysOpen}</td>
                <td className="px-3 py-1">{r.subject}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">No open tickets.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/helpdesk/HelpdeskKPICards.tsx components/helpdesk/OpenTicketsPanel.tsx
git commit -m "feat: add HelpdeskKPICards and OpenTicketsPanel components"
```

---

## Task 9: TopRecurringPanel, SitesPanel, ContractorsPanel

**Files:**
- Create: `components/helpdesk/TopRecurringPanel.tsx`
- Create: `components/helpdesk/SitesPanel.tsx`
- Create: `components/helpdesk/ContractorsPanel.tsx`

- [ ] **Step 1: Create TopRecurringPanel**

Create `components/helpdesk/TopRecurringPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface Row {
  descriptionNorm: string;
  sampleSubject:   string;
  count:           number;
  categorySlug:    string | null;
  categoryName:    string | null;
}

interface Filters { dateFrom?: string; dateTo?: string; priority?: string; category?: string; siteCode?: string; }

interface Props {
  filters: Filters;
  onPickDescription: (descriptionNorm: string, label: string) => void;
}

export default function TopRecurringPanel({ filters, onPickDescription }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams({ limit: '20' });
    if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   p.set('dateTo',   filters.dateTo);
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.category) p.set('category', filters.category);
    if (filters.siteCode) p.set('siteCode', filters.siteCode);

    setLoading(true);
    fetch(`/api/helpdesk/recurring?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Top Recurring Problems</h3>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Subject</th>
              <th className="px-3 py-1">Category</th>
              <th className="px-3 py-1 text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.descriptionNorm}
                  onClick={() => onPickDescription(r.descriptionNorm, r.sampleSubject)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1">{r.sampleSubject}</td>
                <td className="px-3 py-1 text-gray-600">{r.categoryName || '—'}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.count}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-500">No data.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create SitesPanel**

Create `components/helpdesk/SitesPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface SiteRow {
  siteCode: string;
  siteName: string;
  total: number;
  open: number;
  avgResolutionMinutes: number | null;
}

interface Filters { dateFrom?: string; dateTo?: string; priority?: string; category?: string; }

interface Props {
  filters: Filters;
  onPickSite: (siteCode: string, siteName: string) => void;
}

function fmtHours(mins: number | null) {
  if (mins == null) return '—';
  return `${(mins / 60).toFixed(1)} h`;
}

export default function SitesPanel({ filters, onPickSite }: Props) {
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   p.set('dateTo',   filters.dateTo);
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.category) p.set('category', filters.category);

    setLoading(true);
    fetch(`/api/helpdesk/sites?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Sites by Ticket Count</h3>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Site</th>
              <th className="px-3 py-1 text-right">Total</th>
              <th className="px-3 py-1 text-right">Open</th>
              <th className="px-3 py-1 text-right">Avg Res</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.siteCode}
                  onClick={() => onPickSite(r.siteCode, r.siteName)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1">{r.siteName}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.total}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.open}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtHours(r.avgResolutionMinutes)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-500">No data.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create ContractorsPanel**

Create `components/helpdesk/ContractorsPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface ContractorRow {
  provider: string;
  ticketCount: number;
  avgResolutionMinutes: number | null;
  slaHitPct: number | null;
}

interface Filters { dateFrom?: string; dateTo?: string; siteCode?: string; }

interface Props {
  filters: Filters;
  onPickContractor: (provider: string) => void;
}

function fmtHours(mins: number | null) {
  if (mins == null) return '—';
  return `${(mins / 60).toFixed(1)} h`;
}

export default function ContractorsPanel({ filters, onPickContractor }: Props) {
  const [rows, setRows] = useState<ContractorRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   p.set('dateTo',   filters.dateTo);
    if (filters.siteCode) p.set('siteCode', filters.siteCode);

    setLoading(true);
    fetch(`/api/helpdesk/contractors?${p}`)
      .then(r => r.json())
      .then(d => setRows(d?.data || []))
      .finally(() => setLoading(false));
  }, [JSON.stringify(filters)]);

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Service Providers</h3>
      </div>
      {loading && <div className="p-3 text-xs text-gray-600">Loading…</div>}
      {!loading && (
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-1">Provider</th>
              <th className="px-3 py-1 text-right">Tickets</th>
              <th className="px-3 py-1 text-right">Avg Res</th>
              <th className="px-3 py-1 text-right">SLA Hit %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.provider}
                  onClick={() => onPickContractor(r.provider)}
                  className="cursor-pointer border-t hover:bg-gray-50">
                <td className="px-3 py-1">{r.provider}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.ticketCount}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtHours(r.avgResolutionMinutes)}</td>
                <td className="px-3 py-1 text-right tabular-nums">{r.slaHitPct != null ? `${r.slaHitPct}%` : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-500">No data.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/helpdesk/TopRecurringPanel.tsx components/helpdesk/SitesPanel.tsx components/helpdesk/ContractorsPanel.tsx
git commit -m "feat: add TopRecurringPanel SitesPanel ContractorsPanel for helpdesk"
```

---

## Task 10: TicketDrawer with batched reclassify

**Files:**
- Create: `components/helpdesk/TicketDrawer.tsx`

- [ ] **Step 1: Implement TicketDrawer**

Create `components/helpdesk/TicketDrawer.tsx`:

```tsx
// components/helpdesk/TicketDrawer.tsx
'use client';

import { useEffect, useState } from 'react';
import { normalizeDescription } from '@/lib/normalize-description';

export interface TicketFilters {
  ticketId?:    number;
  siteCode?:    string;
  category?:    string;
  description?: string;
  dateFrom?:    string;
  dateTo?:      string;
  priority?:    string;
  status?:      string;
  provider?:    string;
}

interface Ticket {
  ticketId:           number;
  siteCode:           string;
  siteName:           string;
  subject:            string;
  descriptionNorm:    string;
  status:             string;
  priority:           string | null;
  equipment:          string | null;
  serviceProvider:    string | null;
  createdTime:        string;
  resolvedTime:       string | null;
  closedTime:         string | null;
  resolutionMinutes:  number | null;
  resolutionStatus:   string | null;
  categorySlug:       string | null;
  categoryName:       string | null;
  categorySource:     string | null;
  needsReview:        boolean;
}

interface CategoryOption { slug: string; displayName: string; }

interface Props {
  open: boolean;
  filters: TicketFilters;
  title?: string;
  onClose: () => void;
  onReclassified?: () => void;
}

function buildQS(f: TicketFilters): string {
  const p = new URLSearchParams();
  if (f.siteCode)    p.set('siteCode',    f.siteCode);
  if (f.category)    p.set('category',    f.category);
  if (f.description) p.set('description', f.description);
  if (f.dateFrom)    p.set('dateFrom',    f.dateFrom);
  if (f.dateTo)      p.set('dateTo',      f.dateTo);
  if (f.priority)    p.set('priority',    f.priority);
  if (f.status)      p.set('status',      f.status);
  if (f.provider)    p.set('provider',    f.provider);
  p.set('limit', '200');
  return p.toString();
}

function fmtHours(mins: number | null) {
  if (mins == null) return '—';
  return `${(mins / 60).toFixed(1)} h`;
}

export default function TicketDrawer({ open, filters, title, onClose, onReclassified }: Props) {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [cats, setCats] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingByNorm, setPendingByNorm] = useState<Record<string, string>>({});

  const refetch = async () => {
    setLoading(true); setError(null);
    try {
      const [tRes, cRes] = await Promise.all([
        fetch(`/api/helpdesk/tickets?${buildQS(filters)}`).then(r => r.json()),
        fetch('/api/maintenance/categories-list').then(r => r.json()),
      ]);
      setRows(tRes?.data || []);
      setCats(cRes?.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setPendingByNorm({});
      refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(filters)]);

  const stageChange = (norm: string, slug: string, originalSlug: string | null) => {
    setPendingByNorm(prev => {
      const next = { ...prev };
      if (slug === (originalSlug || 'other')) {
        delete next[norm];
      } else {
        next[norm] = slug;
      }
      return next;
    });
  };

  const saveAll = async () => {
    const entries = Object.entries(pendingByNorm);
    if (entries.length === 0) return;
    setSaving(true); setError(null);
    try {
      for (const [norm, slug] of entries) {
        const res = await fetch('/api/maintenance/reclassify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description_norm: norm, category_slug: slug }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error || `Reclassify failed for "${norm}"`);
        }
      }
      setPendingByNorm({});
      await refetch();
      onReclassified?.();
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    const count = Object.keys(pendingByNorm).length;
    if (count > 0) {
      const ok = window.confirm(
        `You have ${count} unsaved category change${count === 1 ? '' : 's'}. Discard them?`,
      );
      if (!ok) return;
    }
    onClose();
  };

  if (!open) return null;

  const pendingCount = Object.keys(pendingByNorm).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-4xl overflow-y-auto bg-white shadow-xl pb-16">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-2">
          <h2 className="text-sm font-semibold">{title || 'Tickets'}</h2>
          <button onClick={handleClose} className="text-gray-600 hover:text-gray-900">✕</button>
        </div>

        {loading && <div className="p-4 text-sm text-gray-600">Loading…</div>}
        {error && <div className="p-4 text-sm text-red-700">{error}</div>}

        {!loading && !error && (
          <table className="w-full text-xs">
            <thead className="sticky top-9 z-10 bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2 text-right">Res Time</th>
                <th className="px-3 py-2">Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const norm = r.descriptionNorm || normalizeDescription(r.subject);
                const staged = pendingByNorm[norm];
                const effectiveSlug = staged ?? r.categorySlug ?? 'other';
                const isModified = staged !== undefined;
                return (
                  <tr key={r.ticketId} className={`border-t hover:bg-gray-50 ${isModified ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{r.ticketId}</td>
                    <td className="px-3 py-2">{r.siteCode}</td>
                    <td className="px-3 py-2">
                      {r.subject}
                      {r.needsReview && (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1 text-amber-800">needs review</span>
                      )}
                      {isModified && (
                        <span className="ml-2 inline-block rounded bg-blue-100 px-1 text-blue-800">modified</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2">{r.priority || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{fmtHours(r.resolutionMinutes)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={effectiveSlug}
                        onChange={e => stageChange(norm, e.target.value, r.categorySlug)}
                        className={`rounded border px-1 py-0.5 text-xs ${isModified ? 'border-blue-400 bg-white' : ''}`}
                      >
                        {cats.map(c => (
                          <option key={c.slug} value={c.slug}>{c.displayName}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No tickets match.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {pendingCount > 0 && (
          <div className="sticky bottom-0 z-10 flex items-center justify-between border-t bg-white px-4 py-2 shadow-[0_-4px_6px_-2px_rgba(0,0,0,0.05)]">
            <span className="text-xs text-gray-700">
              <strong>{pendingCount}</strong> change{pendingCount === 1 ? '' : 's'} ready to save
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingByNorm({})}
                disabled={saving}
                className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={saveAll}
                disabled={saving}
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : `Save ${pendingCount} change${pendingCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/helpdesk/TicketDrawer.tsx
git commit -m "feat: add TicketDrawer with shared reclassify via description_norm"
```

---

## Task 11: Helpdesk dashboard page

**Files:**
- Create: `app/dashboard/helpdesk/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/dashboard/helpdesk/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import HelpdeskKPICards from '@/components/helpdesk/HelpdeskKPICards';
import TopRecurringPanel from '@/components/helpdesk/TopRecurringPanel';
import SitesPanel from '@/components/helpdesk/SitesPanel';
import ContractorsPanel from '@/components/helpdesk/ContractorsPanel';
import OpenTicketsPanel from '@/components/helpdesk/OpenTicketsPanel';
import TicketDrawer, { TicketFilters } from '@/components/helpdesk/TicketDrawer';

interface HelpdeskFilters {
  dateFrom: string;
  dateTo:   string;
  priority: string;
  status:   string;
  category: string;
}

function defaultFilters(): HelpdeskFilters {
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  return {
    dateFrom: yearStart,
    dateTo:   today.toISOString().split('T')[0],
    priority: '',
    status:   '',
    category: '',
  };
}

function HeadsetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6 flex-shrink-0">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1v-7h3v5zM3 19a2 2 0 0 0 2 2h1v-7H3v5z" />
    </svg>
  );
}

export default function HelpdeskPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<HelpdeskFilters>(defaultFilters());
  const [kpis, setKpis]   = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<{ slug: string; displayName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ filters: TicketFilters; title?: string } | null>(null);

  const buildQS = (f: HelpdeskFilters) => {
    const p = new URLSearchParams();
    if (f.dateFrom) p.set('dateFrom', f.dateFrom);
    if (f.dateTo)   p.set('dateTo',   f.dateTo);
    if (f.priority) p.set('priority', f.priority);
    if (f.status)   p.set('status',   f.status);
    if (f.category) p.set('category', f.category);
    return p.toString();
  };

  const fetchAll = useCallback(async (f: HelpdeskFilters) => {
    setLoading(true);
    try {
      const qs = buildQS(f);
      const [kpisRes, trendRes] = await Promise.all([
        fetch(`/api/helpdesk/kpis?${qs}`).then(r => r.json()),
        fetch(`/api/helpdesk/trend?${qs}&granularity=monthly`).then(r => r.json()),
      ]);
      setKpis(kpisRes?.data || null);
      setTrend(trendRes?.data || []);
    } catch (e) {
      console.error('Helpdesk fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(filters); }, [filters, fetchAll]);

  useEffect(() => {
    fetch('/api/maintenance/categories-list')
      .then(r => r.json())
      .then(d => setAllCategories(d.data || []))
      .catch(() => {});
  }, []);

  const hasData = (kpis?.openCount ?? 0) > 0 || trend.length > 0;

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <HeadsetIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>R&amp;M Helpdesk</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#93c5fd' }}>
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => fetchAll(filters)}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition">
              Refresh
            </button>
            <button onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); router.push('/login'); }}
                    className="text-xs text-white/60 hover:text-white px-2 py-1.5 rounded-md transition">
              Sign out
            </button>
          </div>
        </div>

        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <Link href="/dashboard/maintenance"         className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Helpdesk</span>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <div className="card flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
            <input type="date" value={filters.dateFrom}
                   onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                   className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
            <input type="date" value={filters.dateTo}
                   onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                   className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Priority</label>
            <select value={filters.priority}
                    onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}
                    className="text-sm border rounded px-2 py-1">
              <option value="">All</option>
              <option value="Urgent">Urgent</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Status</label>
            <select value={filters.status}
                    onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                    className="text-sm border rounded px-2 py-1">
              <option value="">All</option>
              <option value="Open">Open</option>
              <option value="Pending">Pending</option>
              <option value="Resolved">Resolved</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
            <select value={filters.category}
                    onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
                    className="text-sm border rounded px-2 py-1">
              <option value="">All categories</option>
              {allCategories.map(c => <option key={c.slug} value={c.slug}>{c.displayName}</option>)}
            </select>
          </div>
        </div>

        {loading && (
          <div className="card mt-5 text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading helpdesk data…</p>
          </div>
        )}

        {!loading && !hasData && (
          <div className="card mt-5 text-center py-12">
            <p className="text-sm text-gray-500 mb-3">No helpdesk data for the selected filters.</p>
            <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
              Go to Data Management to upload →
            </Link>
          </div>
        )}

        {!loading && hasData && (
          <>
            <div className="mt-5">
              <HelpdeskKPICards kpis={kpis} />
            </div>

            <div className="card mt-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Ticket Volume Trend (Monthly)</h2>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trend} margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#f3f4f6" />
                  <XAxis dataKey="period" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} />
                  <Tooltip formatter={(v: number) => [`${v} tickets`, 'Count']} />
                  <Line type="monotone" dataKey="count" stroke="#1e3a5f" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
              <TopRecurringPanel
                filters={{
                  dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                  priority: filters.priority || undefined, category: filters.category || undefined,
                }}
                onPickDescription={(desc, label) => setDrawer({
                  filters: { description: desc, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                             priority: filters.priority || undefined, status: filters.status || undefined },
                  title: `Tickets: ${label}`,
                })}
              />
              <SitesPanel
                filters={{
                  dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                  priority: filters.priority || undefined, category: filters.category || undefined,
                }}
                onPickSite={(siteCode, siteName) => setDrawer({
                  filters: { siteCode, dateFrom: filters.dateFrom, dateTo: filters.dateTo,
                             priority: filters.priority || undefined, status: filters.status || undefined,
                             category: filters.category || undefined },
                  title: `Tickets: ${siteName}`,
                })}
              />
            </div>

            <div className="mt-5">
              <ContractorsPanel
                filters={{ dateFrom: filters.dateFrom, dateTo: filters.dateTo }}
                onPickContractor={(provider) => setDrawer({
                  filters: { provider, dateFrom: filters.dateFrom, dateTo: filters.dateTo },
                  title: `Tickets: ${provider}`,
                })}
              />
            </div>

            <div className="mt-5">
              <OpenTicketsPanel
                filters={{ priority: filters.priority || undefined, category: filters.category || undefined }}
                onPickTicket={(ticketId) => setDrawer({
                  filters: { ticketId },
                  title: `Ticket #${ticketId}`,
                })}
              />
            </div>

            <TicketDrawer
              open={drawer != null}
              filters={drawer?.filters || {}}
              title={drawer?.title}
              onClose={() => setDrawer(null)}
              onReclassified={() => fetchAll(filters)}
            />
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and smoke test**

```bash
npx tsc --noEmit
npm run dev
# Wait for ✓ Ready
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard/helpdesk
# Expected: 200 or 307 (redirect to login)
```

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/helpdesk/page.tsx
git commit -m "feat: add /dashboard/helpdesk page composing all panels"
```

---

## Task 12: Add Helpdesk tab link to other pages

**Files:**
- Modify: `app/dashboard/page.tsx` (Sales)
- Modify: `app/dashboard/maintenance/page.tsx`
- Modify: `app/dashboard/maintenance/rules/page.tsx`

- [ ] **Step 1: Add link on Sales Dashboard**

Open `app/dashboard/page.tsx`. Find the existing tab bar that ends with the Maintenance link:

```tsx
          <Link
            href="/dashboard/maintenance"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
          >
            Maintenance
          </Link>
        </div>
      </header>
```

Replace with:

```tsx
          <Link
            href="/dashboard/maintenance"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
          >
            Maintenance
          </Link>
          <Link
            href="/dashboard/helpdesk"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
          >
            Helpdesk
          </Link>
        </div>
      </header>
```

- [ ] **Step 2: Add link on Maintenance page**

Open `app/dashboard/maintenance/page.tsx`. Find the tab strip:

```tsx
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <span                   className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Maintenance</span>
          <Link href="/dashboard/maintenance/rules" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
        </div>
```

Replace with:

```tsx
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <span                   className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Maintenance</span>
          <Link href="/dashboard/maintenance/rules" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/helpdesk" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
        </div>
```

- [ ] **Step 3: Add link on Rules page**

Open `app/dashboard/maintenance/rules/page.tsx`. Find:

```tsx
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"             className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"             className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <Link href="/dashboard/maintenance" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <span                               className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Rules</span>
        </div>
```

Replace with:

```tsx
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"             className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"             className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <Link href="/dashboard/maintenance" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <span                               className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Rules</span>
          <Link href="/dashboard/helpdesk"    className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
        </div>
```

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add app/dashboard/page.tsx app/dashboard/maintenance/page.tsx app/dashboard/maintenance/rules/page.tsx
git commit -m "feat: add Helpdesk tab link to Sales, Maintenance, and Rules pages"
```

---

## Task 13: End-to-end smoke test

**Files:**
- None (manual verification)

- [ ] **Step 1: Open the PR**

```bash
git push -u origin feat/helpdesk-upload
gh pr create --title "feat: R&M Helpdesk upload + dashboard" \
  --body "Implements docs/superpowers/specs/2026-05-14-helpdesk-upload-design.md - new rm_helpdesk_tickets table, shared categorization, /dashboard/helpdesk page with KPIs, recurring, sites, contractors, open tickets, volume trend."
```

Merge via GitHub UI. Vercel deploys automatically.

- [ ] **Step 2: Apply migration to production**

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/rm_helpdesk_tickets.sql
```

Verify:

```bash
psql "$DATABASE_URL" -c "\d rm_helpdesk_tickets"
```

- [ ] **Step 3: Upload the helpdesk sheet**

In the live app, open Data Management → Data Type → "R&M Helpdesk" → drop `Retail Dashboard Data .xlsx`. Validate. Confirm:
- Validation shows passes + maybe small skip count.
- Click Upload Helpdesk Data. Chunked upload runs (1 chunk for ~1394 rows).
- CategorizationProgress runs for any new descriptions not already cached.

- [ ] **Step 4: Verify the dashboard**

Click the **Helpdesk** tab. Confirm:
- KPIs populate (open count, SLA %, avg resolution, top equipment).
- Volume trend renders a line chart.
- Top Recurring Problems lists subjects with categories.
- Sites by Ticket Count lists sites with totals.
- Service Providers lists contractors.
- Open / Pending Tickets shows oldest-first list.

- [ ] **Step 5: Verify drill-down + cross-domain reclassify**

Click any row in the Top Recurring panel → TicketDrawer slides in. Stage a category change on a ticket, click Save. Open the Maintenance page → InvoiceDrawer for an invoice that shares the same `description_norm` → confirm the category reflects your helpdesk reclassify.

- [ ] **Step 6: Verify rule propagation**

Open the Rules page, add a rule like `pattern=canopy → canopy_signage`. Return to the Helpdesk page; the recurring panel should now show "canopy" tickets with the new category.

- [ ] **Step 7: Report results**

Note any anomalies and stop. Otherwise the feature is shipped.
