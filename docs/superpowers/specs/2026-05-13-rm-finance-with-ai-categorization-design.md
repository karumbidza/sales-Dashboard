# R&M Finance with AI Categorization — Design

**Status:** Draft → User review
**Date:** 2026-05-13
**Author:** Allen (with Claude)
**Successor to:** the simple `maintenance_costs` flow (commits `2d31c6c`, `a65c4be`, `225e3ac`, `13515c3`)
**Parallel future work:** R&M Helpdesk (separate spec, after this ships)

---

## 1. Purpose

Replace the current minimal `maintenance_costs` table and `/dashboard/maintenance` data path with a richer R&M Finance pipeline driven by the new `R & M FINANCE` tab in `Retail Dashboard Data.xlsx`. The new tab contains actual invoices processed in Dynamics (the ERP) — 3,727 rows, 35 columns, including free-text descriptions and cost-center tagging.

The core new capability is **AI categorization of invoice descriptions** into a fixed taxonomy of 13 R&M categories, so the dashboard can break down spend by what is actually being fixed (Pumps, Compressors, Plumbing, Building, etc.) without anyone hand-classifying 3,000+ rows.

## 2. Scope

**In scope**
- Drop the existing `maintenance_costs` table; replace with a normalized three-table model.
- New ingest path for the `R & M FINANCE` sheet, idempotent on Dynamics Entry No.
- Two-phase ingest: invoice rows persist first, AI categorizer drains pending descriptions in background batches.
- Retail-cost-center filter on every dashboard query (other cost centers are stored faithfully but never shown).
- Three new dashboard features on `/dashboard/maintenance`: invoice-level drill-down, top-descriptions panel, anomaly chips.
- Manual override flow keyed on description text, sticky for all current and future invoices sharing that description.

**Out of scope (deferred to a separate spec)**
- R&M Helpdesk tab (tickets, SLA, equipment fill, problem prediction).
- Multi-cost-center views (Head Office, Supply Chain, Projects, Lubricants, Non-Redan sites, HSSE).
- Budget-vs-actual on R&M spend.
- AI-driven anomaly detection (we start with deterministic z-score heuristics).

## 3. Decisions taken during brainstorming

| Decision | Choice |
|---|---|
| Relationship to existing maintenance system | **Replace** (drop `maintenance_costs`, rewrite endpoints, re-upload) |
| Cost-center scope on dashboard | **Retail only** (other cost centers stored, filtered out of views) |
| Taxonomy | **13 fixed categories** (see §4.1) |
| AI categorization timing | **On upload, batched, with description-level caching** |
| AI provider | **Anthropic Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) |
| Manual override semantics | **Sticky by description** — fixes one row and every other row sharing the same description text |
| AI confidence handling | **Claude returns `high \| medium \| low`; low → `category=other`, `needs_review=true`** |
| New dashboard features | **Invoice drill-down, top descriptions / repeat costs, anomaly flags** |
| Ingest/AI coupling | **Approach B — two-phase: ingest writes invoices + placeholder description rows; a separate categorize-batch endpoint drains pending descriptions** |

## 4. Design

### 4.1 Category taxonomy (seed data)

| slug | display_name | sort | examples |
|---|---|---|---|
| `pumps_dispensers` | Pumps / Dispensers | 1 | Dispensers, nozzles, hoses, STP, shear/breakaway valves |
| `compressors_air` | Compressors / Air | 2 | Air compressors, compressor motors, pressure gauges, V-belts |
| `tanks_lines` | Tanks / Lines / Bunds | 3 | Underground tanks, fuel lines, manholes, ATG, dipsticks, bunding, line testing |
| `generators` | Generators / Backup Power | 4 | Gensets, generator service & repair |
| `solar_ups` | Solar / UPS | 5 | Solar panels, inverters, batteries, UPS |
| `electrical_lighting` | Electrical & Lighting | 6 | Wiring, sockets, fault clearing, isolators, canopy/forecourt/flood/LED/fluorescent lights |
| `plumbing_water_waste` | Plumbing / Water / Waste | 7 | Leaks, toilets, urinals, sinks, sprinklers, liquid-waste disposal, boreholes |
| `building_civil` | Building / Civil | 8 | Paint, roof, doors, windows, tiles, paving, potholes, locksets, safes, HVAC |
| `canopy_signage` | Canopy / Signage | 9 | Canopy structure, signage, illumination, display boards |
| `landscaping_grounds` | Landscaping / Grounds | 10 | Garden, grass, trees, hedging |
| `fire_safety` | Fire & Safety | 11 | Extinguishers, fire equipment |
| `security_cctv` | Security / CCTV | 12 | CCTV, alarms, fences, gates |
| `other` | Other / Uncategorised | 99 | Fallback — used for low-confidence AI output and any description that genuinely doesn't fit |

### 4.2 Data model

Three new tables. `maintenance_costs` is dropped in the same migration.

```sql
CREATE TABLE rm_categories (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(40) UNIQUE NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  sort_order  SMALLINT NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
-- Seed all 13 rows in the migration.

CREATE TABLE rm_description_categories (
  id                BIGSERIAL PRIMARY KEY,
  description_norm  TEXT UNIQUE NOT NULL,           -- lower(trim(regexp_replace(d, '\s+', ' ', 'g')))
  category_id       INT REFERENCES rm_categories(id),
  confidence        VARCHAR(10),                    -- 'high' | 'medium' | 'low' | NULL while pending
  source            VARCHAR(10) NOT NULL,           -- 'ai' | 'override' | 'pending'
  needs_review      BOOLEAN DEFAULT FALSE,
  ai_model          VARCHAR(40),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_rdc_needs_review ON rm_description_categories(needs_review) WHERE needs_review = TRUE;
CREATE INDEX idx_rdc_source       ON rm_description_categories(source);

CREATE TABLE rm_invoices (
  id                BIGSERIAL PRIMARY KEY,
  entry_no          BIGINT UNIQUE NOT NULL,         -- Dynamics natural key, dedupes re-uploads
  site_code         VARCHAR(20) NOT NULL REFERENCES sites(site_code),
  service_date      DATE NOT NULL,
  description       TEXT NOT NULL,
  description_norm  TEXT GENERATED ALWAYS AS
                    (lower(trim(regexp_replace(description, '\s+', ' ', 'g')))) STORED,
  debit_lcy         NUMERIC(14,2) NOT NULL,
  credit_lcy        NUMERIC(14,2) DEFAULT 0,
  net_cost          NUMERIC(14,2) GENERATED ALWAYS AS (debit_lcy - credit_lcy) STORED,
  document_type     VARCHAR(20),                    -- 'Invoice' | 'Credit Memo' | ...
  document_no       VARCHAR(40),
  external_doc_no   VARCHAR(40),
  gl_account_no     VARCHAR(20),
  cost_center       VARCHAR(20) NOT NULL,           -- 'retail' | 'commercial' | 'head_office' | ...
  upload_log_id     BIGINT REFERENCES upload_log(id) ON DELETE SET NULL,
  source_file       VARCHAR(255),
  ingested_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_rmi_site_date    ON rm_invoices(site_code, service_date);
CREATE INDEX idx_rmi_service_date ON rm_invoices(service_date);
CREATE INDEX idx_rmi_desc_norm    ON rm_invoices(description_norm);
CREATE INDEX idx_rmi_cost_center  ON rm_invoices(cost_center);
```

Why a separate `rm_description_categories` table (instead of `category_id` directly on `rm_invoices`):
- Manual overrides are sticky by description; storing once means changing once.
- The AI cache and the override store are the same thing — one source of truth.
- Saves space and de-couples categorization changes from re-ingest.

`cost_center` is derived during ingest from whichever of `Retail Code`, `Commercial Code`, `Head office Code`, `Supply Chain Code`, `Projects Code`, `Lubricants Code`, `Non redan sites Code`, `Hsse Code` is non-null. If multiple are non-null, the first non-null in that order wins (with a log warning).

Rows whose `site_code` is not in `sites` go to the existing `unmatched_status_rows` table with `sheet_name='R & M FINANCE'`.

### 4.3 Ingest pipeline (Approach B)

```
┌──────────────────────────────────────────────────────────────────────┐
│  POST /api/ingest  (dataType=maintenance branch — rewritten)         │
│                                                                       │
│  1. Parse 'R & M FINANCE' rows via lib/xlsx-parse.ts                  │
│  2. Per row:                                                          │
│       a. Look up site_code in sites → if miss, push to                │
│          unmatched_status_rows with sheet_name='R & M FINANCE'        │
│       b. Derive cost_center from *Code columns                        │
│       c. Build rm_invoices row keyed by entry_no                      │
│  3. Bulk INSERT INTO rm_invoices … ON CONFLICT (entry_no) DO NOTHING  │
│  4. SELECT DISTINCT description_norm FROM rm_invoices                 │
│        LEFT JOIN rm_description_categories USING (description_norm)   │
│        WHERE rm_description_categories.id IS NULL                     │
│     → list of "unseen" descriptions                                   │
│  5. Bulk INSERT placeholders into rm_description_categories with      │
│        source='pending', category_id=(SELECT id FROM rm_categories    │
│        WHERE slug='other')                                            │
│  6. Return { invoice_rows_inserted, pending_descriptions,             │
│              upload_log_id }                                          │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (client triggers immediately after success)
┌──────────────────────────────────────────────────────────────────────┐
│  POST /api/maintenance/categorize-batch                               │
│                                                                       │
│  Body: { upload_log_id? }  (filters to descriptions referenced by     │
│                             this upload if provided, else any pending) │
│  - Select up to 50 rm_description_categories WHERE source='pending'   │
│  - One Claude request → categorize the batch                          │
│  - UPDATE each row: category_id, confidence, source='ai',             │
│       needs_review = (confidence='low'), ai_model, updated_at         │
│  - On API error → leave rows pending; record error on upload_log;     │
│       return { error, processed: 0, remaining: N }                    │
│  - On success → return { processed, remaining }                       │
│                                                                       │
│  Client loops until remaining = 0, displaying progress in the         │
│  UploadPanel.                                                         │
│                                                                       │
│  A Vercel cron hits the same endpoint every 5 min (no upload_log_id)  │
│  as a safety net if the client tab closes before the loop finishes.   │
└──────────────────────────────────────────────────────────────────────┘
```

**Idempotency properties**
- Re-uploading the same workbook: `ON CONFLICT (entry_no) DO NOTHING` keeps `rm_invoices` stable; the unseen-descriptions query naturally returns empty; no AI cost.
- Partial categorization: if Vercel kills a request mid-loop, pending rows remain in the DB; next call picks up where it left off.
- A row that already has a non-pending category (e.g., an override) is never re-categorized by the batcher — `WHERE source='pending'` excludes it.

### 4.4 AI categorizer

**Model:** `claude-haiku-4-5-20251001`.

**Library:** `@anthropic-ai/sdk` (Node).

**System prompt** (cached via `cache_control: { type: "ephemeral" }`):

```
You categorize R&M (repairs & maintenance) invoice descriptions for a
fuel-station retail business in Zimbabwe. You will receive a list of
descriptions and must assign each to exactly ONE of these categories:

  pumps_dispensers       — Dispensers, fuel nozzles, hoses, STP,
                           shear/breakaway valves
  compressors_air        — Air compressors, compressor motors,
                           pressure gauges, V-belts
  tanks_lines            — Underground tanks, fuel lines, manholes,
                           ATG, dipsticks, bunding, line testing
  generators             — Gensets, generator service & repair
  solar_ups              — Solar panels, inverters, batteries, UPS
  electrical_lighting    — Wiring, sockets, fault clearing, isolators,
                           canopy/forecourt/flood/LED/fluorescent lights
  plumbing_water_waste   — Leaks, toilets, urinals, sinks, sprinklers,
                           liquid-waste disposal, boreholes
  building_civil         — Paint, roof, doors, windows, tiles, paving,
                           potholes, locksets, safes, HVAC
  canopy_signage         — Canopy structure, signage, illumination,
                           display boards
  landscaping_grounds    — Garden, grass, trees, hedging
  fire_safety            — Extinguishers, fire equipment
  security_cctv          — CCTV, alarms, fences, gates
  other                  — Use ONLY if no category above plausibly fits.

Also rate your confidence: "high" | "medium" | "low".
- "high"  = the description directly names something in the category
- "medium" = strong implication from context
- "low"   = guess; surface for human review

Return strict JSON via the provided tool. No prose.
```

**Tool/output schema** (forces JSON via Anthropic tool-use):

```jsonc
{
  "name": "categorize",
  "input_schema": {
    "type": "object",
    "properties": {
      "results": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id":         { "type": "integer" },
            "category":   { "type": "string", "enum": ["pumps_dispensers", "...", "other"] },
            "confidence": { "type": "string", "enum": ["high","medium","low"] }
          },
          "required": ["id","category","confidence"]
        }
      }
    },
    "required": ["results"]
  }
}
```

**Batch size:** 50 descriptions per request. For 2,548 unique descriptions: ~51 requests on the first upload, ~$1.25 total (Haiku pricing, with system-prompt caching). Subsequent uploads: near-zero (cache hits dominate).

**Failure modes**
- HTTP/network error → leave the entire batch's rows `source='pending'`; record on `upload_log.error_message`; client retries on next loop iteration. After 3 consecutive failures the client surfaces a "Retry categorization" button and stops looping until clicked.
- Schema-invalid response (somehow) → fall back per-row to `category='other'`, `confidence='low'`, `needs_review=true`. Do not block other rows in the batch.
- A description the model refuses to classify → same per-row fallback.

**Rate limiting:** sequential batches (one in-flight at a time). No parallel batches needed at this scale.

### 4.5 Dashboard

`/dashboard/maintenance` keeps its current four-block layout. Three additions:

**A. Invoice-level drill-down**
A side panel (Sheet/Drawer component) that opens when the user clicks:
- a row in the existing site table → filtered to that site
- a segment of the existing category breakdown chart → filtered to that category
- a row in the new top-descriptions panel → filtered to that description

Columns shown: date, description, doc #, amount, category badge, confidence pill (only if `needs_review`).
Filters inside the panel: date range (defaults to dashboard filter), min cost, "needs_review only" toggle.
Inline "Reclassify" dropdown (the 13 categories) on each row → POSTs `/api/maintenance/reclassify`; on success refetches the panel and the parent dashboard.

**B. Top descriptions / repeat costs**
A new panel under the existing category breakdown, two tabs:
- *Most expensive descriptions* — top 20 by `SUM(net_cost)` over the date range, with occurrence count and avg cost.
- *Most frequent descriptions* — top 20 by `COUNT(*)`, with total spend.

Each row click → opens the invoice drill-down filtered to that description.

**C. Anomaly chips**
Small status row above the KPI cards:

```
⚠ 7 anomalies this period   ·   12 items need review
```

- *Anomalies* = invoices with `net_cost > μ + 2σ` within their (site_code, category_id) historical distribution (only flagged when N ≥ 5 historical data points), plus site-months where the site's total `net_cost` for that month is > μ + 2σ vs the site's trailing-12-month mean.
- *Items needing review* = `COUNT(*) FROM rm_description_categories WHERE needs_review = TRUE`.

Both chips open the same drill-down panel pre-filtered.

**New backend endpoints**

| Endpoint | Purpose |
|---|---|
| `GET /api/maintenance/invoices` | Paginated invoice list. Filters: `site_code`, `category`, `description`, `dateFrom`, `dateTo`, `needsReview`, `minCost`. |
| `GET /api/maintenance/top-descriptions?by=spend\|count` | Top 20 descriptions by spend or count. |
| `GET /api/maintenance/anomalies?dateFrom&dateTo` | Anomalous invoices + site-month spikes. |
| `POST /api/maintenance/categorize-batch` | Drains pending descriptions (one batch per call). |
| `POST /api/maintenance/reclassify` | Body `{ description_norm, category_slug }`. Upserts the override. |

**Existing endpoints rewritten** (same response shape, new tables):
- `GET /api/maintenance/kpis`
- `GET /api/maintenance/trend`
- `GET /api/maintenance/categories` — chart breakdown (existing)
- `GET /api/maintenance/categories-list` — flat list of the 13 categories for filter dropdowns and the reclassify menu (existing endpoint, rewritten to return from `rm_categories`)
- `GET /api/maintenance/sites`

### 4.6 Migration plan

Single SQL file `sql/migrations/rm_finance.sql`:

```sql
BEGIN;

CREATE TABLE rm_categories          (...);
INSERT  INTO rm_categories          (slug, display_name, sort_order) VALUES (...);  -- 13 rows
CREATE TABLE rm_description_categories (...);
CREATE TABLE rm_invoices            (...);
-- All indexes from §4.2.

DROP TABLE IF EXISTS maintenance_costs;

COMMIT;
```

No data carry-over: the workbook is the source of truth and is re-uploaded after deploy.

**Code changes**
- `lib/xlsx-parse.ts` — new `parseRMFinanceSheet()` returning `RMInvoiceRow[]`.
- `lib/categorizer.ts` (new) — Anthropic client + batch classify + schema-validate.
- `app/api/ingest/route.ts` — rewrite the `dataType='maintenance'` branch.
- `app/api/validate/route.ts` — update the maintenance branch.
- `app/api/maintenance/*` — rewrite endpoints, add new ones.
- `app/dashboard/maintenance/page.tsx` — invoice drawer, top-descriptions panel, anomaly chips.
- `components/UploadPanel.tsx` — show categorization progress after ingest success; "Retry categorization" button on failure.
- `vercel.json` — cron entry hitting `/api/maintenance/categorize-batch` every 5 min.

**Environment**
- `ANTHROPIC_API_KEY` added to `.env.local` and Vercel project env.
- `@anthropic-ai/sdk` added to `package.json`.

**Deploy order**
1. Apply migration on Neon (use a Neon branch for staging first).
2. Deploy code.
3. Re-upload workbook from the dashboard.
4. Watch categorizer drain (~51 batches, a couple of minutes).
5. Review the "needs_review" queue.

### 4.7 Testing strategy

**Unit (tsx runner, no framework added)**
- `lib/xlsx-parse.ts` — XLSX fixtures: 1-row, multi-row, missing site code, non-retail cost center, malformed Entry No. Assert typed output.
- `lib/categorizer.ts` — mock Claude client returning canned responses:
  - high/medium → category written with confidence
  - low → `needs_review=true`
  - schema-invalid → fallback to `other` + `needs_review`
  - network error → row stays `pending`

**Integration (Neon test DB or local Postgres)**
- Apply migration; assert schema.
- Run ingest on a fixture XLSX; verify `rm_invoices` rows, `unmatched_status_rows` for bad site code, placeholders in `rm_description_categories`.
- Re-run ingest on the same fixture; assert zero new rows.
- Reclassify endpoint: assert category flips for all invoices sharing the description.

**Manual verification before declaring done**
1. Migration applied on a Neon branch.
2. Upload real workbook; first categorize-batch returns within 5 s.
3. `/dashboard/maintenance` KPIs match a hand-computed total from the Excel.
4. Site row → invoice panel shows expected invoices.
5. Reclassify one low-confidence row → chart updates after refetch.
6. Re-upload the same workbook → no duplicates.

**Out of scope for tests**
- AI category accuracy (measured empirically on the first run).
- Anomaly false-positive rate (we test the math, not the rate).

## 5. Risks and open questions

| Risk | Mitigation |
|---|---|
| Vercel function timeout on first categorize-batch call | Batch size 50 keeps a single request well under 10 s. Resumable design tolerates the timeout if it happens anyway. |
| ANTHROPIC_API_KEY accidentally committed | `.env.local` is already in `.gitignore`. Verify before first run. |
| Cost-center derivation when multiple `*Code` columns are non-null | First non-null in fixed order wins; log a warning row for audit. Deferring strict validation until we see real conflicts. |
| Anomaly z-score noisy when N is small | Only flag when N ≥ 5 historical data points. |
| Helpdesk tab is in the same workbook but not handled yet | Ingest ignores the `R & M HELPDESK` sheet for now; covered in the next spec. |

## 6. What this spec does *not* design

These are deliberately deferred to keep this spec implementable in one cycle:
- Multi-cost-center dashboard views.
- R&M budget tracking.
- Vendor/supplier analysis.
- AI-driven anomaly detection.
- R&M Helpdesk pipeline (separate spec).
