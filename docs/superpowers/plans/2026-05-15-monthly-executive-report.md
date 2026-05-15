# Monthly Executive Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/dashboard/monthly-report` page producing a polished 5-section A4-portrait PDF monthly report that management can email. Default month is the previous calendar month; user can pick any month via `<input type="month">`. Generate PDF button reuses the existing `html2pdf.js` pattern from the Maintenance page.

**Architecture:** Single endpoint `GET /api/executive/monthly?month=YYYY-MM` returns all 5 sections in one payload. Page composes 5 React section components from the payload, then snapshots `#exec-report-root` to PDF. No new schema. No new dependencies.

**Tech Stack:** TypeScript, Next.js 14 App Router, Postgres (via `lib/db.ts`), Recharts (for trend charts), `html2pdf.js` (already in use), Tailwind.

**Spec reference:** `docs/superpowers/specs/2026-05-15-monthly-executive-report-design.md`

---

## File Map

**Create:**
- `app/api/executive/monthly/route.ts` — single endpoint returning all 5 sections
- `app/dashboard/monthly-report/page.tsx` — page with month picker, Generate PDF, and sections
- `components/exec/ReportCover.tsx` — Section 1 (KPIs)
- `components/exec/CostSection.tsx` — Section 2 (trends + categories)
- `components/exec/HelpdeskSection.tsx` — Section 3 (SLA + contractors + recurring)
- `components/exec/SitesSection.tsx` — Section 4 (top/bottom + gaps)
- `components/exec/ActionItemsSection.tsx` — Section 5 (outliers + long-open + breaches)

**Modify (single-line tab additions):**
- `app/dashboard/page.tsx` (Sales)
- `app/dashboard/maintenance/page.tsx`
- `app/dashboard/maintenance/rules/page.tsx`
- `app/dashboard/helpdesk/page.tsx`
- `app/dashboard/cost-analysis/page.tsx`

---

## Task 1: Monthly endpoint

**Files:**
- Create: `app/api/executive/monthly/route.ts`

The endpoint runs ~8 sequential SQL queries and assembles them into one JSON payload. Each query is small; the total response is ~3-5 KB.

- [ ] **Step 1: Implement the endpoint**

Create `app/api/executive/monthly/route.ts`:

```typescript
// app/api/executive/monthly/route.ts
// Single endpoint returning all 5 sections of the monthly executive report.
// Multiple sequential SQL queries (one per logical block); assembled into
// one JSON payload so the report sees a consistent point-in-time snapshot.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface MonthWindow {
  monthLabel: string;       // "April 2026"
  start: string;            // YYYY-MM-DD (inclusive)
  end: string;              // YYYY-MM-DD (exclusive)
  priorStart: string;       // prior month start (inclusive)
  priorEnd: string;         // prior month end (exclusive)
  trail90Start: string;     // 90 days before start (for rolling SLA baseline)
  trail12Start: string;     // 12 months before start (for trend chart)
}

function parseMonth(raw: string | null): MonthWindow {
  let s = raw || '';
  if (!/^\d{4}-\d{2}$/.test(s)) {
    // Default: previous calendar month
    const now = new Date();
    const y = now.getUTCFullYear();
    const m0 = now.getUTCMonth(); // 0-indexed current month
    const prevY = m0 === 0 ? y - 1 : y;
    const prevM = m0 === 0 ? 12 : m0;
    s = `${prevY}-${String(prevM).padStart(2, '0')}`;
  }
  const [y, m] = s.split('-').map(Number);
  const start       = new Date(Date.UTC(y, m - 1, 1));
  const end         = new Date(Date.UTC(y, m,     1));
  const priorStart  = new Date(Date.UTC(y, m - 2, 1));
  const priorEnd    = new Date(Date.UTC(y, m - 1, 1));
  const trail90Start = new Date(start.getTime() - 90 * 86400000);
  const trail12Start = new Date(Date.UTC(y, m - 13, 1));
  const monthName = start.toLocaleString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  return {
    monthLabel:   monthName,
    start:        start.toISOString().slice(0, 10),
    end:          end.toISOString().slice(0, 10),
    priorStart:   priorStart.toISOString().slice(0, 10),
    priorEnd:     priorEnd.toISOString().slice(0, 10),
    trail90Start: trail90Start.toISOString().slice(0, 10),
    trail12Start: trail12Start.toISOString().slice(0, 10),
  };
}

function pctDelta(curr: number, prior: number): number | null {
  if (prior === 0) return null;
  return +(((curr - prior) / prior) * 100).toFixed(1);
}

export async function GET(req: NextRequest) {
  try {
    const w = parseMonth(req.nextUrl.searchParams.get('month'));

    // ── 1. Cover KPIs ─────────────────────────────────────────────────────
    const kpiCurr = await query<any>(
      `SELECT
         COALESCE((SELECT SUM(total_volume)  FROM sales      WHERE sale_date     >= $1 AND sale_date     < $2),    0)::NUMERIC AS volume,
         COALESCE((SELECT SUM(total_revenue) FROM sales      WHERE sale_date     >= $1 AND sale_date     < $2),    0)::NUMERIC AS revenue,
         COALESCE((SELECT SUM(net_cost)      FROM rm_invoices WHERE cost_center = 'retail' AND service_date >= $1 AND service_date < $2), 0)::NUMERIC AS rm_cost,
         (SELECT COUNT(*) FROM rm_helpdesk_tickets WHERE created_time::DATE >= $1 AND created_time::DATE < $2)::INT AS tickets`,
      [w.start, w.end],
    );
    const kpiPrior = await query<any>(
      `SELECT
         COALESCE((SELECT SUM(total_volume)  FROM sales      WHERE sale_date     >= $1 AND sale_date     < $2),    0)::NUMERIC AS volume,
         COALESCE((SELECT SUM(total_revenue) FROM sales      WHERE sale_date     >= $1 AND sale_date     < $2),    0)::NUMERIC AS revenue,
         COALESCE((SELECT SUM(net_cost)      FROM rm_invoices WHERE cost_center = 'retail' AND service_date >= $1 AND service_date < $2), 0)::NUMERIC AS rm_cost,
         (SELECT COUNT(*) FROM rm_helpdesk_tickets WHERE created_time::DATE >= $1 AND created_time::DATE < $2)::INT AS tickets`,
      [w.priorStart, w.priorEnd],
    );
    const c = kpiCurr[0] || {};
    const p = kpiPrior[0] || {};
    const cover = {
      monthLabel: w.monthLabel,
      generatedAt: new Date().toISOString(),
      volume:      { current: parseFloat(c.volume  || 0), prior: parseFloat(p.volume  || 0), deltaPct: pctDelta(parseFloat(c.volume  || 0), parseFloat(p.volume  || 0)) },
      revenue:     { current: parseFloat(c.revenue || 0), prior: parseFloat(p.revenue || 0), deltaPct: pctDelta(parseFloat(c.revenue || 0), parseFloat(p.revenue || 0)) },
      rmCost:      { current: parseFloat(c.rm_cost || 0), prior: parseFloat(p.rm_cost || 0), deltaPct: pctDelta(parseFloat(c.rm_cost || 0), parseFloat(p.rm_cost || 0)) },
      tickets:     { current: c.tickets || 0,              prior: p.tickets || 0,             deltaPct: pctDelta(c.tickets || 0, p.tickets || 0) },
      rmAsPctOfRevenueCurr:  parseFloat(c.revenue || 0) > 0 ? +(parseFloat(c.rm_cost || 0) / parseFloat(c.revenue || 0) * 100).toFixed(3) : null,
      rmAsPctOfRevenuePrior: parseFloat(p.revenue || 0) > 0 ? +(parseFloat(p.rm_cost || 0) / parseFloat(p.revenue || 0) * 100).toFixed(3) : null,
    };

    // ── 2. Cost section ───────────────────────────────────────────────────
    // 12-month trend of R&M cost + revenue (for ratio chart).
    // Use generate_series to ensure every month in the window is present even
    // when there's zero activity — line chart needs continuous x-axis.
    const trend = await query<any>(
      `WITH months AS (
         SELECT generate_series($1::DATE, $2::DATE - INTERVAL '1 day', INTERVAL '1 month')::DATE AS m
       ),
       inv AS (
         SELECT DATE_TRUNC('month', service_date)::DATE AS m, SUM(net_cost)::NUMERIC AS rm_cost
           FROM rm_invoices WHERE cost_center='retail' AND service_date >= $1 AND service_date < $2
          GROUP BY 1
       ),
       sal AS (
         SELECT DATE_TRUNC('month', sale_date)::DATE AS m,
                SUM(total_revenue)::NUMERIC AS revenue,
                SUM(total_volume)::NUMERIC AS volume
           FROM sales WHERE sale_date >= $1 AND sale_date < $2
          GROUP BY 1
       )
       SELECT TO_CHAR(months.m, 'YYYY-MM') AS period,
              COALESCE(inv.rm_cost,  0) AS rm_cost,
              COALESCE(sal.revenue,  0) AS revenue,
              COALESCE(sal.volume,   0) AS volume
         FROM months
         LEFT JOIN inv ON inv.m = months.m
         LEFT JOIN sal ON sal.m = months.m
        ORDER BY months.m`,
      [w.trail12Start, w.end],
    );

    // Top categories this month + prior month for MoM
    const catCurr = await query<any>(
      `SELECT c.slug, c.display_name, SUM(i.net_cost)::NUMERIC AS total
         FROM rm_invoices i
         LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE i.cost_center='retail' AND i.service_date >= $1 AND i.service_date < $2
        GROUP BY c.slug, c.display_name
        ORDER BY total DESC NULLS LAST
        LIMIT 8`,
      [w.start, w.end],
    );
    const catPrior = await query<any>(
      `SELECT c.slug, SUM(i.net_cost)::NUMERIC AS total
         FROM rm_invoices i
         LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE i.cost_center='retail' AND i.service_date >= $1 AND i.service_date < $2
        GROUP BY c.slug`,
      [w.priorStart, w.priorEnd],
    );
    const priorBySlug = new Map<string, number>();
    for (const r of catPrior) priorBySlug.set(r.slug, parseFloat(r.total || 0));

    const topCategories = catCurr.map(r => {
      const curr = parseFloat(r.total || 0);
      const prior = priorBySlug.get(r.slug) || 0;
      return {
        slug:         r.slug,
        displayName:  r.display_name || r.slug,
        current:      curr,
        prior,
        momDeltaPct:  pctDelta(curr, prior),
      };
    });

    const cost = {
      trend: trend.map(r => ({
        period:  r.period,
        rmCost:  parseFloat(r.rm_cost  || 0),
        revenue: parseFloat(r.revenue  || 0),
        rmAsPctOfRevenue: parseFloat(r.revenue || 0) > 0
          ? +(parseFloat(r.rm_cost || 0) / parseFloat(r.revenue || 0) * 100).toFixed(3)
          : null,
      })),
      topCategories,
    };

    // ── 3. Helpdesk section ───────────────────────────────────────────────
    const slaCurr = await query<any>(
      `SELECT
         COUNT(*) FILTER (WHERE resolution_status = 'Within SLA')::INT AS hits,
         COUNT(*) FILTER (WHERE resolution_status IS NOT NULL)::INT     AS total,
         AVG(resolution_minutes) FILTER (WHERE resolution_minutes IS NOT NULL) AS avg_res
        FROM rm_helpdesk_tickets
       WHERE created_time::DATE >= $1 AND created_time::DATE < $2`,
      [w.start, w.end],
    );
    const slaBaseline = await query<any>(
      `SELECT
         COUNT(*) FILTER (WHERE resolution_status = 'Within SLA')::INT AS hits,
         COUNT(*) FILTER (WHERE resolution_status IS NOT NULL)::INT     AS total,
         AVG(resolution_minutes) FILTER (WHERE resolution_minutes IS NOT NULL) AS avg_res
        FROM rm_helpdesk_tickets
       WHERE created_time::DATE >= $1 AND created_time::DATE < $2`,
      [w.trail90Start, w.start],
    );
    const openAtMonthEnd = await query<any>(
      `SELECT COALESCE(priority, 'Unspecified') AS priority, COUNT(*)::INT AS n
         FROM rm_helpdesk_tickets
        WHERE created_time::DATE < $1
          AND status NOT IN ('Closed', 'Resolved')
        GROUP BY 1 ORDER BY 2 DESC`,
      [w.end],
    );
    const contractors = await query<any>(
      `SELECT service_provider AS provider,
              COUNT(*)::INT AS ticket_count,
              AVG(resolution_minutes) FILTER (WHERE resolution_minutes IS NOT NULL) AS avg_res,
              ROUND(
                COUNT(*) FILTER (WHERE resolution_status = 'Within SLA')::NUMERIC
                / NULLIF(COUNT(*) FILTER (WHERE resolution_status IS NOT NULL), 0)
                * 100, 1
              ) AS sla_hit_pct
         FROM rm_helpdesk_tickets
        WHERE created_time::DATE >= $1 AND created_time::DATE < $2
          AND service_provider IS NOT NULL AND service_provider <> ''
        GROUP BY service_provider
        ORDER BY ticket_count DESC
        LIMIT 5`,
      [w.start, w.end],
    );
    const recurring = await query<any>(
      `SELECT t.description_norm,
              MIN(t.subject) AS sample_subject,
              COUNT(*)::INT AS count,
              c.display_name AS category_name
         FROM rm_helpdesk_tickets t
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE t.created_time::DATE >= $1 AND t.created_time::DATE < $2
        GROUP BY t.description_norm, c.display_name
        ORDER BY count DESC
        LIMIT 5`,
      [w.start, w.end],
    );

    const slaCurrRow = slaCurr[0] || {};
    const slaBaseRow = slaBaseline[0] || {};
    const helpdesk = {
      slaHitRate:        slaCurrRow.total > 0 ? +(slaCurrRow.hits / slaCurrRow.total * 100).toFixed(1) : null,
      slaHitRateBaseline: slaBaseRow.total > 0 ? +(slaBaseRow.hits / slaBaseRow.total * 100).toFixed(1) : null,
      avgResolutionMinutes:        slaCurrRow.avg_res != null ? Math.round(parseFloat(slaCurrRow.avg_res)) : null,
      avgResolutionMinutesPrior:   slaBaseRow.avg_res != null ? Math.round(parseFloat(slaBaseRow.avg_res)) : null,
      openAtMonthEnd: {
        total: openAtMonthEnd.reduce((acc, r) => acc + r.n, 0),
        byPriority: Object.fromEntries(openAtMonthEnd.map(r => [r.priority, r.n])),
      },
      topContractors: contractors.map(r => ({
        provider:             r.provider,
        ticketCount:          r.ticket_count,
        avgResolutionMinutes: r.avg_res != null ? Math.round(parseFloat(r.avg_res)) : null,
        slaHitPct:            r.sla_hit_pct != null ? parseFloat(r.sla_hit_pct) : null,
      })),
      topRecurring: recurring.map(r => ({
        descriptionNorm: r.description_norm,
        sampleSubject:   r.sample_subject,
        count:           r.count,
        categoryName:    r.category_name,
      })),
    };

    // ── 4. Sites section ──────────────────────────────────────────────────
    // Per-site totals this month
    const sitesAgg = await query<any>(
      `WITH inv AS (
         SELECT site_code, SUM(net_cost)::NUMERIC AS rm_cost
           FROM rm_invoices
          WHERE cost_center='retail' AND service_date >= $1 AND service_date < $2
          GROUP BY 1
       ),
       sal AS (
         SELECT site_code, SUM(total_volume)::NUMERIC AS volume
           FROM sales
          WHERE sale_date >= $1 AND sale_date < $2
          GROUP BY 1
       ),
       tkt AS (
         SELECT site_code, COUNT(*)::INT AS ticket_count
           FROM rm_helpdesk_tickets
          WHERE created_time::DATE >= $1 AND created_time::DATE < $2
          GROUP BY 1
       )
       SELECT s.site_code,
              s.budget_name AS site_name,
              COALESCE(inv.rm_cost, 0)     AS rm_cost,
              COALESCE(sal.volume, 0)      AS volume,
              COALESCE(tkt.ticket_count, 0) AS ticket_count,
              CASE WHEN COALESCE(sal.volume, 0) > 0
                   THEN ROUND(COALESCE(inv.rm_cost, 0) / sal.volume, 4)
                   ELSE NULL END AS rm_per_litre
         FROM sites s
         LEFT JOIN inv ON inv.site_code = s.site_code
         LEFT JOIN sal ON sal.site_code = s.site_code
         LEFT JOIN tkt ON tkt.site_code = s.site_code
        WHERE COALESCE(inv.rm_cost,0) + COALESCE(sal.volume,0) + COALESCE(tkt.ticket_count,0) > 0`,
      [w.start, w.end],
    );

    const efficientCandidates = sitesAgg.filter(r => parseFloat(r.rm_per_litre || 'NaN') === parseFloat(r.rm_per_litre || 'NaN') && parseFloat(r.rm_cost) > 0);
    const topEfficient = [...efficientCandidates]
      .sort((a, b) => parseFloat(a.rm_per_litre) - parseFloat(b.rm_per_litre))
      .slice(0, 5);
    const bottomEfficient = [...efficientCandidates]
      .sort((a, b) => parseFloat(b.rm_per_litre) - parseFloat(a.rm_per_litre))
      .slice(0, 5);

    const preventiveOnly = sitesAgg
      .filter(r => parseFloat(r.rm_cost) > 0 && r.ticket_count === 0)
      .sort((a, b) => parseFloat(b.rm_cost) - parseFloat(a.rm_cost))
      .slice(0, 5);
    const unbilledOnly = sitesAgg
      .filter(r => parseFloat(r.rm_cost) === 0 && r.ticket_count > 0)
      .sort((a, b) => b.ticket_count - a.ticket_count)
      .slice(0, 5);

    const sites = {
      topEfficient: topEfficient.map(r => ({
        siteCode:    r.site_code,
        siteName:    r.site_name,
        volume:      parseFloat(r.volume),
        rmCost:      parseFloat(r.rm_cost),
        rmPerLitre:  parseFloat(r.rm_per_litre),
      })),
      bottomEfficient: bottomEfficient.map(r => ({
        siteCode:    r.site_code,
        siteName:    r.site_name,
        volume:      parseFloat(r.volume),
        rmCost:      parseFloat(r.rm_cost),
        rmPerLitre:  parseFloat(r.rm_per_litre),
      })),
      preventiveOnly: preventiveOnly.map(r => ({
        siteCode: r.site_code,
        siteName: r.site_name,
        rmCost:   parseFloat(r.rm_cost),
      })),
      unbilledOnly: unbilledOnly.map(r => ({
        siteCode:    r.site_code,
        siteName:    r.site_name,
        ticketCount: r.ticket_count,
      })),
    };

    // ── 5. Action items ───────────────────────────────────────────────────
    // Outlier cells: per-category cost-per-ticket z-scores from this month's cells
    const outlierRows = await query<any>(
      `WITH invoice_agg AS (
         SELECT i.site_code, c.slug AS category_slug, c.display_name AS category_name,
                SUM(i.net_cost)::NUMERIC AS invoice_cost
           FROM rm_invoices i
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE i.cost_center='retail' AND i.service_date >= $1 AND i.service_date < $2
          GROUP BY 1, 2, 3
       ),
       ticket_agg AS (
         SELECT t.site_code, c.slug AS category_slug, COUNT(*)::INT AS ticket_count
           FROM rm_helpdesk_tickets t
           LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE t.created_time::DATE >= $1 AND t.created_time::DATE < $2
          GROUP BY 1, 2
       ),
       cells AS (
         SELECT i.site_code, i.category_slug, i.category_name,
                i.invoice_cost,
                COALESCE(t.ticket_count, 0) AS ticket_count,
                CASE WHEN COALESCE(t.ticket_count, 0) > 0
                     THEN i.invoice_cost / t.ticket_count
                     ELSE NULL END AS cpt
           FROM invoice_agg i
           LEFT JOIN ticket_agg t ON t.site_code = i.site_code AND t.category_slug = i.category_slug
       ),
       cat_stats AS (
         SELECT category_slug, AVG(cpt) AS mu, STDDEV_SAMP(cpt) AS sd
           FROM cells
          WHERE cpt IS NOT NULL
          GROUP BY category_slug
         HAVING COUNT(*) >= 2 AND STDDEV_SAMP(cpt) > 0
       )
       SELECT cells.site_code,
              s.budget_name AS site_name,
              cells.category_slug,
              cells.category_name,
              ROUND(cells.cpt, 2)               AS cost_per_ticket,
              ROUND(cat_stats.mu, 2)            AS category_mean,
              ROUND((cells.cpt - cat_stats.mu) / cat_stats.sd, 2) AS z_score
         FROM cells
         JOIN cat_stats USING (category_slug)
         JOIN sites s ON s.site_code = cells.site_code
        WHERE cells.cpt IS NOT NULL
          AND (cells.cpt - cat_stats.mu) / cat_stats.sd > 2.5
        ORDER BY z_score DESC
        LIMIT 10`,
      [w.start, w.end],
    );

    const longOpen = await query<any>(
      `SELECT t.ticket_id, t.site_code, s.budget_name AS site_name,
              t.priority, t.created_time, t.subject,
              EXTRACT(EPOCH FROM (NOW() - t.created_time))::INT / 86400 AS days_open
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
        WHERE t.status NOT IN ('Closed', 'Resolved')
          AND EXTRACT(EPOCH FROM (NOW() - t.created_time)) / 86400 > 30
        ORDER BY t.created_time ASC
        LIMIT 5`,
      [],
    );
    const longOpenCount = await query<any>(
      `SELECT
         COUNT(*)::INT AS total,
         COUNT(*) FILTER (WHERE priority = 'Urgent')::INT AS urgent
         FROM rm_helpdesk_tickets
        WHERE status NOT IN ('Closed', 'Resolved')
          AND EXTRACT(EPOCH FROM (NOW() - created_time)) / 86400 > 30`,
      [],
    );

    const slaViolated = await query<any>(
      `SELECT COUNT(*)::INT AS total,
              (SELECT site_code FROM rm_helpdesk_tickets
                WHERE resolution_status='SLA Violated' AND created_time::DATE >= $1 AND created_time::DATE < $2
                GROUP BY site_code ORDER BY COUNT(*) DESC LIMIT 1) AS top_site_1,
              (SELECT site_code FROM rm_helpdesk_tickets
                WHERE resolution_status='SLA Violated' AND created_time::DATE >= $1 AND created_time::DATE < $2
                GROUP BY site_code ORDER BY COUNT(*) DESC OFFSET 1 LIMIT 1) AS top_site_2
         FROM rm_helpdesk_tickets
        WHERE resolution_status='SLA Violated' AND created_time::DATE >= $1 AND created_time::DATE < $2`,
      [w.start, w.end],
    );

    const actionItems = {
      outliers: outlierRows.map(r => ({
        siteCode:      r.site_code,
        siteName:      r.site_name,
        categorySlug:  r.category_slug,
        categoryName:  r.category_name,
        costPerTicket: parseFloat(r.cost_per_ticket),
        categoryMean:  parseFloat(r.category_mean),
        zScore:        parseFloat(r.z_score),
      })),
      longOpenTickets: {
        total:    longOpenCount[0]?.total || 0,
        urgent:   longOpenCount[0]?.urgent || 0,
        examples: longOpen.map(r => ({
          ticketId:    r.ticket_id,
          siteCode:    r.site_code,
          siteName:    r.site_name,
          priority:    r.priority,
          createdTime: r.created_time,
          daysOpen:    r.days_open,
          subject:     r.subject,
        })),
      },
      slaViolated: {
        total:        slaViolated[0]?.total || 0,
        topSite1:     slaViolated[0]?.top_site_1 ?? null,
        topSite2:     slaViolated[0]?.top_site_2 ?? null,
      },
    };

    return NextResponse.json({
      data: { window: w, cover, cost, helpdesk, sites, actionItems },
    });
  } catch (err: any) {
    console.error('/api/executive/monthly error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Wait for ✓ Ready. Then:

```bash
curl -s 'http://localhost:3000/api/executive/monthly?month=2026-04' | head -c 1500
```

Expected: JSON with `data.window`, `data.cover`, `data.cost`, `data.helpdesk`, `data.sites`, `data.actionItems`. The cover should have non-zero volume/revenue figures.

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/executive/monthly/route.ts
git commit -m "feat: add GET /api/executive/monthly returning all 5 report sections"
```

---

## Task 2: ReportCover component

**Files:**
- Create: `components/exec/ReportCover.tsx`

- [ ] **Step 1: Implement**

Create `components/exec/ReportCover.tsx`:

```tsx
'use client';

interface KpiBlock { current: number; prior: number; deltaPct: number | null; }

interface CoverData {
  monthLabel:            string;
  generatedAt:           string;
  volume:                KpiBlock;
  revenue:               KpiBlock;
  rmCost:                KpiBlock;
  tickets:               KpiBlock;
  rmAsPctOfRevenueCurr:  number | null;
  rmAsPctOfRevenuePrior: number | null;
}

function fmtNumber(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function DeltaArrow({ delta, goodWhen = 'up' }: { delta: number | null; goodWhen?: 'up' | 'down' | 'neutral' }) {
  if (delta == null) return <span className="text-gray-400 text-xs">— no prior</span>;
  const up = delta > 0;
  const good = (goodWhen === 'up' && up) || (goodWhen === 'down' && !up);
  const cls = goodWhen === 'neutral' ? 'text-gray-600' : (good ? 'text-emerald-600' : 'text-red-600');
  const arrow = up ? '▲' : '▼';
  return <span className={`text-xs font-semibold ${cls}`}>{arrow} {Math.abs(delta).toFixed(1)}% MoM</span>;
}

function KpiCard({ label, valueDisplay, delta, goodWhen }: {
  label: string; valueDisplay: string; delta: number | null; goodWhen: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="card flex-1 min-w-[180px]">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-800 mt-1">{valueDisplay}</div>
      <div className="mt-1"><DeltaArrow delta={delta} goodWhen={goodWhen} /></div>
    </div>
  );
}

export default function ReportCover({ data }: { data: CoverData }) {
  const ratioDelta = (data.rmAsPctOfRevenueCurr != null && data.rmAsPctOfRevenuePrior != null && data.rmAsPctOfRevenuePrior !== 0)
    ? +(data.rmAsPctOfRevenueCurr - data.rmAsPctOfRevenuePrior).toFixed(3)
    : null;

  return (
    <section className="page-section">
      <div className="border-b pb-4 mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Redan Sales Dashboard</h1>
        <p className="text-sm text-gray-600">Monthly Operations Report</p>
        <p className="text-3xl font-bold text-gray-800 mt-3">{data.monthLabel}</p>
        <p className="text-xs text-gray-400 mt-1">Generated {new Date(data.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <KpiCard label="Volume L"  valueDisplay={`${fmtNumber(data.volume.current)} L`} delta={data.volume.deltaPct}  goodWhen="up" />
        <KpiCard label="Revenue"   valueDisplay={fmtMoney(data.revenue.current)}        delta={data.revenue.deltaPct} goodWhen="up" />
        <KpiCard label="R&M Cost"  valueDisplay={fmtMoney(data.rmCost.current)}         delta={data.rmCost.deltaPct}  goodWhen="down" />
        <KpiCard label="Tickets"   valueDisplay={fmtNumber(data.tickets.current)}       delta={data.tickets.deltaPct} goodWhen="neutral" />
      </div>

      <div className="rounded border border-gray-200 bg-gray-50 px-4 py-3">
        <span className="text-sm font-semibold text-gray-700">R&amp;M as % of revenue:</span>{' '}
        <span className="text-sm font-bold text-gray-900">
          {data.rmAsPctOfRevenueCurr != null ? `${data.rmAsPctOfRevenueCurr}%` : '—'}
        </span>{' '}
        {ratioDelta != null && (
          <span className={`text-xs ${ratioDelta < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            ({ratioDelta < 0 ? '▼' : '▲'} from {data.rmAsPctOfRevenuePrior}% prior month)
          </span>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/exec/ReportCover.tsx
git commit -m "feat: add ReportCover component (KPIs + MoM deltas)"
```

---

## Task 3: CostSection component

**Files:**
- Create: `components/exec/CostSection.tsx`

- [ ] **Step 1: Implement**

Create `components/exec/CostSection.tsx`:

```tsx
'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface TrendPoint {
  period:           string;
  rmCost:           number;
  revenue:          number;
  rmAsPctOfRevenue: number | null;
}

interface CategoryRow {
  slug:        string;
  displayName: string;
  current:     number;
  prior:       number;
  momDeltaPct: number | null;
}

interface CostData {
  trend:         TrendPoint[];
  topCategories: CategoryRow[];
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function CostSection({ data }: { data: CostData }) {
  return (
    <section className="page-section break-before-page">
      <h2 className="text-lg font-bold text-gray-900 mb-4">R&amp;M Cost Justification</h2>

      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">R&amp;M Cost Trend (12 months)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.trend} margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
            <CartesianGrid stroke="#f3f4f6" />
            <XAxis dataKey="period" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmtMoney(v)} />
            <Line type="monotone" dataKey="rmCost" stroke="#1e3a5f" strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">R&amp;M as % of Revenue (12 months)</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data.trend} margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
            <CartesianGrid stroke="#f3f4f6" />
            <XAxis dataKey="period" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={v => `${v}%`} />
            <Tooltip formatter={(v: number | null) => v != null ? `${v}%` : '—'} />
            <Line type="monotone" dataKey="rmAsPctOfRevenue" stroke="#2563eb" strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Top categories this month</h3>
        <table className="w-full text-xs border-t">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-1 text-left">Category</th>
              <th className="px-3 py-1 text-right">Current</th>
              <th className="px-3 py-1 text-right">Prior month</th>
              <th className="px-3 py-1 text-right">MoM Δ</th>
            </tr>
          </thead>
          <tbody>
            {data.topCategories.map(c => (
              <tr key={c.slug} className="border-t">
                <td className="px-3 py-1">{c.displayName}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(c.current)}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(c.prior)}</td>
                <td className="px-3 py-1 text-right tabular-nums">
                  {c.momDeltaPct == null
                    ? '—'
                    : <span className={c.momDeltaPct > 0 ? 'text-red-600' : 'text-emerald-600'}>
                        {c.momDeltaPct > 0 ? '▲' : '▼'} {Math.abs(c.momDeltaPct).toFixed(1)}%
                      </span>}
                </td>
              </tr>
            ))}
            {data.topCategories.length === 0 && (
              <tr><td colSpan={4} className="text-center py-3 text-gray-500 italic">No R&amp;M spend this month</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/exec/CostSection.tsx
git commit -m "feat: add CostSection component (12-month trend + top categories)"
```

---

## Task 4: HelpdeskSection component

**Files:**
- Create: `components/exec/HelpdeskSection.tsx`

- [ ] **Step 1: Implement**

Create `components/exec/HelpdeskSection.tsx`:

```tsx
'use client';

interface ContractorRow {
  provider:             string;
  ticketCount:          number;
  avgResolutionMinutes: number | null;
  slaHitPct:            number | null;
}

interface RecurringRow {
  descriptionNorm: string;
  sampleSubject:   string;
  count:           number;
  categoryName:    string | null;
}

interface HelpdeskData {
  slaHitRate:                number | null;
  slaHitRateBaseline:        number | null;
  avgResolutionMinutes:      number | null;
  avgResolutionMinutesPrior: number | null;
  openAtMonthEnd:            { total: number; byPriority: Record<string, number> };
  topContractors:            ContractorRow[];
  topRecurring:              RecurringRow[];
}

function fmtHours(mins: number | null) {
  if (mins == null) return '—';
  const hrs = mins / 60;
  if (hrs < 24) return `${hrs.toFixed(1)} h`;
  return `${(hrs / 24).toFixed(1)} d`;
}

function pctPoints(curr: number | null, baseline: number | null) {
  if (curr == null || baseline == null) return null;
  return +(curr - baseline).toFixed(1);
}

export default function HelpdeskSection({ data }: { data: HelpdeskData }) {
  const slaDelta = pctPoints(data.slaHitRate, data.slaHitRateBaseline);
  const resDelta = (data.avgResolutionMinutes != null && data.avgResolutionMinutesPrior != null)
    ? data.avgResolutionMinutes - data.avgResolutionMinutesPrior
    : null;

  return (
    <section className="page-section break-before-page">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Helpdesk Performance</h2>

      <div className="space-y-2 mb-6">
        <div className="text-sm">
          <span className="font-semibold">SLA Hit Rate: </span>
          <span className="font-bold">{data.slaHitRate != null ? `${data.slaHitRate}%` : 'N/A'}</span>
          {slaDelta != null && (
            <span className={`ml-2 text-xs ${slaDelta > 0 ? 'text-emerald-600' : slaDelta < 0 ? 'text-red-600' : 'text-gray-600'}`}>
              {slaDelta > 0 ? '▲' : slaDelta < 0 ? '▼' : '—'} {Math.abs(slaDelta)}pp vs prior 90-day avg
            </span>
          )}
        </div>
        <div className="text-sm">
          <span className="font-semibold">Avg Resolution Time: </span>
          <span className="font-bold">{fmtHours(data.avgResolutionMinutes)}</span>
          {resDelta != null && (
            <span className={`ml-2 text-xs ${resDelta < 0 ? 'text-emerald-600' : resDelta > 0 ? 'text-red-600' : 'text-gray-600'}`}>
              {resDelta < 0 ? '▼' : resDelta > 0 ? '▲' : '—'} {fmtHours(Math.abs(resDelta))} vs prior month
            </span>
          )}
        </div>
        <div className="text-sm">
          <span className="font-semibold">Open at Month-End: </span>
          <span className="font-bold">{data.openAtMonthEnd.total} tickets</span>
          {data.openAtMonthEnd.byPriority['Urgent'] > 0 && (
            <span className="ml-2 text-xs text-red-600">({data.openAtMonthEnd.byPriority['Urgent']} Urgent)</span>
          )}
        </div>
      </div>

      <div className="mb-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Top 5 Contractors</h3>
        <table className="w-full text-xs border-t">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-1 text-left">Provider</th>
              <th className="px-3 py-1 text-right">Tickets</th>
              <th className="px-3 py-1 text-right">Avg Resolution</th>
              <th className="px-3 py-1 text-right">SLA Hit %</th>
            </tr>
          </thead>
          <tbody>
            {data.topContractors.map(c => (
              <tr key={c.provider} className="border-t">
                <td className="px-3 py-1">{c.provider}</td>
                <td className="px-3 py-1 text-right tabular-nums">{c.ticketCount}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtHours(c.avgResolutionMinutes)}</td>
                <td className="px-3 py-1 text-right tabular-nums">{c.slaHitPct != null ? `${c.slaHitPct}%` : '—'}</td>
              </tr>
            ))}
            {data.topContractors.length === 0 && (
              <tr><td colSpan={4} className="text-center py-3 text-gray-500 italic">No contractor activity this month</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Top Recurring Problems</h3>
        <ol className="list-decimal pl-6 text-xs space-y-1">
          {data.topRecurring.map(r => (
            <li key={r.descriptionNorm}>
              {r.sampleSubject} <span className="text-gray-500">×{r.count} ({r.categoryName || 'Uncategorised'})</span>
            </li>
          ))}
          {data.topRecurring.length === 0 && (
            <li className="text-gray-500 italic list-none">No tickets opened this month</li>
          )}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/exec/HelpdeskSection.tsx
git commit -m "feat: add HelpdeskSection component (SLA + contractors + recurring)"
```

---

## Task 5: SitesSection component

**Files:**
- Create: `components/exec/SitesSection.tsx`

- [ ] **Step 1: Implement**

Create `components/exec/SitesSection.tsx`:

```tsx
'use client';

interface SiteEffRow {
  siteCode:    string;
  siteName:    string;
  volume:      number;
  rmCost:      number;
  rmPerLitre:  number;
}

interface PreventiveRow { siteCode: string; siteName: string; rmCost: number; }
interface UnbilledRow   { siteCode: string; siteName: string; ticketCount: number; }

interface SitesData {
  topEfficient:    SiteEffRow[];
  bottomEfficient: SiteEffRow[];
  preventiveOnly:  PreventiveRow[];
  unbilledOnly:    UnbilledRow[];
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtVolume(n: number) {
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} L`;
}

function fmtRatio(n: number) {
  return `$${n.toFixed(4)}`;
}

function EfficiencyTable({ rows, label }: { rows: SiteEffRow[]; label: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{label}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No qualifying sites this month</p>
      ) : (
        <table className="w-full text-xs border-t">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-1 text-left">Site</th>
              <th className="px-3 py-1 text-right">Volume</th>
              <th className="px-3 py-1 text-right">R&amp;M Cost</th>
              <th className="px-3 py-1 text-right">$ / Litre</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.siteCode} className="border-t">
                <td className="px-3 py-1">{r.siteName}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtVolume(r.volume)}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtMoney(r.rmCost)}</td>
                <td className="px-3 py-1 text-right tabular-nums">{fmtRatio(r.rmPerLitre)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function SitesSection({ data }: { data: SitesData }) {
  return (
    <section className="page-section break-before-page">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Site Analysis</h2>

      <EfficiencyTable rows={data.topEfficient}    label="Top 5 — Most Efficient (lowest R&M $ per litre)" />
      <EfficiencyTable rows={data.bottomEfficient} label="Bottom 5 — Needs Attention (highest R&M $ per litre)" />

      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Operational Gaps</h3>
        <div className="text-xs">
          <p className="mb-1"><span className="font-semibold">Sites with R&amp;M cost but no tickets (preventive / scheduled):</span></p>
          {data.preventiveOnly.length === 0 ? (
            <p className="text-gray-500 italic mb-2">None</p>
          ) : (
            <ul className="list-disc pl-6 mb-2">
              {data.preventiveOnly.map(r => (
                <li key={r.siteCode}>{r.siteName} ({fmtMoney(r.rmCost)})</li>
              ))}
            </ul>
          )}
          <p className="mb-1"><span className="font-semibold">Sites with tickets but no invoices (in-house / unbilled):</span></p>
          {data.unbilledOnly.length === 0 ? (
            <p className="text-gray-500 italic">None</p>
          ) : (
            <ul className="list-disc pl-6">
              {data.unbilledOnly.map(r => (
                <li key={r.siteCode}>{r.siteName} ({r.ticketCount} tickets)</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/exec/SitesSection.tsx
git commit -m "feat: add SitesSection component (efficiency rankings + gaps)"
```

---

## Task 6: ActionItemsSection component

**Files:**
- Create: `components/exec/ActionItemsSection.tsx`

- [ ] **Step 1: Implement**

Create `components/exec/ActionItemsSection.tsx`:

```tsx
'use client';

interface OutlierRow {
  siteCode:      string;
  siteName:      string;
  categorySlug:  string;
  categoryName:  string;
  costPerTicket: number;
  categoryMean:  number;
  zScore:        number;
}

interface LongOpenExample {
  ticketId:    number;
  siteCode:    string;
  siteName:    string;
  priority:    string | null;
  createdTime: string;
  daysOpen:    number;
  subject:     string;
}

interface ActionItemsData {
  outliers: OutlierRow[];
  longOpenTickets: {
    total:    number;
    urgent:   number;
    examples: LongOpenExample[];
  };
  slaViolated: {
    total:    number;
    topSite1: string | null;
    topSite2: string | null;
  };
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function ActionItemsSection({ data }: { data: ActionItemsData }) {
  return (
    <section className="page-section break-before-page">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Action Items</h2>

      <div className="mb-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Outlier cells (cost/ticket &gt; 2.5σ above category mean)
        </h3>
        {data.outliers.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No significant outliers this month</p>
        ) : (
          <ul className="text-xs space-y-1">
            {data.outliers.map(o => (
              <li key={`${o.siteCode}|${o.categorySlug}`}>
                • <strong>{o.siteName}</strong> · {o.categoryName}{'  '}
                <span className="font-mono">{fmtMoney(o.costPerTicket)}</span>/ticket
                <span className="text-gray-500"> (cat mean {fmtMoney(o.categoryMean)})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Tickets open &gt; 30 days
        </h3>
        {data.longOpenTickets.total === 0 ? (
          <p className="text-xs text-gray-500 italic">No tickets stuck open beyond 30 days</p>
        ) : (
          <>
            <p className="text-xs mb-1">
              <strong>{data.longOpenTickets.total} total</strong>
              {data.longOpenTickets.urgent > 0 && (
                <span className="text-red-600">, {data.longOpenTickets.urgent} Urgent</span>
              )}
            </p>
            <ul className="text-xs space-y-1">
              {data.longOpenTickets.examples.map(e => (
                <li key={e.ticketId}>
                  • <span className="font-mono">#{e.ticketId}</span>{'  '}
                  {e.siteName}{'  '}
                  <span className="text-gray-600">{e.subject}</span>
                  <span className="text-gray-500"> ({e.daysOpen} days)</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">SLA violated this month</h3>
        {data.slaViolated.total === 0 ? (
          <p className="text-xs text-gray-500 italic">No SLA violations this month</p>
        ) : (
          <p className="text-xs">
            <strong>{data.slaViolated.total} tickets</strong>{' '}
            {(data.slaViolated.topSite1 || data.slaViolated.topSite2) && (
              <span className="text-gray-600">
                · Most-affected sites: {[data.slaViolated.topSite1, data.slaViolated.topSite2].filter(Boolean).join(', ')}
              </span>
            )}
          </p>
        )}
      </div>

      <p className="mt-6 text-[10px] text-gray-400 italic">
        Categories reflect current classification. Outliers, long-open ticket counts, and SLA breach lists are
        computed from the data at report-generation time.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add components/exec/ActionItemsSection.tsx
git commit -m "feat: add ActionItemsSection component (outliers + long-open + SLA breaches)"
```

---

## Task 7: Page + Generate PDF + tab links

**Files:**
- Create: `app/dashboard/monthly-report/page.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: `app/dashboard/maintenance/page.tsx`
- Modify: `app/dashboard/maintenance/rules/page.tsx`
- Modify: `app/dashboard/helpdesk/page.tsx`
- Modify: `app/dashboard/cost-analysis/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/dashboard/monthly-report/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ReportCover from '@/components/exec/ReportCover';
import CostSection from '@/components/exec/CostSection';
import HelpdeskSection from '@/components/exec/HelpdeskSection';
import SitesSection from '@/components/exec/SitesSection';
import ActionItemsSection from '@/components/exec/ActionItemsSection';

function defaultMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth();
  const prevY = m0 === 0 ? y - 1 : y;
  const prevM = m0 === 0 ? 12 : m0;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6 flex-shrink-0">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}

export default function MonthlyReportPage() {
  const router = useRouter();
  const [month, setMonth] = useState<string>(defaultMonth());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const fetchReport = useCallback(async (m: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/executive/monthly?month=${m}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json?.data || null);
    } catch (e: any) {
      setError(e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReport(month); }, [month, fetchReport]);

  const handleGeneratePDF = async () => {
    const root = document.getElementById('exec-report-root');
    if (!root) return;
    setGenerating(true);
    try {
      const mod = await import('html2pdf.js');
      const html2pdf = (mod as any).default ?? mod;
      await html2pdf().set({
        margin: 8,
        filename: `Redan-Monthly-Report-${month}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(root).save();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <DocIcon />
            <div>
              <h1 className="text-base font-bold tracking-wide leading-tight">Redan Sales Dashboard</h1>
              <p className="text-[11px]" style={{ color: '#93c5fd' }}>Monthly Report</p>
            </div>
          </div>
          <button onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); router.push('/login'); }}
                  className="text-xs text-white/60 hover:text-white px-2 py-1.5 rounded-md transition">
            Sign out
          </button>
        </div>

        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"                     className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <Link href="/dashboard/maintenance"         className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Maintenance</Link>
          <Link href="/dashboard/maintenance/rules"   className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Rules</Link>
          <Link href="/dashboard/helpdesk"            className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Helpdesk</Link>
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Monthly Report</span>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <div className="card flex flex-wrap gap-3 items-end justify-between">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Month</label>
              <input type="month" value={month}
                     onChange={e => setMonth(e.target.value || defaultMonth())}
                     className="text-sm border rounded px-2 py-1" />
            </div>
            <button onClick={() => fetchReport(month)}
                    className="text-xs font-medium bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-300">
              Refresh
            </button>
          </div>
          <button onClick={handleGeneratePDF}
                  disabled={loading || !!error || generating}
                  className="text-xs font-medium bg-[#1e3a5f] text-white px-4 py-2 rounded-md hover:bg-[#162a45] disabled:opacity-50">
            {generating ? 'Generating PDF…' : '📄 Generate PDF'}
          </button>
        </div>

        {loading && (
          <div className="card mt-5 text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-400">Loading report…</p>
          </div>
        )}

        {error && !loading && (
          <div className="card mt-5 text-center py-12 border border-red-200 bg-red-50">
            <p className="text-sm text-red-700 mb-3">Could not load report: {error}</p>
            <button onClick={() => fetchReport(month)}
                    className="text-sm bg-red-600 text-white px-3 py-1 rounded">Retry</button>
          </div>
        )}

        {!loading && !error && data && (
          <div id="exec-report-root" className="mt-5 bg-white rounded-md shadow-sm p-8">
            <ReportCover         data={data.cover} />
            <CostSection         data={data.cost} />
            <HelpdeskSection     data={data.helpdesk} />
            <SitesSection        data={data.sites} />
            <ActionItemsSection  data={data.actionItems} />
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Add Monthly Report tab link to 5 sister pages**

In `app/dashboard/page.tsx`, find the existing Cost Analysis link in the tab bar:

```tsx
          <Link
            href="/dashboard/cost-analysis"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
          >
            Cost Analysis
          </Link>
        </div>
      </header>
```

Replace with:

```tsx
          <Link
            href="/dashboard/cost-analysis"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
          >
            Cost Analysis
          </Link>
          <Link
            href="/dashboard/monthly-report"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all"
          >
            Monthly Report
          </Link>
        </div>
      </header>
```

In `app/dashboard/maintenance/page.tsx`, find:

```tsx
          <Link href="/dashboard/cost-analysis" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
```

Replace with:

```tsx
          <Link href="/dashboard/cost-analysis" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
          <Link href="/dashboard/monthly-report" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Monthly Report</Link>
        </div>
```

In `app/dashboard/maintenance/rules/page.tsx`, find:

```tsx
          <Link href="/dashboard/cost-analysis" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
```

Replace with:

```tsx
          <Link href="/dashboard/cost-analysis" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
          <Link href="/dashboard/monthly-report" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Monthly Report</Link>
        </div>
```

In `app/dashboard/helpdesk/page.tsx`, find:

```tsx
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
```

Replace with:

```tsx
          <Link href="/dashboard/cost-analysis"       className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
          <Link href="/dashboard/monthly-report"      className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Monthly Report</Link>
        </div>
```

In `app/dashboard/cost-analysis/page.tsx`, find:

```tsx
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Cost Analysis</span>
        </div>
```

Replace with:

```tsx
          <span                                       className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Cost Analysis</span>
          <Link href="/dashboard/monthly-report"      className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Monthly Report</Link>
        </div>
```

- [ ] **Step 3: Typecheck and smoke test**

```bash
npx tsc --noEmit
npm run dev
```

Then in another terminal:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard/monthly-report
```

Expected: 200 or 307 (redirect to login).

Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/monthly-report/page.tsx \
        app/dashboard/page.tsx \
        app/dashboard/maintenance/page.tsx \
        app/dashboard/maintenance/rules/page.tsx \
        app/dashboard/helpdesk/page.tsx \
        app/dashboard/cost-analysis/page.tsx
git commit -m "feat: add /dashboard/monthly-report page + Monthly Report tab on 5 sister pages"
```

---

## Task 8: End-to-end smoke test on production

**Files:**
- None (manual verification)

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/monthly-exec-report
gh pr create --title "feat: monthly executive report (5-section PDF)" \
  --body "Implements docs/superpowers/specs/2026-05-15-monthly-executive-report-design.md - new /dashboard/monthly-report page with month picker + Generate PDF, returning a polished 5-section A4-portrait PDF for management."
```

Merge via GitHub UI. Vercel deploys automatically.

- [ ] **Step 2: Generate a report on production**

Open `/dashboard/monthly-report` on the live URL. Confirm:
- Month picker defaults to previous calendar month.
- All 5 sections render below the controls.
- KPI cards show non-zero numbers with MoM deltas.
- Trend charts render in CostSection.
- Helpdesk SLA stats appear.
- Site analysis lists top/bottom efficient sites.
- Action items section shows outliers and long-open tickets.

- [ ] **Step 3: Generate PDF**

Click **Generate PDF**. After 3-8 seconds, a file `Redan-Monthly-Report-YYYY-MM.pdf` downloads. Open it and confirm:
- 5 pages, A4 portrait.
- Each section is on its own page (page breaks honored).
- Charts render clearly (not pixelated).
- Tables are readable.
- No UI controls (Generate button, tab strip) appear in the PDF.

- [ ] **Step 4: Test month switching**

Pick a different month (e.g., March 2026). The page refetches and all sections update. Generate PDF again — the filename reflects the new month.

- [ ] **Step 5: Verify tab links**

Visit each of: Sales Dashboard, Maintenance, Rules, Helpdesk, Cost Analysis. Confirm Monthly Report link exists in each header and routes correctly.

- [ ] **Step 6: Report any anomalies**

Note any section that renders empty when it shouldn't, any PDF rendering glitches (charts cut off, tables overflowing), any tab link missing.
