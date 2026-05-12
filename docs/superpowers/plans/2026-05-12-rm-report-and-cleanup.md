# R&M Report + Dashboard Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unused features from the Redan Sales Dashboard, then add a Repairs & Maintenance report at `/dashboard/maintenance` with its own Excel ingest, KPIs, charts, site-ranking table, filters, and PDF export. Headline metric: R&M cost per litre.

**Architecture:** Next.js 14 app router + Postgres via `lib/db.ts`. Phase 1 is purely subtractive (delete unused files and code paths). Phase 2 adds a new table `maintenance_costs` (additive migration), a `dataType` param to the existing `/api/validate` and `/api/ingest` so the current `UploadPanel` handles both Sales and R&M, plus a new page at `/dashboard/maintenance` modeled on the existing Overview tab.

**Tech Stack:** Next.js 14, React 18, TypeScript, PostgreSQL (Neon), `pg`, `xlsx`, Tailwind, Recharts, `html2pdf.js`.

**Note on tests:** The project has no automated test framework (no `jest`/`vitest` in `package.json`). Verification steps use `npm run build` (TypeScript + Next compile), targeted `curl` smoke tests against `npm run dev`, and `psql` SQL probes. Do not introduce a test framework unless explicitly asked.

**Spec reference:** `docs/superpowers/specs/2026-05-12-rm-report-and-cleanup-design.md`

---

## Phase 1 — Cleanup

### Task 1.1: Pre-flight grep — verify nothing references the routes we're about to delete

**Files:** none modified — investigation only.

- [ ] **Step 1: Grep for callers of each route we plan to delete**

Run:
```bash
cd "/Users/allen/Documents/PROJECTS/Sales dashboard"
for route in site-activity reconciliation db-stats db-viewer comments; do
  echo "=== /api/$route ==="
  grep -rn "/api/$route" --include="*.tsx" --include="*.ts" app components | grep -v "/route.ts"
done
```

Expected: callers only inside files we are also removing in Phase 1 (`SiteActivityPanel.tsx`, `ReconciliationPanel.tsx`, `DataManagementTab.tsx` lines that call `/api/db-stats`, `DatabaseViewerTab.tsx`, `ReportGenerator.tsx` comments calls).

- [ ] **Step 2: Grep for imports of orphan components**

Run:
```bash
for comp in TerritoryChart TerritoryAnalysisChart SiteActivityPanel DatabaseViewerTab ReconciliationPanel; do
  echo "=== $comp ==="
  grep -rn "$comp" --include="*.tsx" --include="*.ts" app components | grep -v "components/.*$comp\.tsx"
done
```

Expected: only the imports in `app/dashboard/page.tsx` (for `DatabaseViewerTab` and `ReconciliationPanel`). The other three should have zero hits — they're truly orphaned.

If any unexpected references appear, **stop and report**. Otherwise continue.

- [ ] **Step 3: Commit a marker (no changes yet, but record pre-state)**

No commit; this task is read-only. Proceed to Task 1.2.

---

### Task 1.2: Delete Tier 1 orphan files and clean stale imports

**Files:**
- Delete: `components/charts/TerritoryChart.tsx`
- Delete: `components/charts/TerritoryAnalysisChart.tsx`
- Delete: `components/ui/SiteActivityPanel.tsx`
- Delete: `app/api/site-activity/route.ts`
- Modify: `app/dashboard/page.tsx` (remove dead imports on lines 11 and 14)

- [ ] **Step 1: Delete the 4 orphan files**

Run:
```bash
cd "/Users/allen/Documents/PROJECTS/Sales dashboard"
rm components/charts/TerritoryChart.tsx
rm components/charts/TerritoryAnalysisChart.tsx
rm components/ui/SiteActivityPanel.tsx
rm -rf app/api/site-activity
```

- [ ] **Step 2: Remove the two stale imports in `app/dashboard/page.tsx`**

Open `app/dashboard/page.tsx`. Lines 11 and 14 (in the import block at top of file):

Remove:
```tsx
import UploadPanel from '@/components/ui/UploadPanel';
```
Remove:
```tsx
import UploadAuditTrail from '@/components/ui/UploadAuditTrail';
```

(Both components are still imported and used inside `components/ui/DataManagementTab.tsx`. We're only removing the unused imports from `page.tsx`.)

- [ ] **Step 3: Verify build passes**

Run:
```bash
npm run build
```

Expected: build succeeds with no errors. If the build complains about an unused symbol or missing import, recheck the file.

- [ ] **Step 4: Commit**

Run:
```bash
git add -A
git commit -m "Remove orphaned chart/panel files and stale imports

- TerritoryChart, TerritoryAnalysisChart: never imported anywhere
- SiteActivityPanel + /api/site-activity: only caller was the orphaned panel
- UploadPanel/UploadAuditTrail: dead imports in dashboard page (still used inside DataManagementTab)"
```

---

### Task 1.3: Remove the Reconciliation tab

**Files:**
- Delete: `components/ui/ReconciliationPanel.tsx`
- Delete: `app/api/reconciliation/route.ts`
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Delete files**

Run:
```bash
cd "/Users/allen/Documents/PROJECTS/Sales dashboard"
rm components/ui/ReconciliationPanel.tsx
rm -rf app/api/reconciliation
```

- [ ] **Step 2: Remove the `ReconciliationPanel` import from `app/dashboard/page.tsx`**

Remove line:
```tsx
import ReconciliationPanel from '@/components/ui/ReconciliationPanel';
```

- [ ] **Step 3: Remove `'reconcile'` from the `Tab` type and `ALL_TABS`**

Find:
```tsx
type Tab = 'overview' | 'sites' | 'reconcile' | 'reports' | 'data' | 'dbviewer';
const ALL_TABS: Tab[] = ['overview', 'sites', 'reconcile', 'reports', 'data', 'dbviewer'];
```

Replace with:
```tsx
type Tab = 'overview' | 'sites' | 'reports' | 'data' | 'dbviewer';
const ALL_TABS: Tab[] = ['overview', 'sites', 'reports', 'data', 'dbviewer'];
```

(We'll remove `'reports'` and `'dbviewer'` in later tasks.)

- [ ] **Step 4: Remove the `reconcile` entries from `TAB_ICONS` and `TAB_LABELS`**

In the `TAB_ICONS` object, remove the entire `reconcile: (...)` SVG block.

In the `TAB_LABELS` object, remove the line:
```tsx
reconcile: 'Reconciliation',
```

- [ ] **Step 5: Remove the amber "!" badge logic from the tab strip**

In the tab strip JSX, find and remove:
```tsx
{tab === 'reconcile' && (
  <span className="ml-1 bg-amber-400 text-amber-900 text-[9px] font-bold
                   px-1.5 py-0.5 rounded-full leading-none">
    !
  </span>
)}
```

- [ ] **Step 6: Remove the Reconciliation render block**

Find and delete the entire block:
```tsx
{/* RECONCILIATION */}
{!loading && activeTab === 'reconcile' && (
  <ReconciliationPanel filters={filters} />
)}
```

- [ ] **Step 7: Build verify**

Run:
```bash
npm run build
```

Expected: success.

- [ ] **Step 8: Commit**

Run:
```bash
git add -A
git commit -m "Remove Reconciliation tab and /api/reconciliation"
```

---

### Task 1.4: Remove the Database Viewer tab

**Files:**
- Delete: `components/ui/DatabaseViewerTab.tsx`
- Delete: `app/api/db-viewer/` (entire folder)
- Delete: `app/api/db-stats/route.ts`
- Modify: `app/dashboard/page.tsx`
- Modify: `components/ui/DataManagementTab.tsx` (remove `/api/db-stats` call)

- [ ] **Step 1: Confirm db-viewer subroutes**

Run:
```bash
ls "/Users/allen/Documents/PROJECTS/Sales dashboard/app/api/db-viewer"
```

This is the entire folder we'll remove.

- [ ] **Step 2: Delete files**

Run:
```bash
cd "/Users/allen/Documents/PROJECTS/Sales dashboard"
rm components/ui/DatabaseViewerTab.tsx
rm -rf app/api/db-viewer
rm -rf app/api/db-stats
```

- [ ] **Step 3: Remove the `DatabaseViewerTab` import from `app/dashboard/page.tsx`**

Remove line:
```tsx
import DatabaseViewerTab from '@/components/ui/DatabaseViewerTab';
```

- [ ] **Step 4: Remove `'dbviewer'` from the `Tab` type and `ALL_TABS`**

Find:
```tsx
type Tab = 'overview' | 'sites' | 'reports' | 'data' | 'dbviewer';
const ALL_TABS: Tab[] = ['overview', 'sites', 'reports', 'data', 'dbviewer'];
```

Replace with:
```tsx
type Tab = 'overview' | 'sites' | 'reports' | 'data';
const ALL_TABS: Tab[] = ['overview', 'sites', 'reports', 'data'];
```

- [ ] **Step 5: Remove the `dbviewer` entry from `TAB_LABELS`**

Remove:
```tsx
dbviewer:  'Database Viewer',
```

(There is no `dbviewer` entry in `TAB_ICONS` to remove — the current code reuses the `data` icon. Confirm by reading the current `TAB_ICONS` block.)

- [ ] **Step 6: Remove the Database Viewer render block**

Find and delete:
```tsx
{/* DATABASE VIEWER */}
{activeTab === 'dbviewer' && (
  <DatabaseViewerTab />
)}
```

- [ ] **Step 7: Remove the `/api/db-stats` call in `DataManagementTab.tsx`**

Open `components/ui/DataManagementTab.tsx`. Around line 228 there is a `Promise.all` that includes:
```tsx
fetch('/api/db-stats'),
```

Remove that entry from the `Promise.all` array. Then remove any state and rendering that consumed its result. Read the surrounding code first: find the corresponding destructure (e.g. `const [..., statsRes] = await Promise.all([...])`) and remove the variable, its state setter, and any JSX that displays the stats. If you cannot cleanly disentangle without breaking adjacent functionality, **stop and report**.

- [ ] **Step 8: Build verify**

Run:
```bash
npm run build
```

Expected: success.

- [ ] **Step 9: Commit**

Run:
```bash
git add -A
git commit -m "Remove Database Viewer tab, /api/db-viewer, /api/db-stats"
```

---

### Task 1.5: Remove the Budget Matrix editor from Data Management

**Files:**
- Modify: `components/ui/DataManagementTab.tsx`

The Budget Matrix UI sits inside `DataManagementTab.tsx` and calls `/api/budget-matrix`. Keep the route file (`app/api/budget-matrix/route.ts`) for now — we only remove the UI surface. If after this task the route has zero callers, delete it in Step 5.

- [ ] **Step 1: Read the file and identify the Budget Matrix section**

Run:
```bash
grep -n "budget-matrix\|Budget Matrix\|budget matrix\|BudgetMatrix" components/ui/DataManagementTab.tsx
```

Find:
- All `fetch('/api/budget-matrix' …)` calls (lines ~229 and ~473 in the file as of writing)
- The JSX section that renders the matrix (look for headings like "Budget Matrix" or a `<table>` driven by the matrix data)
- Any `useState`s, `useEffect`s, or handlers that only support the matrix

- [ ] **Step 2: Remove the Budget Matrix section in JSX, handlers, state, and effects**

Delete the relevant `useState`/`useEffect` blocks, the `fetch('/api/budget-matrix' …)` calls, and the JSX section. Read carefully — do not remove shared upload/audit state.

- [ ] **Step 3: Confirm no remaining callers of `/api/budget-matrix`**

Run:
```bash
grep -rn "/api/budget-matrix" --include="*.tsx" --include="*.ts" app components | grep -v "/route.ts"
```

- [ ] **Step 4: If no callers remain, delete the route file**

If Step 3 returned no results:

```bash
rm -rf app/api/budget-matrix
```

If callers remain, **stop and report**.

- [ ] **Step 5: Build verify**

Run:
```bash
npm run build
```

Expected: success.

- [ ] **Step 6: Commit**

Run:
```bash
git add -A
git commit -m "Remove Budget Matrix editor from Data Management tab"
```

---

### Task 1.6: Remove the Report comments feature

**Files:**
- Delete: `app/api/comments/route.ts`
- Modify: `components/ui/ReportGenerator.tsx`

- [ ] **Step 1: Read `components/ui/ReportGenerator.tsx` and identify the comments UI**

Run:
```bash
grep -n "comments\|Comment\|comment" components/ui/ReportGenerator.tsx
```

Find:
- The three `fetch('/api/comments' …)` calls (around lines 43, 132, 148)
- The state hooks that hold comments (e.g. `comments`, `newComment`, `setComments`)
- The JSX that renders the comment thread (input box, list, delete buttons)
- The `useEffect` that loads comments when a report is selected

- [ ] **Step 2: Remove all comment-related code**

Delete the three fetch calls, the supporting state/effects, the helper handlers, and the comment-thread JSX block. Leave the rest of the component (report listing, generate button, PDF export) intact.

- [ ] **Step 3: Delete the route**

Run:
```bash
rm -rf app/api/comments
```

- [ ] **Step 4: Build verify**

Run:
```bash
npm run build
```

- [ ] **Step 5: Commit**

Run:
```bash
git add -A
git commit -m "Remove report comments thread and /api/comments"
```

---

### Task 1.7: Convert Reports tab into an inline panel on Overview

**Files:**
- Modify: `app/dashboard/page.tsx`

Replace the `reports` tab with a "Generate Report" button in the header. Clicking it toggles `<ReportGenerator>` rendered at the top of the Overview tab.

- [ ] **Step 1: Remove `'reports'` from `Tab`, `ALL_TABS`, and `TAB_LABELS`**

Update:
```tsx
type Tab = 'overview' | 'sites' | 'data';
const ALL_TABS: Tab[] = ['overview', 'sites', 'data'];
```

Remove `reports: 'Reports'` from `TAB_LABELS`. Remove the `reports` entry from `TAB_ICONS`.

- [ ] **Step 2: Remove the Reports render block**

Find and delete:
```tsx
{/* REPORTS */}
{activeTab === 'reports' && (
  <div className="mt-5">
    <ReportGenerator filters={filters} />
  </div>
)}
```

- [ ] **Step 3: Add `reportOpen` state**

Inside `DashboardPage()`, near the other `useState` hooks (after `activeTab`):

```tsx
const [reportOpen, setReportOpen] = useState(false);
```

- [ ] **Step 4: Add a "Generate Report" button to the header**

In the JSX, locate the cluster containing the Refresh button (look for `onClick={() => fetchAll(filters)}`). Insert a new button immediately before Refresh:

```tsx
<button
  onClick={() => { setActiveTab('overview'); setReportOpen(v => !v); }}
  className="flex items-center gap-1.5 text-xs font-medium text-white
             bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition"
>
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/>
  </svg>
  {reportOpen ? 'Hide Report' : 'Generate Report'}
</button>
```

- [ ] **Step 5: Render `<ReportGenerator>` at the top of the Overview tab when `reportOpen` is true**

Inside the Overview block (`{!loading && activeTab === 'overview' && (...)}`), make `<ReportGenerator>` the first child:

```tsx
{!loading && activeTab === 'overview' && (
  <>
    {reportOpen && (
      <Section title="Report Generator" sub="Generate a PDF of the current view">
        <ReportGenerator filters={filters} />
      </Section>
    )}
    <KPICards kpis={kpis} />
    {/* ... existing Overview content ... */}
  </>
)}
```

- [ ] **Step 6: Build verify**

Run:
```bash
npm run build
```

- [ ] **Step 7: Smoke test in browser**

Run `npm run dev`. In the browser:
1. Confirm only three tabs remain: Overview, Sites, Data Management.
2. Click "Generate Report" in the header — `ReportGenerator` appears at the top of Overview.
3. Click "Hide Report" — it disappears.
4. Generate a report and confirm the PDF still downloads correctly (matches behavior from commit `cbdaaa3`).

- [ ] **Step 8: Commit**

Run:
```bash
git add -A
git commit -m "Move Reports from a tab to an inline panel on Overview

Removes the Reports tab. Adds a Generate Report button in the header
that toggles ReportGenerator at the top of the Overview tab."
```

---

### Task 1.8: Phase 1 final verification

- [ ] **Step 1: Build + lint clean**

Run:
```bash
npm run build
```

Expected: success, zero errors.

- [ ] **Step 2: Grep for leftover references to deleted routes**

Run:
```bash
for r in site-activity reconciliation db-stats db-viewer comments budget-matrix; do
  echo "=== /api/$r ==="
  grep -rn "/api/$r" --include="*.tsx" --include="*.ts" app components 2>/dev/null
done
```

Expected: empty for every route. If anything remains, fix before continuing.

- [ ] **Step 3: Manual end-to-end smoke test**

Run `npm run dev`. Walk through:
1. Login → Overview tab loads with KPIs, Territory Scorecard, Daily Trend, Yearly Volume Budget, Top 20 Sites.
2. Sites tab loads with Unmatched Rows panel and full Site Breakdown.
3. Data Management tab loads — upload + audit trail visible, **no** Budget Matrix section.
4. Generate Report toggles the inline report panel.
5. Click a site in Top Sites → Site Detail Modal still opens.

Phase 1 is complete when all five pass.

---

## Phase 2 — R&M Report

### Task 2.1: Database migration — `maintenance_costs` table + extend `unmatched_status_rows`

**Files:**
- Create: `sql/migrations/maintenance_costs.sql`

- [ ] **Step 1: Create the migration**

Write to `sql/migrations/maintenance_costs.sql`:

```sql
-- ============================================================
-- R&M (Repairs & Maintenance) costs per site/category.
-- One row per maintenance event. Cost/Litre is computed at
-- query time by joining against the sales table on site+month.
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance_costs (
  id              BIGSERIAL PRIMARY KEY,
  site_code       VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  service_date    DATE NOT NULL,
  cost            NUMERIC(14,2) NOT NULL,
  category        VARCHAR(100) NOT NULL,
  upload_log_id   BIGINT REFERENCES upload_log(id) ON DELETE SET NULL,
  source_file     VARCHAR(255),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maint_site_date  ON maintenance_costs (site_code, service_date);
CREATE INDEX IF NOT EXISTS idx_maint_service_date ON maintenance_costs (service_date);
CREATE INDEX IF NOT EXISTS idx_maint_category    ON maintenance_costs (category);

COMMENT ON TABLE maintenance_costs IS
  'Repairs & maintenance costs per site/category. Joined against sales for cost-per-litre metrics.';

-- Extend unmatched_status_rows to support R&M uploads.
-- The existing CHECK on sheet_name is loose (VARCHAR(50) free-text), so no
-- schema change required for the column itself, but document the new value.
COMMENT ON COLUMN unmatched_status_rows.sheet_name IS
  'Source of the unmatched row: STATUS REPORT | PETROTRADE | MARGIN | MAINTENANCE.';
```

- [ ] **Step 2: Apply the migration**

Run:
```bash
psql "$DATABASE_URL" -f sql/migrations/maintenance_costs.sql
```

(`DATABASE_URL` is in `.env.local`. If the migration tooling differs from a direct `psql` invocation in this project, follow whatever convention `sql/migrations/site_margins.sql` uses — read the most recent migration history to confirm.)

- [ ] **Step 3: Verify the table exists**

Run:
```bash
psql "$DATABASE_URL" -c "\d maintenance_costs"
```

Expected: columns `id, site_code, service_date, cost, category, upload_log_id, source_file, created_at`.

- [ ] **Step 4: Commit**

Run:
```bash
git add sql/migrations/maintenance_costs.sql
git commit -m "Add maintenance_costs table for R&M ingest"
```

---

### Task 2.2: Wire `dataType` parameter into `/api/validate`

**Files:**
- Modify: `app/api/validate/route.ts`

The current `validate` route checks for sales-specific sheets (`NAME INDEX`, `STATUS REPORT`, etc.). We add an early branch: when `dataType === 'maintenance'`, validate against R&M-specific rules (one sheet with `Site`, `Date`, `Cost`, `Category` headers).

- [ ] **Step 1: Add the `dataType` extraction at the top of the POST handler**

Open `app/api/validate/route.ts`. Inside `export async function POST(req: NextRequest)`, immediately after the `contentType` check (around line 56), branch on a `dataType` value.

The route accepts both JSON and FormData. Read the existing code to understand which fields are present in each branch, then add:

```tsx
// Determine data type (default 'sales' for backwards compatibility)
let dataType: 'sales' | 'maintenance' = 'sales';
if (contentType.includes('application/json')) {
  const peek = await req.clone().json().catch(() => ({}));
  if (peek?.dataType === 'maintenance') dataType = 'maintenance';
} else {
  const fd = await req.clone().formData().catch(() => null);
  if (fd?.get('dataType') === 'maintenance') dataType = 'maintenance';
}
```

(The `req.clone()` calls are needed because the original `req.json()` / `req.formData()` later consumes the stream. Confirm this works by reading the current usage of `req` further down.)

- [ ] **Step 2: Add a maintenance-only validation branch**

Below the `dataType` detection, before the existing sales validation logic, add:

```tsx
if (dataType === 'maintenance') {
  return await validateMaintenance(req);
}
```

Then add the helper at the bottom of the file, **above** the existing `catch` block of POST — so place it as a separate function below `export async function POST`:

```tsx
const MAINT_REQUIRED_COLS = ['Site', 'Date', 'Cost', 'Category'];

async function validateMaintenance(req: NextRequest): Promise<NextResponse> {
  const contentType = req.headers.get('content-type') || '';

  // Maintenance validation always runs against a parsed single-sheet structure.
  // Accept either FormData with a file, or JSON with a single `rows` array.
  let rows: Record<string, any>[];
  let fileName = 'maintenance.xlsx';

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
    // Take first sheet
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

  // 1. Row presence
  if (rows.length === 0) {
    addCheck('rm_empty', 'MAINTENANCE', 'Sheet has rows', 'error', 'No rows found in file');
    return NextResponse.json({ ok: false, canIngest: false, checks, summary, fileName });
  }
  addCheck('rm_rows', 'MAINTENANCE', 'Row count', 'pass', `${rows.length.toLocaleString()} rows`);

  // 2. Required columns
  const cols = Object.keys(rows[0]);
  const missing = MAINT_REQUIRED_COLS.filter(c => !cols.includes(c));
  if (missing.length > 0) {
    addCheck('rm_cols', 'MAINTENANCE', 'Required columns', 'error',
      `Missing: ${missing.join(', ')}. Expected: ${MAINT_REQUIRED_COLS.join(', ')}. Found: ${cols.join(', ')}`);
  } else {
    addCheck('rm_cols', 'MAINTENANCE', 'Required columns', 'pass', `All ${MAINT_REQUIRED_COLS.length} columns present`);
  }

  // 3. Date parseable / range
  let bad = 0;
  let minD: string | null = null;
  let maxD: string | null = null;
  for (const r of rows) {
    const d = parseDate(r['Date']) || parseDateDayFirst(r['Date']);
    if (!d) { bad++; continue; }
    if (!minD || d < minD) minD = d;
    if (!maxD || d > maxD) maxD = d;
  }
  if (bad > 0) {
    addCheck('rm_date', 'MAINTENANCE', 'Date column parseable',
      bad < rows.length * 0.05 ? 'warning' : 'error',
      `${bad} unparseable date values out of ${rows.length}`);
  } else {
    addCheck('rm_date', 'MAINTENANCE', 'Date column parseable', 'pass', `All ${rows.length} dates valid`);
  }

  // 4. Cost numeric
  let badCost = 0;
  for (const r of rows) {
    const c = safeFloat(r['Cost']);
    if (c === null || isNaN(c)) badCost++;
  }
  if (badCost > 0) {
    addCheck('rm_cost', 'MAINTENANCE', 'Cost column numeric',
      badCost < rows.length * 0.05 ? 'warning' : 'error',
      `${badCost} non-numeric Cost values out of ${rows.length}`);
  } else {
    addCheck('rm_cost', 'MAINTENANCE', 'Cost column numeric', 'pass', `All ${rows.length} costs numeric`);
  }

  // 5. Site coverage vs DB
  try {
    const dbRows = await query<{ site_code: string; budget_name: string }>(
      'SELECT site_code, UPPER(budget_name) AS budget_name FROM sites'
    );
    const nameToCode = new Map(dbRows.map(r => [r.budget_name, r.site_code]));
    const unknownNames = new Set<string>();
    let matched = 0;
    for (const r of rows) {
      const name = safeStr(r['Site'])?.toUpperCase();
      if (!name) continue;
      if (nameToCode.has(name)) matched++;
      else unknownNames.add(name);
    }
    if (unknownNames.size > 0) {
      addCheck('rm_sites', 'MAINTENANCE', 'Sites matched to DB', 'warning',
        `${matched} matched, ${unknownNames.size} unknown (will go to Unmatched Rows): ${Array.from(unknownNames).slice(0, 10).join(', ')}`);
    } else {
      addCheck('rm_sites', 'MAINTENANCE', 'Sites matched to DB', 'pass', `All ${matched} site names recognised`);
    }
  } catch {
    // DB unreachable — skip site check
  }

  const dateRange = minD && maxD ? { from: minD, to: maxD } : null;
  const canIngest = summary.errors === 0;
  return NextResponse.json({ ok: canIngest, canIngest, checks, summary, dateRange, fileName });
}
```

(`safeFloat`, `safeStr`, `parseDate`, `parseDateDayFirst` are already imported at the top of the file.)

- [ ] **Step 3: Build verify**

Run:
```bash
npm run build
```

- [ ] **Step 4: Smoke test the new branch**

Start the dev server (`npm run dev`) and in another terminal:

```bash
curl -X POST http://localhost:3000/api/validate \
  -H "Content-Type: application/json" \
  -d '{"dataType":"maintenance","rows":[{"Site":"ARDBENNIE","Date":"2025-01-15","Cost":420,"Category":"Pumps"}],"fileName":"test.xlsx"}'
```

Expected: JSON response with `ok: true` (assuming "ARDBENNIE" is a known site name; if not, the response will be `canIngest: false` for the unknown site warning).

- [ ] **Step 5: Commit**

Run:
```bash
git add app/api/validate/route.ts
git commit -m "Add dataType=maintenance branch to /api/validate"
```

---

### Task 2.3: Wire `dataType` parameter into `/api/ingest`

**Files:**
- Modify: `app/api/ingest/route.ts`

- [ ] **Step 1: Read the file structure**

Run:
```bash
wc -l app/api/ingest/route.ts
grep -n "^export\|^async function\|^function" app/api/ingest/route.ts
```

Find the POST handler. Note the current "start / chunk / finish" multi-call protocol used by `UploadPanel.tsx` (lines 384, 410, 423 in UploadPanel).

- [ ] **Step 2: Detect `dataType` at the top of POST**

At the start of the POST handler, before the existing flow:

```tsx
const url = new URL(req.url);
const dataTypeParam = url.searchParams.get('dataType') ||
                      (await req.clone().json().catch(() => ({})))?.dataType ||
                      'sales';

if (dataTypeParam === 'maintenance') {
  return await ingestMaintenance(req);
}
```

(Verify by reading the file whether the existing code already reads `req.json()` later and adjust the clone strategy accordingly. If `req` is consumed only once and you can fold the dataType check into the same parse, do that instead.)

- [ ] **Step 3: Add the maintenance ingest function at the bottom of the file**

```tsx
async function ingestMaintenance(req: NextRequest): Promise<NextResponse> {
  const body = await req.json();
  const rows: Record<string, any>[] = Array.isArray(body.rows) ? body.rows : [];
  const fileName: string = body.fileName || 'maintenance.xlsx';
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
  }

  // Create an upload_log entry so audit trail covers R&M too.
  const logResult = await query<{ id: number }>(
    `INSERT INTO upload_log (file_name, status, started_at)
     VALUES ($1, 'in_progress', NOW())
     RETURNING id`,
    [fileName]
  );
  const uploadId = logResult[0].id;

  // Build site name → code map.
  const dbRows = await query<{ site_code: string; budget_name: string }>(
    'SELECT site_code, UPPER(budget_name) AS budget_name FROM sites'
  );
  const nameToCode = new Map(dbRows.map(r => [r.budget_name, r.site_code]));

  const matchedRows: any[][] = [];
  const unmatchedRows: any[][] = [];
  let skippedBadDate = 0;
  let skippedBadCost = 0;

  for (const r of rows) {
    const rawName = safeStr(r['Site']);
    const dateStr = parseDate(r['Date']) || parseDateDayFirst(r['Date']);
    const cost = safeFloat(r['Cost']);
    const category = safeStr(r['Category']) || 'Uncategorized';

    if (!dateStr) { skippedBadDate++; continue; }
    if (cost === null || isNaN(cost)) { skippedBadCost++; continue; }

    const code = rawName ? nameToCode.get(rawName.toUpperCase()) : undefined;
    if (!code) {
      unmatchedRows.push([rawName || '(blank)', dateStr, 'MAINTENANCE', fileName, uploadId]);
      continue;
    }
    matchedRows.push([code, dateStr, cost, category, uploadId, fileName]);
  }

  // Insert matched rows
  if (matchedRows.length > 0) {
    await batchUpsert(
      `INSERT INTO maintenance_costs (site_code, service_date, cost, category, upload_log_id, source_file)
       VALUES __VALUES__`,
      matchedRows
    );
  }

  // Insert unmatched rows
  if (unmatchedRows.length > 0) {
    await batchUpsert(
      `INSERT INTO unmatched_status_rows (raw_site_code, sale_date, sheet_name, source_file, upload_log_id)
       VALUES __VALUES__`,
      unmatchedRows
    );
  }

  // Finalize upload_log
  await query(
    `UPDATE upload_log
     SET status = 'completed',
         completed_at = NOW(),
         rows_processed = $1,
         rows_inserted  = $2
     WHERE id = $3`,
    [rows.length, matchedRows.length, uploadId]
  );

  return NextResponse.json({
    ok: true,
    summary: {
      total: rows.length,
      inserted: matchedRows.length,
      unmatched: unmatchedRows.length,
      skippedBadDate,
      skippedBadCost,
    },
  });
}
```

(Verify column names against the actual `upload_log` schema in `sql/schema.sql` — if the columns differ, adjust the INSERT and UPDATE statements.)

- [ ] **Step 4: Build verify**

Run:
```bash
npm run build
```

- [ ] **Step 5: Smoke test**

```bash
curl -X POST 'http://localhost:3000/api/ingest?dataType=maintenance' \
  -H 'Content-Type: application/json' \
  -d '{"rows":[{"Site":"ARDBENNIE","Date":"2025-01-15","Cost":420.5,"Category":"Pumps"}],"fileName":"smoke.xlsx"}'
```

Expected: JSON like `{"ok":true,"summary":{"total":1,"inserted":1,"unmatched":0,...}}`.

Then:
```bash
psql "$DATABASE_URL" -c "SELECT * FROM maintenance_costs ORDER BY id DESC LIMIT 5;"
```

Expected: row inserted with `category='Pumps'`, `cost=420.50`.

- [ ] **Step 6: Commit**

Run:
```bash
git add app/api/ingest/route.ts
git commit -m "Add dataType=maintenance ingest branch"
```

---

### Task 2.4: Add Data Type dropdown to `UploadPanel`

**Files:**
- Modify: `components/ui/UploadPanel.tsx`

- [ ] **Step 1: Read the file to understand state and submit flow**

Run:
```bash
wc -l components/ui/UploadPanel.tsx
grep -n "useState\|handleUpload\|/api/validate\|/api/ingest" components/ui/UploadPanel.tsx
```

Locate: the file-state, the call to `/api/validate`, the chunked calls to `/api/ingest`, and the JSX form/header area.

- [ ] **Step 2: Add `dataType` state**

Inside the component, near the other `useState` hooks:

```tsx
const [dataType, setDataType] = useState<'sales' | 'maintenance'>('sales');
```

- [ ] **Step 3: Add a Data Type dropdown to the JSX**

Place near the top of the panel, above the file picker:

```tsx
<div className="mb-4">
  <label className="block text-xs font-semibold text-gray-600 mb-1">Data type</label>
  <select
    value={dataType}
    onChange={e => setDataType(e.target.value as 'sales' | 'maintenance')}
    className="text-sm border border-gray-300 rounded px-2 py-1"
  >
    <option value="sales">Sales (Status Report)</option>
    <option value="maintenance">R&amp;M (Repairs &amp; Maintenance)</option>
  </select>
</div>
```

- [ ] **Step 4: Branch the upload flow on `dataType`**

For maintenance, the validate and ingest payloads are simpler (single sheet → array of rows). Add a maintenance branch in the submit handler before the existing sales flow runs.

Identify the handler that calls `/api/validate` (look for `postJSON('/api/validate', …)`). Before that block, add:

```tsx
if (dataType === 'maintenance') {
  // Parse first sheet to rows[]
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]) as Record<string, any>[];

  // Validate
  const validateRes = await postJSON('/api/validate', {
    dataType: 'maintenance',
    rows,
    fileName: file.name,
  });
  if (!validateRes.data?.canIngest) {
    setValidationResult(validateRes.data);
    return;
  }

  // Ingest (single call, not chunked — R&M files are small)
  const ingestRes = await postJSON('/api/ingest?dataType=maintenance', {
    rows,
    fileName: file.name,
  });
  onSuccess?.();
  setUploadSummary(ingestRes.data?.summary);
  return;
}
```

(Confirm `XLSX` is imported at the top of `UploadPanel.tsx`. If not, add `import * as XLSX from 'xlsx';` to the imports.)

(`postJSON` and `setValidationResult` / `setUploadSummary` / `onSuccess` are existing helpers in the file — confirm names by reading the surrounding code; adjust if they're named differently.)

- [ ] **Step 5: Build verify**

Run:
```bash
npm run build
```

- [ ] **Step 6: Manual smoke test**

Run `npm run dev`. Open the Data Management tab. Switch the Data type dropdown to "R&M". Upload a small `.xlsx` with columns `Site, Date, Cost, Category`. Verify:
1. Validation results appear (checks pass).
2. After ingest, `maintenance_costs` has new rows (`psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM maintenance_costs;"`).
3. The upload appears in the audit trail.

- [ ] **Step 7: Commit**

Run:
```bash
git add components/ui/UploadPanel.tsx
git commit -m "Add Data type dropdown to UploadPanel for R&M uploads"
```

---

### Task 2.5: Create `/api/maintenance/categories-list`

**Files:**
- Create: `app/api/maintenance/categories-list/route.ts`

- [ ] **Step 1: Write the route**

```tsx
// app/api/maintenance/categories-list/route.ts
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await query<{ category: string }>(
      `SELECT DISTINCT category
       FROM maintenance_costs
       ORDER BY category ASC`
    );
    return NextResponse.json({ data: rows.map(r => r.category) });
  } catch (err: any) {
    console.error('/api/maintenance/categories-list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build + smoke test**

```bash
npm run build
curl http://localhost:3000/api/maintenance/categories-list
```

Expected: `{"data":["Pumps", …]}` (or `{"data":[]}` if no rows yet).

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/categories-list
git commit -m "Add /api/maintenance/categories-list"
```

---

### Task 2.6: Create `/api/maintenance/kpis`

**Files:**
- Create: `app/api/maintenance/kpis/route.ts`

- [ ] **Step 1: Write the route**

```tsx
// app/api/maintenance/kpis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface MaintFilters {
  dateFrom?: string;
  dateTo?: string;
  territory?: string;
  category?: string;
  siteCode?: string;
}

function buildWhere(f: MaintFilters, paramOffset = 0) {
  const clauses: string[] = [];
  const params: any[] = [];
  let idx = paramOffset + 1;
  if (f.dateFrom)  { clauses.push(`m.service_date >= $${idx++}`); params.push(f.dateFrom); }
  if (f.dateTo)    { clauses.push(`m.service_date <= $${idx++}`); params.push(f.dateTo); }
  if (f.territory) { clauses.push(`t.tm_code = $${idx++}`);        params.push(f.territory.toUpperCase()); }
  if (f.category)  { clauses.push(`m.category = $${idx++}`);       params.push(f.category); }
  if (f.siteCode)  { clauses.push(`m.site_code = $${idx++}`);      params.push(f.siteCode); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params, nextOffset: idx - 1 };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filters: MaintFilters = {
      dateFrom:  sp.get('dateFrom')  || undefined,
      dateTo:    sp.get('dateTo')    || undefined,
      territory: sp.get('territory') || undefined,
      category:  sp.get('category')  || undefined,
      siteCode:  sp.get('siteCode')  || undefined,
    };

    const { where, params, nextOffset } = buildWhere(filters);

    const baseJoins = `
      FROM maintenance_costs m
      JOIN sites si ON m.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
    `;

    // Total cost + site count + top category
    const totals = await query<any>(`
      SELECT
        ROUND(SUM(m.cost)::NUMERIC, 2)               AS total_cost,
        COUNT(DISTINCT m.site_code)                  AS sites_with_activity
      ${baseJoins}
      ${where}
    `, params);

    // Top category by spend (ignores the category filter so KPI isn't circular)
    const topCatWhere = where; // includes territory + date but we strip category below
    const topCatParams = [...params];
    let topCatWhereNoCat = where;
    if (filters.category) {
      // Rebuild the where without the category clause
      const noCat = { ...filters, category: undefined };
      const rebuilt = buildWhere(noCat);
      topCatWhereNoCat = rebuilt.where;
      topCatParams.length = 0;
      topCatParams.push(...rebuilt.params);
    }
    const topCat = await query<any>(`
      SELECT m.category, SUM(m.cost) AS total
      ${baseJoins}
      ${topCatWhereNoCat}
      GROUP BY m.category
      ORDER BY total DESC
      LIMIT 1
    `, topCatParams);

    // Cost per litre: SUM(maint.cost) / SUM(sales.total_volume) over overlapping months,
    // honouring territory/site filters (sales table aliased as s for buildSalesFilters-style joins).
    // We replicate the join here because buildSalesFilters builds for the sales table only.
    const cplClauses: string[] = [];
    const cplParams: any[] = [];
    let ci = 1;
    if (filters.dateFrom)  { cplClauses.push(`s.sale_date >= $${ci++}`); cplParams.push(filters.dateFrom); }
    if (filters.dateTo)    { cplClauses.push(`s.sale_date <= $${ci++}`); cplParams.push(filters.dateTo); }
    if (filters.territory) { cplClauses.push(`t.tm_code = $${ci++}`);    cplParams.push(filters.territory.toUpperCase()); }
    if (filters.siteCode)  { cplClauses.push(`s.site_code = $${ci++}`);  cplParams.push(filters.siteCode); }
    const cplWhere = cplClauses.length ? `WHERE ${cplClauses.join(' AND ')}` : '';

    const volRow = await query<any>(`
      SELECT SUM(s.total_volume) AS volume
      FROM sales s
      JOIN sites si ON s.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      ${cplWhere}
    `, cplParams);

    const totalCost = parseFloat(totals[0]?.total_cost || 0);
    const totalVolume = parseFloat(volRow[0]?.volume || 0);
    const costPerLitre = totalVolume > 0 ? totalCost / totalVolume : null;

    return NextResponse.json({
      data: {
        totalCost,
        costPerLitre,                  // null when no overlapping sales volume
        topCategory: topCat[0]?.category || null,
        topCategoryCost: topCat[0]?.total ? parseFloat(topCat[0].total) : 0,
        sitesWithActivity: parseInt(totals[0]?.sites_with_activity || 0),
      },
    });
  } catch (err: any) {
    console.error('/api/maintenance/kpis error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build + smoke test**

```bash
npm run build
curl 'http://localhost:3000/api/maintenance/kpis?dateFrom=2025-01-01&dateTo=2025-12-31'
```

Expected: JSON with `totalCost`, `costPerLitre`, `topCategory`, `sitesWithActivity`.

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/kpis
git commit -m "Add /api/maintenance/kpis"
```

---

### Task 2.7: Create `/api/maintenance/trend`

**Files:**
- Create: `app/api/maintenance/trend/route.ts`

- [ ] **Step 1: Write the route**

```tsx
// app/api/maintenance/trend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom  = sp.get('dateFrom')  || undefined;
    const dateTo    = sp.get('dateTo')    || undefined;
    const territory = sp.get('territory') || undefined;
    const category  = sp.get('category')  || undefined;
    const siteCode  = sp.get('siteCode')  || undefined;
    const granularity = sp.get('granularity') || 'monthly';

    const clauses: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (dateFrom)  { clauses.push(`m.service_date >= $${idx++}`); params.push(dateFrom); }
    if (dateTo)    { clauses.push(`m.service_date <= $${idx++}`); params.push(dateTo); }
    if (territory) { clauses.push(`t.tm_code = $${idx++}`);        params.push(territory.toUpperCase()); }
    if (category)  { clauses.push(`m.category = $${idx++}`);       params.push(category); }
    if (siteCode)  { clauses.push(`m.site_code = $${idx++}`);      params.push(siteCode); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const bucket = granularity === 'daily' ? 'm.service_date' : `DATE_TRUNC('month', m.service_date)::DATE`;
    const labelFmt = granularity === 'daily'
      ? `TO_CHAR(m.service_date, 'DD Mon')`
      : `TO_CHAR(DATE_TRUNC('month', m.service_date), 'Mon YYYY')`;

    const rows = await query<any>(`
      SELECT
        ${bucket}::TEXT                        AS period,
        ${labelFmt}                            AS label,
        ROUND(SUM(m.cost)::NUMERIC, 2)         AS cost,
        COUNT(*)                               AS events
      FROM maintenance_costs m
      JOIN sites si ON m.site_code = si.site_code
      LEFT JOIN territories t ON si.territory_id = t.id
      ${where}
      GROUP BY ${bucket}, ${labelFmt}
      ORDER BY ${bucket} ASC
    `, params);

    return NextResponse.json({
      granularity,
      data: rows.map((r: any) => ({
        period: String(r.period).slice(0, 10),
        label: r.label,
        cost: parseFloat(r.cost),
        events: parseInt(r.events),
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/trend error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build + smoke test**

```bash
npm run build
curl 'http://localhost:3000/api/maintenance/trend?granularity=monthly&dateFrom=2025-01-01&dateTo=2025-12-31'
```

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/trend
git commit -m "Add /api/maintenance/trend"
```

---

### Task 2.8: Create `/api/maintenance/categories`

**Files:**
- Create: `app/api/maintenance/categories/route.ts`

- [ ] **Step 1: Write the route**

```tsx
// app/api/maintenance/categories/route.ts
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
    // Note: no category filter here — this endpoint produces the breakdown.

    const clauses: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (dateFrom)  { clauses.push(`m.service_date >= $${idx++}`); params.push(dateFrom); }
    if (dateTo)    { clauses.push(`m.service_date <= $${idx++}`); params.push(dateTo); }
    if (territory) { clauses.push(`t.tm_code = $${idx++}`);        params.push(territory.toUpperCase()); }
    if (siteCode)  { clauses.push(`m.site_code = $${idx++}`);      params.push(siteCode); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await query<any>(`
      WITH per_cat AS (
        SELECT m.category, SUM(m.cost) AS total_cost
        FROM maintenance_costs m
        JOIN sites si ON m.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        ${where}
        GROUP BY m.category
      ),
      total AS (SELECT SUM(total_cost) AS sum_all FROM per_cat)
      SELECT
        p.category,
        ROUND(p.total_cost::NUMERIC, 2)              AS total_cost,
        ROUND((p.total_cost / NULLIF(t.sum_all,0) * 100)::NUMERIC, 1) AS pct_of_total
      FROM per_cat p, total t
      ORDER BY p.total_cost DESC
    `, params);

    return NextResponse.json({
      data: rows.map((r: any) => ({
        category: r.category,
        totalCost: parseFloat(r.total_cost),
        pctOfTotal: r.pct_of_total ? parseFloat(r.pct_of_total) : 0,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/categories error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build + smoke test**

```bash
npm run build
curl 'http://localhost:3000/api/maintenance/categories?dateFrom=2025-01-01&dateTo=2025-12-31'
```

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/categories
git commit -m "Add /api/maintenance/categories"
```

---

### Task 2.9: Create `/api/maintenance/sites`

**Files:**
- Create: `app/api/maintenance/sites/route.ts`

- [ ] **Step 1: Write the route**

```tsx
// app/api/maintenance/sites/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const VALID_SORTS = new Set(['cost', 'volume', 'cost_per_litre', 'site']);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom  = sp.get('dateFrom')  || undefined;
    const dateTo    = sp.get('dateTo')    || undefined;
    const territory = sp.get('territory') || undefined;
    const category  = sp.get('category')  || undefined;
    const siteCode  = sp.get('siteCode')  || undefined;
    const limit     = Math.min(Math.max(1, parseInt(sp.get('limit') || '500')), 5000);
    const sortBy    = sp.get('sortBy') || 'cost_per_litre';
    const sortDir   = (sp.get('sortDir') || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    if (!VALID_SORTS.has(sortBy)) {
      return NextResponse.json({ error: 'Invalid sortBy' }, { status: 400 });
    }

    const mc: string[] = [];
    const mp: any[] = [];
    let mi = 1;
    if (dateFrom)  { mc.push(`m.service_date >= $${mi++}`); mp.push(dateFrom); }
    if (dateTo)    { mc.push(`m.service_date <= $${mi++}`); mp.push(dateTo); }
    if (territory) { mc.push(`t.tm_code = $${mi++}`);        mp.push(territory.toUpperCase()); }
    if (category)  { mc.push(`m.category = $${mi++}`);       mp.push(category); }
    if (siteCode)  { mc.push(`m.site_code = $${mi++}`);      mp.push(siteCode); }
    const mWhere = mc.length ? `WHERE ${mc.join(' AND ')}` : '';

    // For sales-volume side we honor the same date/territory/site filters
    // (category does not apply to sales).
    const sc: string[] = [];
    const sp_: any[] = [];
    let si = 1;
    if (dateFrom)  { sc.push(`s.sale_date >= $${si++}`); sp_.push(dateFrom); }
    if (dateTo)    { sc.push(`s.sale_date <= $${si++}`); sp_.push(dateTo); }
    if (territory) { sc.push(`t.tm_code = $${si++}`);    sp_.push(territory.toUpperCase()); }
    if (siteCode)  { sc.push(`s.site_code = $${si++}`);  sp_.push(siteCode); }
    const sWhere = sc.length ? `WHERE ${sc.join(' AND ')}` : '';

    // Combine in a single query using CTEs.
    const params: any[] = [...mp, ...sp_, limit];
    const limitIdx = params.length;

    // Parameter indices for the sales CTE start after the maint params:
    // we have to renumber salesWhere placeholders accordingly. Do it as a string replace.
    const salesWhereRenum = sWhere.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + mp.length}`);

    const orderCol = sortBy === 'cost'           ? 'cost'
                    : sortBy === 'volume'        ? 'volume'
                    : sortBy === 'site'          ? 'site_name'
                    : 'cost_per_litre';

    const rows = await query<any>(`
      WITH maint AS (
        SELECT
          m.site_code,
          si.budget_name                 AS site_name,
          t.tm_code                      AS territory_code,
          ROUND(SUM(m.cost)::NUMERIC, 2) AS cost,
          (SELECT category FROM maintenance_costs m2
            WHERE m2.site_code = m.site_code
            GROUP BY category ORDER BY SUM(cost) DESC LIMIT 1) AS top_category
        FROM maintenance_costs m
        JOIN sites si ON m.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        ${mWhere}
        GROUP BY m.site_code, si.budget_name, t.tm_code
      ),
      vol AS (
        SELECT
          s.site_code,
          SUM(s.total_volume) AS volume
        FROM sales s
        JOIN sites si ON s.site_code = si.site_code
        LEFT JOIN territories t ON si.territory_id = t.id
        ${salesWhereRenum}
        GROUP BY s.site_code
      )
      SELECT
        maint.site_code,
        maint.site_name,
        maint.territory_code,
        maint.cost,
        COALESCE(vol.volume, 0)::NUMERIC AS volume,
        maint.top_category,
        CASE WHEN COALESCE(vol.volume,0) > 0
          THEN ROUND((maint.cost / vol.volume)::NUMERIC, 4)
          ELSE NULL END                   AS cost_per_litre
      FROM maint
      LEFT JOIN vol ON vol.site_code = maint.site_code
      ORDER BY ${orderCol} ${sortDir} NULLS LAST
      LIMIT $${limitIdx}
    `, params);

    return NextResponse.json({
      data: rows.map((r: any) => ({
        siteCode: r.site_code,
        siteName: r.site_name,
        territoryCode: r.territory_code,
        cost: parseFloat(r.cost),
        volume: parseFloat(r.volume),
        topCategory: r.top_category,
        costPerLitre: r.cost_per_litre != null ? parseFloat(r.cost_per_litre) : null,
      })),
    });
  } catch (err: any) {
    console.error('/api/maintenance/sites error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build + smoke test**

```bash
npm run build
curl 'http://localhost:3000/api/maintenance/sites?dateFrom=2025-01-01&dateTo=2025-12-31&sortBy=cost_per_litre&sortDir=desc&limit=10'
```

- [ ] **Step 3: Commit**

```bash
git add app/api/maintenance/sites
git commit -m "Add /api/maintenance/sites with cost-per-litre join"
```

---

### Task 2.10: Create `MaintenanceKPICards` component

**Files:**
- Create: `components/MaintenanceKPICards.tsx`

- [ ] **Step 1: Read the existing `KPICards.tsx` to match its visual style**

```bash
head -80 components/KPICards.tsx
```

Pattern: card grid with label + big value + secondary line. Match the same Tailwind classes.

- [ ] **Step 2: Write the component**

```tsx
// components/MaintenanceKPICards.tsx
'use client';

interface MaintKpis {
  totalCost: number;
  costPerLitre: number | null;
  topCategory: string | null;
  topCategoryCost: number;
  sitesWithActivity: number;
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export default function MaintenanceKPICards({ kpis }: { kpis: MaintKpis | null }) {
  if (!kpis) return null;
  return (
    <div className="flex flex-wrap gap-3">
      <Card
        label="Total R&M Cost"
        value={`$${fmtMoney(kpis.totalCost)}`}
      />
      <Card
        label="Cost per Litre"
        value={kpis.costPerLitre != null ? `$${kpis.costPerLitre.toFixed(4)}` : '—'}
        sub="cost ÷ sales volume in window"
      />
      <Card
        label="Top Category"
        value={kpis.topCategory || '—'}
        sub={kpis.topCategoryCost ? `$${fmtMoney(kpis.topCategoryCost)}` : undefined}
      />
      <Card
        label="Sites with Activity"
        value={kpis.sitesWithActivity.toLocaleString()}
      />
    </div>
  );
}
```

- [ ] **Step 3: Build verify**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add components/MaintenanceKPICards.tsx
git commit -m "Add MaintenanceKPICards component"
```

---

### Task 2.11: Create `CategoryBreakdownChart` component

**Files:**
- Create: `components/charts/CategoryBreakdownChart.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/charts/CategoryBreakdownChart.tsx
'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface CategoryRow {
  category: string;
  totalCost: number;
  pctOfTotal: number;
}

const COLORS = ['#1e3a5f', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe'];

export default function CategoryBreakdownChart({ data }: { data: CategoryRow[] }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400">No category data for the selected filters.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ left: 80, right: 40, top: 8, bottom: 8 }}>
        <XAxis type="number" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} stroke="#9ca3af" fontSize={11} />
        <YAxis type="category" dataKey="category" stroke="#4b5563" fontSize={12} width={120} />
        <Tooltip
          formatter={(v: number) => [`$${v.toLocaleString()}`, 'Cost']}
          labelFormatter={(l) => `Category: ${l}`}
        />
        <Bar dataKey="totalCost" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Build verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add components/charts/CategoryBreakdownChart.tsx
git commit -m "Add CategoryBreakdownChart component"
```

---

### Task 2.12: Create `MaintenanceSiteTable` component

**Files:**
- Create: `components/tables/MaintenanceSiteTable.tsx`

- [ ] **Step 1: Read existing `TopSitesTable.tsx` for styling baseline**

```bash
head -80 components/tables/TopSitesTable.tsx
```

- [ ] **Step 2: Write the component**

```tsx
// components/tables/MaintenanceSiteTable.tsx
'use client';

import { useMemo, useState } from 'react';

export interface MaintSiteRow {
  siteCode: string;
  siteName: string;
  territoryCode: string | null;
  cost: number;
  volume: number;
  topCategory: string | null;
  costPerLitre: number | null;
}

type SortKey = 'site' | 'territory' | 'cost' | 'volume' | 'costPerLitre';

const PAGE_SIZE = 25;

export default function MaintenanceSiteTable({ data }: { data: MaintSiteRow[] }) {
  const [sortBy, setSortBy] = useState<SortKey>('costPerLitre');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a: any, b: any) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      if (typeof a === 'number') return (a - b) * dir;
      return String(a).localeCompare(String(b)) * dir;
    };
    return [...data].sort((a, b) => {
      switch (sortBy) {
        case 'site':         return cmp(a.siteName, b.siteName);
        case 'territory':    return cmp(a.territoryCode, b.territoryCode);
        case 'cost':         return cmp(a.cost, b.cost);
        case 'volume':       return cmp(a.volume, b.volume);
        case 'costPerLitre': return cmp(a.costPerLitre, b.costPerLitre);
      }
    });
  }, [data, sortBy, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const slice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (k: SortKey) => {
    if (k === sortBy) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(k); setSortDir('desc'); }
    setPage(1);
  };

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:bg-gray-50 ${right ? 'text-right' : 'text-left'}`}
    >
      {children}{sortBy === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  if (data.length === 0) {
    return <p className="text-sm text-gray-400">No R&M data for the selected filters.</p>;
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200">
          <tr>
            <Th k="site">Site</Th>
            <Th k="territory">Territory</Th>
            <Th k="volume" right>Volume (L)</Th>
            <Th k="cost" right>R&amp;M Cost</Th>
            <Th k="costPerLitre" right>Cost / Litre</Th>
            <th className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide text-left">Top Category</th>
          </tr>
        </thead>
        <tbody>
          {slice.map(r => (
            <tr key={r.siteCode} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2">{r.siteName}</td>
              <td className="px-3 py-2 text-gray-500">{r.territoryCode || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.volume.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">${r.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.costPerLitre != null ? `$${r.costPerLitre.toFixed(4)}` : '—'}</td>
              <td className="px-3 py-2 text-gray-500">{r.topCategory || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
          <span>Page {page} of {pageCount} — {sorted.length.toLocaleString()} sites</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border rounded disabled:opacity-40">Prev</button>
            <button disabled={page === pageCount} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border rounded disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build verify**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add components/tables/MaintenanceSiteTable.tsx
git commit -m "Add MaintenanceSiteTable with sortable cost/litre column"
```

---

### Task 2.13: Build the `/dashboard/maintenance` page

**Files:**
- Create: `app/dashboard/maintenance/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// app/dashboard/maintenance/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MaintenanceKPICards from '@/components/MaintenanceKPICards';
import CategoryBreakdownChart from '@/components/charts/CategoryBreakdownChart';
import MaintenanceSiteTable, { MaintSiteRow } from '@/components/tables/MaintenanceSiteTable';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface MaintFilters {
  dateFrom: string;
  dateTo: string;
  territory: string;
  category: string;
}

function defaultFilters(): MaintFilters {
  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  return {
    dateFrom: yearStart,
    dateTo: today.toISOString().split('T')[0],
    territory: '',
    category: '',
  };
}

export default function MaintenancePage() {
  const router = useRouter();
  const [filters, setFilters] = useState<MaintFilters>(defaultFilters());
  const [kpis, setKpis]       = useState<any>(null);
  const [trend, setTrend]     = useState<any[]>([]);
  const [cats, setCats]       = useState<any[]>([]);
  const [sites, setSites]     = useState<MaintSiteRow[]>([]);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const buildQS = (f: MaintFilters) => {
    const p = new URLSearchParams();
    if (f.dateFrom)  p.set('dateFrom',  f.dateFrom);
    if (f.dateTo)    p.set('dateTo',    f.dateTo);
    if (f.territory) p.set('territory', f.territory);
    if (f.category)  p.set('category',  f.category);
    return p.toString();
  };

  const fetchAll = useCallback(async (f: MaintFilters) => {
    setLoading(true);
    try {
      const qs = buildQS(f);
      const [kpisRes, trendRes, catsRes, sitesRes] = await Promise.all([
        fetch(`/api/maintenance/kpis?${qs}`).then(r => r.json()),
        fetch(`/api/maintenance/trend?${qs}&granularity=monthly`).then(r => r.json()),
        fetch(`/api/maintenance/categories?${qs}`).then(r => r.json()),
        fetch(`/api/maintenance/sites?${qs}&sortBy=cost_per_litre&sortDir=desc&limit=1000`).then(r => r.json()),
      ]);
      setKpis(kpisRes?.data || null);
      setTrend(trendRes?.data || []);
      setCats(catsRes?.data || []);
      setSites(sitesRes?.data || []);
    } catch (e) {
      console.error('R&M fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(filters); }, [filters, fetchAll]);

  useEffect(() => {
    fetch('/api/maintenance/categories-list').then(r => r.json())
      .then(d => setAllCategories(d.data || []))
      .catch(() => {});
  }, []);

  const hasData = (kpis?.sitesWithActivity ?? 0) > 0;

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      {/* Header — matches Overview */}
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>R&amp;M / Maintenance Report</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchAll(filters)}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-md transition"
            >Refresh</button>
            <button
              onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); router.push('/login'); }}
              className="text-xs text-white/60 hover:text-white px-2 py-1.5"
            >Sign out</button>
          </div>
        </div>
        {/* Tab strip — uses Links so we can navigate cross-route */}
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10">Overview</Link>
          <Link href="/dashboard?tab=sites" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10">Sites</Link>
          <Link href="/dashboard?tab=data" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10">Data Management</Link>
          <span className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Maintenance</span>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        {/* Filters */}
        <div className="card flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
            <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
            <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Territory</label>
            <input type="text" placeholder="e.g. TAFARA" value={filters.territory} onChange={e => setFilters(f => ({ ...f, territory: e.target.value }))} className="text-sm border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
            <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} className="text-sm border rounded px-2 py-1">
              <option value="">All categories</option>
              {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            id="export-rm-pdf"
            data-export="rm"
            className="ml-auto text-xs font-medium bg-[#1e3a5f] text-white px-3 py-1.5 rounded-md hover:bg-[#162a45]"
          >Export PDF</button>
        </div>

        {loading && (
          <div className="card mt-5 text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading R&amp;M data…</p>
          </div>
        )}

        {!loading && !hasData && (
          <div className="card mt-5 text-center py-12">
            <p className="text-sm text-gray-500 mb-3">No R&amp;M data uploaded for this filter.</p>
            <Link href="/dashboard?tab=data" className="text-sm text-indigo-600 hover:underline">Go to Data Management to upload →</Link>
          </div>
        )}

        {!loading && hasData && (
          <div id="rm-export-root">
            <div className="mt-5"><MaintenanceKPICards kpis={kpis} /></div>

            <div className="card mt-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">R&amp;M Cost Trend</h2>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend} margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#f3f4f6" />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Cost']} />
                  <Line type="monotone" dataKey="cost" stroke="#1e3a5f" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card mt-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Cost by Category</h2>
              <CategoryBreakdownChart data={cats} />
            </div>

            <div className="card mt-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Site Ranking — Cost per Litre</h2>
              <MaintenanceSiteTable data={sites} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Build verify**

```bash
npm run build
```

- [ ] **Step 3: Smoke test in browser**

Run `npm run dev`. Navigate to `http://localhost:3000/dashboard/maintenance`. Confirm:
1. Header + tab strip with Maintenance highlighted.
2. Filters work — changing them updates KPIs/charts/table.
3. Empty-state card shows if no data uploaded.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/maintenance
git commit -m "Add /dashboard/maintenance page with KPIs, charts, table"
```

---

### Task 2.14: Add Maintenance link to the Overview tab strip

**Files:**
- Modify: `app/dashboard/page.tsx`

So users can reach `/dashboard/maintenance` from Overview/Sites/Data Management.

- [ ] **Step 1: Add `Link` import**

At the top of `app/dashboard/page.tsx`:

```tsx
import Link from 'next/link';
```

- [ ] **Step 2: Insert a Maintenance link at the end of the tab strip**

Find the `{ALL_TABS.map(tab => (…))}` block. **Immediately after** the closing `</button>` of that map (or rather after the closing `)}` of the map), add:

```tsx
<Link
  href="/dashboard/maintenance"
  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
>
  Maintenance
</Link>
```

- [ ] **Step 3: Build + smoke test**

```bash
npm run build
```

In the browser, confirm the Overview page now has a "Maintenance" entry on the tab strip that navigates to `/dashboard/maintenance`. Confirm the Maintenance page's tab strip links back to Overview/Sites/Data Management.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "Add Maintenance link to dashboard tab strip"
```

---

### Task 2.15: PDF export for the Maintenance page

**Files:**
- Modify: `app/dashboard/maintenance/page.tsx`

Reuse `html2pdf.js` with the same page-break pattern used in `ReportGenerator.tsx` and the recent layout fixes (commits `cbdaaa3`, `863432d`, `228617f`).

- [ ] **Step 1: Add an `onClick` handler that loads `html2pdf.js` dynamically and exports `#rm-export-root`**

Replace the `<button id="export-rm-pdf" …>` with:

```tsx
<button
  onClick={async () => {
    const root = document.getElementById('rm-export-root');
    if (!root) return;
    const html2pdf = (await import('html2pdf.js')).default;
    await html2pdf().set({
      margin: 6,
      filename: `RM-Report-${filters.dateFrom}_to_${filters.dateTo}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(root).save();
  }}
  className="ml-auto text-xs font-medium bg-[#1e3a5f] text-white px-3 py-1.5 rounded-md hover:bg-[#162a45]"
>Export PDF</button>
```

- [ ] **Step 2: Force a page break before the two charts (so they land on page 2 like the sales report)**

In the JSX, wrap the trend chart card with a `style={{ pageBreakBefore: 'always' }}` so it starts on page 2:

```tsx
<div className="card mt-5" style={{ pageBreakBefore: 'always' }}>
  <h2 className="text-sm font-semibold text-gray-800 mb-3">R&amp;M Cost Trend</h2>
  …
</div>
```

(This mirrors `863432d`'s approach for the sales report.)

- [ ] **Step 3: Cap chart heights so both charts fit on one A4 page**

Change the `ResponsiveContainer height={260}` on the trend chart to `height={240}` and confirm `CategoryBreakdownChart`'s heuristic (`Math.max(220, data.length * 32)`) caps at the same range when rendered for PDF.

(Test the actual output and tune as needed — this is the same trial-and-error as commit `98f4ed3`.)

- [ ] **Step 4: Build + manual export test**

```bash
npm run build
```

In the browser, on `/dashboard/maintenance`, click Export PDF. Open the downloaded file. Confirm:
1. Page 1: KPIs + site ranking table (preview).
2. Page 2: Trend chart + Category breakdown.
3. Charts are not clipped.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/maintenance/page.tsx
git commit -m "Add PDF export to maintenance page with forced page break"
```

---

### Task 2.16: Final end-to-end verification

- [ ] **Step 1: Build clean**

```bash
npm run build
```

Expected: zero errors, zero warnings on routes we touched.

- [ ] **Step 2: Spec coverage check**

Open `docs/superpowers/specs/2026-05-12-rm-report-and-cleanup-design.md` and mentally tick each item:
- [ ] Tier 1 orphan files deleted (Task 1.2)
- [ ] Reconciliation removed (Task 1.3)
- [ ] Database Viewer removed (Task 1.4)
- [ ] Budget Matrix editor removed (Task 1.5)
- [ ] Report comments removed (Task 1.6)
- [ ] Reports → inline panel on Overview (Task 1.7)
- [ ] `maintenance_costs` table created (Task 2.1)
- [ ] `dataType` branch in `/api/validate` (Task 2.2)
- [ ] `dataType` branch in `/api/ingest` (Task 2.3)
- [ ] UploadPanel dropdown (Task 2.4)
- [ ] 5 new `/api/maintenance/*` routes (Tasks 2.5–2.9)
- [ ] MaintenanceKPICards (Task 2.10)
- [ ] CategoryBreakdownChart (Task 2.11)
- [ ] MaintenanceSiteTable (Task 2.12)
- [ ] `/dashboard/maintenance` page (Task 2.13)
- [ ] Maintenance link on Overview (Task 2.14)
- [ ] PDF export on Maintenance page (Task 2.15)

- [ ] **Step 3: Manual full-stack smoke test**

Run `npm run dev`. Walk through:
1. **Cleanup** — Overview / Sites / Data Management are the only tabs (plus a Maintenance link). No Reconcile / DB Viewer / Reports tab. Generate Report button toggles inline on Overview. Site Detail Modal still opens from Top Sites. No Budget Matrix editor in Data Management.
2. **R&M ingest** — Data Management → set Data type to "R&M" → upload a small Excel with `Site, Date, Cost, Category` columns. Confirm validation passes, ingest succeeds, audit trail shows the upload.
3. **R&M page** — Navigate to `/dashboard/maintenance`. KPIs populated. Filters (date, territory, category) update KPIs/charts/table. Trend chart, category breakdown, site table all render.
4. **Edge cases** — Apply a year filter with no R&M data → empty-state card. Site with cost but no sales volume → "—" in cost/litre column.
5. **PDF export** — Click Export PDF on the maintenance page. Open downloaded file. Confirm two pages, charts on page 2, nothing clipped.

If any step fails, fix before marking the plan complete.

- [ ] **Step 4: Final commit (only if any small touch-ups happened during smoke test)**

```bash
git status
# Commit any cleanup, or skip if working tree is clean.
```

---

## Done

Two phases delivered:

1. **Phase 1** removed Reconciliation, Database Viewer, Budget Matrix editor, Report comments, Reports tab, and four orphan files. Reports moved to an inline panel on Overview. ~3,000 lines removed.
2. **Phase 2** added `/dashboard/maintenance` with its own ingest, four KPIs, trend chart, category breakdown, site ranking with cost-per-litre, year/territory/category filters, and PDF export.
