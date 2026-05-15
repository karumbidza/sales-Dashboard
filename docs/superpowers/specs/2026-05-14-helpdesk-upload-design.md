# R&M Helpdesk Upload — Design

**Date:** 2026-05-14
**Status:** Design approved, ready for implementation plan
**Context:** Adds the Freshdesk-style "R & M HELPDESK" sheet as a new data source alongside the existing R & M FINANCE invoices, sharing the categorization layer.

## Problem

The user uploads two sheets monthly: `R & M FINANCE` (invoices) and `R & M HELPDESK` (Freshdesk export of maintenance tickets). Today only invoices are ingested. The user wants helpdesk data to drive operational triage views: open ticket counts and aging, recurring problems, breakdowns per site, contractor performance, and volume trends. They are skipping cost tracking from the helpdesk side (R&M Finance covers that).

## Goals

- Ingest the helpdesk sheet end-to-end via the existing UploadPanel.
- Share the categorization pipeline (rules + AI + cache) between invoices and tickets so a rule the user authored for invoices applies to tickets immediately.
- A dedicated `/dashboard/helpdesk` page surfacing the metrics above.
- Re-uploads are idempotent: ticket status changes (Open → Resolved → Closed) update; immutable fields (ticket_id, site_code, subject, created_time) don't get clobbered on re-upload.

## Non-goals

- Cost tracking via the `Amount paid` column. Explicit user direction; column is dropped at parse time.
- Per-ticket linkage to specific invoices. Tickets and invoices are independent. They share categorization through content-addressed `description_norm`.
- Agent performance view, SLA tuning, CSV/PDF export. Deferred.
- Inline rule-creation from the helpdesk drawer. The Rules page remains the single rule-management surface.

## Architecture

### Data flow

```
Upload Excel (R & M HELPDESK sheet)
   ↓
Parse + validate rows (Ticket ID, SITE CODE, Subject, Status, dates)
   ↓
Insert into rm_helpdesk_tickets
   (ON CONFLICT ticket_id DO UPDATE on mutable fields only)
   ↓
For each ticket's Subject:
   - Normalize → description_norm (via Postgres GENERATED column)
   - Discover unseen description_norm → insert into rm_description_categories
     with source='pending'
   - Skipped if description_norm already in cache (shared with invoices)
   ↓
Apply active keyword rules (existing APPLY_RULES_SQL)
   ↓
Cron drains remaining 'pending' rows with the smarter prompt (existing categorize-batch)
```

### Why categorization is shared

`rm_description_categories.description_norm UNIQUE` is content-addressed. Two distinct rows in source tables that share a normalized text share a single cache row. This is already how multiple invoices with the same description deduplicate categorization. Tickets join naturally.

Implication: a manual reclassify of an invoice description automatically applies to any ticket with the same subject (after normalization), and vice versa. This is desired — same vocabulary, same domain.

### Files created

| Path | Purpose |
|---|---|
| `sql/migrations/rm_helpdesk_tickets.sql` | New table + indexes |
| `lib/helpdesk-parse.ts` | `parseHelpdeskRow`, `parseHelpdeskRows`, date and resolution-time parsers |
| `lib/helpdesk-parse.test.ts` | Unit tests for the pure parsers |
| `app/api/helpdesk/kpis/route.ts` | KPI cards endpoint |
| `app/api/helpdesk/trend/route.ts` | Monthly volume trend |
| `app/api/helpdesk/recurring/route.ts` | Top recurring problems |
| `app/api/helpdesk/sites/route.ts` | Tickets per site |
| `app/api/helpdesk/contractors/route.ts` | Service provider performance |
| `app/api/helpdesk/open/route.ts` | Open / pending tickets sorted by aging |
| `app/api/helpdesk/tickets/route.ts` | Paginated drill-down list |
| `app/dashboard/helpdesk/page.tsx` | The dashboard page |
| `components/helpdesk/HelpdeskKPICards.tsx` | KPI card grid |
| `components/helpdesk/TopRecurringPanel.tsx` | Top recurring problems table |
| `components/helpdesk/SitesPanel.tsx` | Sites table |
| `components/helpdesk/ContractorsPanel.tsx` | Service providers table |
| `components/helpdesk/OpenTicketsPanel.tsx` | Open tickets aging table |
| `components/helpdesk/TicketDrawer.tsx` | Slide-in drawer for ticket drill-down |

### Files modified

| Path | Change |
|---|---|
| `app/api/ingest/route.ts` | New `ingestHelpdesk(body)` branch + helpdesk import in dataType peek |
| `app/api/validate/route.ts` | New `validateHelpdesk(req)` branch |
| `components/ui/UploadPanel.tsx` | Add `'helpdesk'` to `dataType` state, dropdown option, sheet picker, validate/ingest routing |
| `app/dashboard/page.tsx` (Sales) | Add `Helpdesk` tab link |
| `app/dashboard/maintenance/page.tsx` | Add `Helpdesk` tab link |
| `app/dashboard/maintenance/rules/page.tsx` | Add `Helpdesk` tab link |

## Schema

```sql
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
```

### Column decisions

| Decision | Why |
|---|---|
| `ticket_id BIGINT UNIQUE` | Freshdesk identifier; enables `ON CONFLICT (ticket_id) DO UPDATE` on re-upload |
| `description_norm` is GENERATED from `subject` | Mirrors `rm_invoices.description_norm`; joins to the shared cache |
| `resolution_minutes INTEGER` parsed from `"534:31:57"` | Single number, queryable for aggregations |
| `ticket_group` (not `group`) | `group` is a SQL reserved word |
| Status is free-text VARCHAR | Freshdesk emits varied statuses (Open, Pending, Resolved, Closed, Waiting on Customer); UI groups them, DB doesn't enum |
| Dropped columns | `Type`, `Internal agent/group`, `Survey results`, `Tags`, `Source Info`, `Product`, `Summary`, `Last update time`, `Equipment 2/3`, `Service provider 2/3`, `Amount paid`, `Full name`, `contact`, response time/interaction fields. Mostly null, redundant, PII, or out of scope. |

### ON CONFLICT semantics

```sql
INSERT INTO rm_helpdesk_tickets (ticket_id, site_code, subject, status, priority, source,
                                  ticket_group, agent, equipment, service_provider,
                                  created_time, due_time, resolved_time, closed_time,
                                  resolution_minutes, resolution_status,
                                  upload_log_id, source_file)
VALUES (...)
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
```

Mutable fields (status, dates, resolution) update; immutable identifying fields (site_code, subject, created_time) don't get clobbered.

## Parsing

### `parseHelpdeskRow`

```typescript
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
  created_time:       string;     // ISO
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
```

The parser pulls fields from the workbook's exact column names, including `'Equipment '` and `'Amount paid '` with trailing spaces (Freshdesk export quirk). Skipped rows return `{ok: false, reason, raw}` for the validate UI to surface a breakdown.

### `parseHelpdeskDate(v)`

Freshdesk emits `M/D/YY H:MM` strings. Implementation:

```typescript
export function parseHelpdeskDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, mo, d, y, h, min, sec] = m;
  const yyyy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  const date = new Date(Date.UTC(
    yyyy, parseInt(mo, 10) - 1, parseInt(d, 10),
    parseInt(h, 10), parseInt(min, 10), sec ? parseInt(sec, 10) : 0,
  ));
  return isNaN(date.getTime()) ? null : date.toISOString();
}
```

Two-digit years are interpreted as 2000-prefixed (Freshdesk's convention).

### `parseResolutionMinutes(v)`

Resolution time is `H:MM:SS` where hours can be arbitrarily large (e.g. `"534:31:57"`):

```typescript
export function parseResolutionMinutes(v: unknown): number | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const [, h, min, sec] = m;
  return parseInt(h, 10) * 60 + parseInt(min, 10) + Math.round(parseInt(sec, 10) / 60);
}
```

Returns total minutes (`534×60 + 31 + 1 ≈ 32072` for the example). Seconds are rounded into minutes.

## Ingest

`ingestHelpdesk(body)` lives alongside `ingestMaintenance` in `app/api/ingest/route.ts`. Mirrors that flow:

1. Parse rows via `parseHelpdeskRows`.
2. Resolve `site_code` against `sites` master. Unmatched → `unmatched_status_rows` with `sheet_name = 'R & M HELPDESK'`.
3. Bulk insert into `rm_helpdesk_tickets` with the `ON CONFLICT (ticket_id) DO UPDATE` above.
4. Discovery query: insert unseen `description_norm` placeholders into `rm_description_categories` with `source='pending'` (only for descriptions that came in via this `upload_log_id`).
5. Run `APPLY_RULES_SQL` so any rule-matched subjects categorize immediately.
6. Update `upload_log.row_counts` with summary.

Supports chunked uploads (2000 rows per request, `uploadLogId` threaded between chunks, `final: true` finalizes) identical to the R&M Finance flow.

## Validation

`validateHelpdesk(req)` parallels `validateMaintenance`:

- Required columns: `SITE CODE`, `Ticket ID`, `Subject`, `Status`, `Created time`.
- Parse all rows; surface skip-reason breakdown.
- Site-code coverage check against the `sites` master.
- Date range from successfully parsed `created_time` values.
- Returns at root (no `{data: {...}}` wrapper) — same shape as the sales validate path.

## UploadPanel changes

```typescript
const [dataType, setDataType] = useState<'sales' | 'maintenance' | 'helpdesk'>('sales');
```

Dropdown gains:

```tsx
<option value="helpdesk">R&amp;M Helpdesk</option>
```

`handleValidate` branches on `dataType === 'helpdesk'`:

```typescript
const rmSheetName =
  wb.SheetNames.find(n => n.trim().toUpperCase().replace(/\s+/g, ' ') === 'R & M HELPDESK')
  ?? (wb.SheetNames.length === 1 ? wb.SheetNames[0] : null);
```

`handleIngest` for `helpdesk` uses the same chunked-upload code path as maintenance (2000 rows, threaded uploadLogId, CategorizationProgress component mounts on completion if `pending_descriptions > 0`).

## API endpoints

All under `app/api/helpdesk/`. Each accepts a consistent filter set: `dateFrom`, `dateTo` (on `created_time`), `priority`, `status`, `category` (slug), `siteCode`.

### `GET /api/helpdesk/kpis`

Returns:
```json
{
  "data": {
    "openCount": 42,
    "openByPriority": { "Urgent": 4, "High": 10, "Medium": 18, "Low": 10 },
    "slaViolatedCount": 18,
    "slaViolatedPct": 8.2,
    "avgResolutionMinutes": 2851,
    "topEquipment": "Canopy",
    "topEquipmentCount": 23
  }
}
```

Open = `status NOT IN ('Closed', 'Resolved')`. SLA violated = `resolution_status = 'SLA Violated'`.

### `GET /api/helpdesk/trend?granularity=monthly`

```json
{ "data": [{ "period": "2026-01-01", "count": 87 }, ...] }
```

Bucketed by `DATE_TRUNC('month', created_time)`.

### `GET /api/helpdesk/recurring?by=count`

Top 20 description_norms by count, joined to category:

```json
{ "data": [{
  "descriptionNorm": "forecourt canopy lights need attention",
  "sampleSubject": "forecourt canopy lights need attention",
  "count": 23,
  "categorySlug": "canopy_signage",
  "categoryName": "Canopy / Signage"
}, ...] }
```

### `GET /api/helpdesk/sites`

```json
{ "data": [{
  "siteCode": "RUW-063",
  "siteName": "RUWA",
  "total": 87,
  "open": 12,
  "avgResolutionMinutes": 2851
}, ...] }
```

Sorted by `total DESC`, limit 1000.

### `GET /api/helpdesk/contractors`

```json
{ "data": [{
  "provider": "ACME Engineering",
  "ticketCount": 134,
  "avgResolutionMinutes": 1820,
  "slaHitPct": 87.3
}, ...] }
```

`provider IS NULL` rows excluded; sorted by `ticketCount DESC`.

### `GET /api/helpdesk/open`

Current open/pending tickets, sorted by aging desc:

```json
{ "data": [{
  "ticketId": 12288,
  "siteCode": "RUW-063",
  "siteName": "RUWA",
  "priority": "Urgent",
  "createdTime": "2025-11-13T10:09:00Z",
  "daysOpen": 183,
  "subject": "forecourt canopy lights need attention"
}, ...] }
```

`status NOT IN ('Closed', 'Resolved')`, ordered by `created_time ASC` (oldest first). Limit 200.

### `GET /api/helpdesk/tickets`

Paginated drill-down. Accepts the same filters plus `limit` (default 200) and `cursor` (last-seen ticket_id). Used by `TicketDrawer`.

## UI components

### `HelpdeskKPICards`

Four cards: Open Tickets (with priority breakdown sub-line), SLA Violated %, Avg Resolution Time (hours), Top Equipment. Mirrors `MaintenanceKPICards` styling.

### `TopRecurringPanel`

Table with `Subject | Category | Count`. Row click → opens `TicketDrawer` filtered by `descriptionNorm`. Sortable by count or alphabetical.

### `SitesPanel`

Table with `Site | Total | Open | Avg Resolution`. Row click → opens `TicketDrawer` filtered by `siteCode`. Sortable, paginated like `MaintenanceSiteTable`.

### `ContractorsPanel`

Table with `Provider | Tickets | Avg Resolution | SLA Hit %`. Row click → drawer filtered by service_provider.

### `OpenTicketsPanel`

Simple list: oldest open tickets first. Each row shows ticket id, priority pill, days open, subject. Row click → drawer (or external link to Freshdesk if we add one later — not in scope now).

### `TicketDrawer`

Slide-in panel like `InvoiceDrawer`. Lists tickets matching the active filter context. Each row has:
- Ticket ID, Site, Created time, Priority pill, Status pill, Subject, Equipment, Resolution time
- Category dropdown that calls `/api/maintenance/reclassify` with `description_norm` (the shared one). Reclassifying a ticket's category propagates to all invoices and tickets with the same description_norm.

Uses the same staged-changes-then-Save-All pattern from `InvoiceDrawer`.

## Edge cases and decisions

1. **Re-uploading a closed ticket.** `ON CONFLICT (ticket_id) DO UPDATE` updates status/dates. Re-uploading the same export twice is idempotent and cheap.
2. **A ticket's subject changes between uploads.** Freshdesk allows subject edits. The `ON CONFLICT` does NOT update `subject` — once it's in our DB, the subject is fixed. If Freshdesk emits a different subject, we keep ours. This avoids the ticket appearing in different recurring-issue groups after an edit. Trade-off accepted; flagged here for awareness.
3. **Open tickets with no resolution time.** `resolution_minutes IS NULL` for those. Average calculations should `FILTER (WHERE resolution_minutes IS NOT NULL)` to avoid skewing.
4. **Category propagation visible cross-domain.** Per Section 4 of the design, an invoice override flows to identically-worded tickets. We expose this in the UI (the InvoiceDrawer's "modified" pill matches the TicketDrawer's), so users understand reclassifies are global within the description_norm.
5. **Date range filter applies to `created_time`.** Open tickets created before the window still count as open if their `closed_time` is inside the window — but the simpler rule "filter on created_time only" is what most users expect and matches the Maintenance dashboard.
6. **The shared cache means new tickets can fill `other`.** A ticket subject that doesn't match any existing description_norm becomes a new `pending` row. The cron drains it with the same prompt as invoices. No new cron infrastructure.

## Migration / rollout

- `sql/migrations/rm_helpdesk_tickets.sql` runs once against Neon. Idempotent (`CREATE TABLE IF NOT EXISTS`).
- No backfill — tickets are populated on the first user upload.
- The dashboard page returns empty/zero results until the first ingest, then populates immediately.

## Out of scope / future work

- Agent performance view (assignee productivity).
- SLA tuning per priority.
- CSV / PDF export from the helpdesk page.
- Inline rule-creation from the TicketDrawer.
- Cost tracking from `Amount paid`.
- Direct link-out from a ticket row to Freshdesk.
- Per-ticket linkage to invoices (would require a manual cross-ref or matching heuristic).
