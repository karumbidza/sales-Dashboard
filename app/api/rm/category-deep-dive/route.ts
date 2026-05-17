// app/api/rm/category-deep-dive/route.ts
// Per-category technical deep-dive feeding /dashboard/category/[slug].
// One endpoint, one response, multiple sections + a deterministic
// recommendations engine. Each rule shows the trigger so a manager can
// audit it; AI summaries are intentionally avoided.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Kpi {
  ticketCount:  number;
  totalCost:    number;
  sitesAffected: number;
  mttrHours:    number | null;
  openPct:      number;
  prior:        { ticketCount: number; totalCost: number };
}

interface TrendPoint {
  month:    string;          // YYYY-MM
  tickets:  number;
  cost:     number;
}

interface SiteRow {
  siteCode:    string;
  siteName:    string;
  tickets:     number;
  cost:        number;
  mttrHours:   number | null;
  openCount:   number;
  repeatFlag:  boolean;        // ≥ 5 in window
}

interface DescriptionRow {
  descriptionNorm: string;
  sampleSubject:   string;
  count:           number;
  pctOfCategory:   number;
}

interface ProviderRow {
  provider:    string;
  tickets:     number;
  mttrHours:   number | null;
  closedPct:   number;
}

interface StatusRow {
  status:  string;
  count:   number;
}

type Severity = 'high' | 'medium' | 'low';

interface Recommendation {
  ruleId:   string;
  severity: Severity;
  title:    string;
  detail:   string;
  trigger:  string;
  link?:    { label: string; href: string };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const slug      = sp.get('slug') || '';
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

    const today    = new Date().toISOString().slice(0, 10);
    const year     = new Date().getUTCFullYear();
    const dateFrom = sp.get('dateFrom') || `${year}-01-01`;
    const dateTo   = sp.get('dateTo')   || today;
    const territory = sp.get('territory') || '';
    const siteCode  = sp.get('siteCode')  || '';

    // Confirm the category exists and grab its display name.
    const catRows = await query<{ id: number; slug: string; display_name: string }>(
      `SELECT id, slug, display_name FROM rm_categories WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    if (catRows.length === 0) {
      return NextResponse.json({ error: `unknown category: ${slug}` }, { status: 404 });
    }
    const categoryName = catRows[0].display_name;

    // --- Header KPIs ----------------------------------------------------
    const kpiRows = await query<any>(
      `WITH tk AS (
         SELECT t.site_code, t.status, t.resolution_minutes
           FROM rm_helpdesk_tickets t
           JOIN sites s ON t.site_code = s.site_code
           LEFT JOIN territories tr ON s.territory_id = tr.id
           LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE c.slug = $1
            AND t.created_time::DATE >= $2::DATE
            AND t.created_time::DATE <= $3::DATE
            AND ($4::TEXT = '' OR t.site_code = $4)
            AND ($5::TEXT = '' OR tr.tm_code  = $5)
       )
       SELECT COUNT(*)::INT                                            AS ticket_count,
              COUNT(DISTINCT site_code)::INT                            AS sites_affected,
              AVG(resolution_minutes) FILTER (WHERE resolution_minutes IS NOT NULL) AS mttr_minutes,
              (SUM(CASE WHEN status NOT IN ('Closed','Resolved') THEN 1 ELSE 0 END)::NUMERIC
                 / NULLIF(COUNT(*),0)::NUMERIC * 100)                  AS open_pct
         FROM tk`,
      [slug, dateFrom, dateTo, siteCode, territory],
    );

    const costRows = await query<{ total_cost: string }>(
      `SELECT COALESCE(SUM(i.net_cost),0)::NUMERIC AS total_cost
         FROM rm_invoices i
         JOIN sites s ON i.site_code = s.site_code
         LEFT JOIN territories tr ON s.territory_id = tr.id
         LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE c.slug = $1
          AND i.cost_center='retail'
          AND i.service_date >= $2::DATE
          AND i.service_date <= $3::DATE
          AND ($4::TEXT = '' OR i.site_code = $4)
          AND ($5::TEXT = '' OR tr.tm_code  = $5)`,
      [slug, dateFrom, dateTo, siteCode, territory],
    );

    // Prior period: same length immediately before dateFrom
    const fromDate = new Date(dateFrom);
    const toDate   = new Date(dateTo);
    const winDays  = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000));
    const priorTo  = new Date(fromDate.getTime() - 86_400_000).toISOString().slice(0, 10);
    const priorFrom = new Date(fromDate.getTime() - (winDays + 1) * 86_400_000).toISOString().slice(0, 10);

    const priorKpi = await query<{ ticket_count: number; total_cost: string }>(
      `WITH tk AS (
         SELECT COUNT(*)::INT AS tc FROM rm_helpdesk_tickets t
           JOIN sites s ON t.site_code = s.site_code
           LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE c.slug = $1
            AND t.created_time::DATE >= $2::DATE
            AND t.created_time::DATE <= $3::DATE
       ), iv AS (
         SELECT COALESCE(SUM(i.net_cost),0)::NUMERIC AS tot FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE c.slug = $1
            AND i.cost_center='retail'
            AND i.service_date >= $2::DATE
            AND i.service_date <= $3::DATE
       )
       SELECT (SELECT tc FROM tk) AS ticket_count, (SELECT tot FROM iv) AS total_cost`,
      [slug, priorFrom, priorTo],
    );

    const kpi: Kpi = {
      ticketCount:   kpiRows[0]?.ticket_count   || 0,
      totalCost:     parseFloat(costRows[0]?.total_cost || '0'),
      sitesAffected: kpiRows[0]?.sites_affected || 0,
      mttrHours:     kpiRows[0]?.mttr_minutes ? +(kpiRows[0].mttr_minutes / 60).toFixed(1) : null,
      openPct:       kpiRows[0]?.open_pct ? +parseFloat(kpiRows[0].open_pct).toFixed(1) : 0,
      prior: {
        ticketCount: priorKpi[0]?.ticket_count || 0,
        totalCost:   parseFloat(priorKpi[0]?.total_cost || '0'),
      },
    };

    // --- 12-month trend (fixed last 12 months, ignores window filter) ---
    const trendRows = await query<{ month: string; tickets: number; cost: string }>(
      `WITH months AS (
         SELECT to_char(generate_series(
                  date_trunc('month', CURRENT_DATE) - INTERVAL '11 months',
                  date_trunc('month', CURRENT_DATE),
                  '1 month'
                ), 'YYYY-MM') AS month
       ),
       tk AS (
         SELECT to_char(date_trunc('month', t.created_time), 'YYYY-MM') AS month,
                COUNT(*)::INT AS tickets
           FROM rm_helpdesk_tickets t
           JOIN sites s ON t.site_code = s.site_code
           LEFT JOIN territories tr ON s.territory_id = tr.id
           LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE c.slug = $1
            AND t.created_time >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
            AND ($2::TEXT = '' OR t.site_code = $2)
            AND ($3::TEXT = '' OR tr.tm_code  = $3)
          GROUP BY 1
       ),
       iv AS (
         SELECT to_char(date_trunc('month', i.service_date), 'YYYY-MM') AS month,
                SUM(i.net_cost)::NUMERIC AS cost
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories tr ON s.territory_id = tr.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE c.slug = $1
            AND i.cost_center='retail'
            AND i.service_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
            AND ($2::TEXT = '' OR i.site_code = $2)
            AND ($3::TEXT = '' OR tr.tm_code  = $3)
          GROUP BY 1
       )
       SELECT m.month,
              COALESCE(tk.tickets, 0)::INT AS tickets,
              COALESCE(iv.cost, 0)::NUMERIC AS cost
         FROM months m
         LEFT JOIN tk ON tk.month = m.month
         LEFT JOIN iv ON iv.month = m.month
        ORDER BY m.month`,
      [slug, siteCode, territory],
    );
    const trend: TrendPoint[] = trendRows.map(r => ({
      month: r.month, tickets: r.tickets, cost: parseFloat(String(r.cost)),
    }));

    // --- Worst sites in window -----------------------------------------
    const siteRows = await query<any>(
      `WITH tk AS (
         SELECT t.site_code,
                s.budget_name AS site_name,
                COUNT(*)::INT AS tickets,
                AVG(resolution_minutes) FILTER (WHERE resolution_minutes IS NOT NULL) AS mttr_min,
                SUM(CASE WHEN t.status NOT IN ('Closed','Resolved') THEN 1 ELSE 0 END)::INT AS open_count
           FROM rm_helpdesk_tickets t
           JOIN sites s ON t.site_code = s.site_code
           LEFT JOIN territories tr ON s.territory_id = tr.id
           LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE c.slug = $1
            AND t.created_time::DATE >= $2::DATE
            AND t.created_time::DATE <= $3::DATE
            AND ($4::TEXT = '' OR t.site_code = $4)
            AND ($5::TEXT = '' OR tr.tm_code  = $5)
          GROUP BY t.site_code, s.budget_name
       ),
       iv AS (
         SELECT i.site_code, SUM(i.net_cost)::NUMERIC AS cost
           FROM rm_invoices i
           JOIN sites s ON i.site_code = s.site_code
           LEFT JOIN territories tr ON s.territory_id = tr.id
           LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE c.slug = $1
            AND i.cost_center='retail'
            AND i.service_date >= $2::DATE
            AND i.service_date <= $3::DATE
            AND ($4::TEXT = '' OR i.site_code = $4)
            AND ($5::TEXT = '' OR tr.tm_code  = $5)
          GROUP BY 1
       )
       SELECT COALESCE(tk.site_code, iv.site_code) AS site_code,
              tk.site_name,
              COALESCE(tk.tickets, 0)::INT          AS tickets,
              COALESCE(iv.cost, 0)::NUMERIC         AS cost,
              tk.mttr_min,
              COALESCE(tk.open_count, 0)::INT       AS open_count
         FROM tk
         FULL OUTER JOIN iv ON tk.site_code = iv.site_code
        ORDER BY tickets DESC NULLS LAST, cost DESC NULLS LAST
        LIMIT 25`,
      [slug, dateFrom, dateTo, siteCode, territory],
    );
    const REPEAT_THRESHOLD = 5;
    const sites: SiteRow[] = siteRows.map(r => ({
      siteCode:   r.site_code,
      siteName:   r.site_name || r.site_code,
      tickets:    r.tickets,
      cost:       parseFloat(String(r.cost)),
      mttrHours:  r.mttr_min ? +(r.mttr_min / 60).toFixed(1) : null,
      openCount:  r.open_count,
      repeatFlag: r.tickets >= REPEAT_THRESHOLD,
    }));

    // --- Top failure descriptions in window ----------------------------
    const descRows = await query<{ description_norm: string; subject: string; cnt: number }>(
      `SELECT t.description_norm,
              (ARRAY_AGG(t.subject ORDER BY t.created_time DESC))[1] AS subject,
              COUNT(*)::INT AS cnt
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN territories tr ON s.territory_id = tr.id
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE c.slug = $1
          AND t.created_time::DATE >= $2::DATE
          AND t.created_time::DATE <= $3::DATE
          AND t.description_norm <> ''
          AND ($4::TEXT = '' OR t.site_code = $4)
          AND ($5::TEXT = '' OR tr.tm_code  = $5)
        GROUP BY t.description_norm
        ORDER BY cnt DESC
        LIMIT 12`,
      [slug, dateFrom, dateTo, siteCode, territory],
    );
    const descTotal = descRows.reduce((a, b) => a + b.cnt, 0);
    const descriptions: DescriptionRow[] = descRows.map(r => ({
      descriptionNorm: r.description_norm,
      sampleSubject:   r.subject || r.description_norm,
      count:           r.cnt,
      pctOfCategory:   kpi.ticketCount > 0 ? +(r.cnt / kpi.ticketCount * 100).toFixed(1) : 0,
    }));

    // --- Contractor performance in window ------------------------------
    const provRows = await query<any>(
      `SELECT COALESCE(NULLIF(t.service_provider, ''), 'Unspecified') AS provider,
              COUNT(*)::INT                                            AS tickets,
              AVG(resolution_minutes) FILTER (WHERE resolution_minutes IS NOT NULL) AS mttr_min,
              SUM(CASE WHEN t.status IN ('Closed','Resolved') THEN 1 ELSE 0 END)::INT AS closed_cnt
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN territories tr ON s.territory_id = tr.id
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE c.slug = $1
          AND t.created_time::DATE >= $2::DATE
          AND t.created_time::DATE <= $3::DATE
          AND ($4::TEXT = '' OR t.site_code = $4)
          AND ($5::TEXT = '' OR tr.tm_code  = $5)
        GROUP BY 1
        ORDER BY tickets DESC
        LIMIT 15`,
      [slug, dateFrom, dateTo, siteCode, territory],
    );
    const providers: ProviderRow[] = provRows.map(r => ({
      provider:  r.provider,
      tickets:   r.tickets,
      mttrHours: r.mttr_min ? +(r.mttr_min / 60).toFixed(1) : null,
      closedPct: r.tickets > 0 ? +(r.closed_cnt / r.tickets * 100).toFixed(0) : 0,
    }));

    // --- Status mix in window ------------------------------------------
    const statusRows = await query<{ status: string; cnt: number }>(
      `SELECT COALESCE(NULLIF(t.status, ''), 'Unspecified') AS status,
              COUNT(*)::INT AS cnt
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN territories tr ON s.territory_id = tr.id
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE c.slug = $1
          AND t.created_time::DATE >= $2::DATE
          AND t.created_time::DATE <= $3::DATE
          AND ($4::TEXT = '' OR t.site_code = $4)
          AND ($5::TEXT = '' OR tr.tm_code  = $5)
        GROUP BY 1
        ORDER BY cnt DESC`,
      [slug, dateFrom, dateTo, siteCode, territory],
    );
    const statusMix: StatusRow[] = statusRows.map(r => ({ status: r.status, count: r.cnt }));

    // --- Recommendations -----------------------------------------------
    const recommendations: Recommendation[] = [];

    // Site concentration (>15% of category)
    if (kpi.ticketCount > 0) {
      for (const s of sites.slice(0, 3)) {
        const pct = +(s.tickets / kpi.ticketCount * 100).toFixed(1);
        if (pct > 15) {
          recommendations.push({
            ruleId: 'site-concentration',
            severity: pct > 25 ? 'high' : 'medium',
            title: `${s.siteName} drives ${pct}% of ${categoryName} tickets`,
            detail: `${s.tickets} of ${kpi.ticketCount} tickets in this window. Likely a site-specific weakness rather than a fleet-wide issue.`,
            trigger: `site share > 15% of category ticket volume`,
            link: { label: `View tickets at ${s.siteCode}`, href: `/dashboard/helpdesk?siteCode=${encodeURIComponent(s.siteCode)}&category=${encodeURIComponent(slug)}` },
          });
        }
      }
    }

    // Repeat-incident density (≥ 5 in window per site) — cap at top 8 to
    // avoid burying the panel when a high-volume category has many sites
    // tripping the threshold.
    const repeatSites = sites.filter(s => s.repeatFlag).slice(0, 8);
    for (const s of repeatSites) {
      recommendations.push({
        ruleId: 'repeat-density',
        severity: s.tickets >= 10 ? 'high' : 'medium',
        title: `Replace candidate: ${s.siteName}`,
        detail: `${s.tickets} ${categoryName} tickets in this window — equipment likely past its useful life or chronically failing.`,
        trigger: `site has ≥ ${REPEAT_THRESHOLD} ${categoryName} tickets in the selected window`,
        link: { label: `Open tickets`, href: `/dashboard/helpdesk?siteCode=${encodeURIComponent(s.siteCode)}&category=${encodeURIComponent(slug)}` },
      });
    }

    // Top failure mode (>20% of category)
    const topDesc = descriptions[0];
    if (topDesc && topDesc.pctOfCategory > 20) {
      recommendations.push({
        ruleId: 'top-failure-mode',
        severity: topDesc.pctOfCategory > 40 ? 'high' : 'medium',
        title: `'${topDesc.sampleSubject}' accounts for ${topDesc.pctOfCategory}% of ${categoryName} tickets`,
        detail: `${topDesc.count} tickets share this normalised description — investigate as a single common cause.`,
        trigger: `single description_norm > 20% of category volume`,
      });
    }

    // Stalled tickets (>60d open)
    const stalledRows = await query<{ site_code: string; site_name: string; cnt: number }>(
      `SELECT t.site_code, s.budget_name AS site_name, COUNT(*)::INT AS cnt
         FROM rm_helpdesk_tickets t
         JOIN sites s ON t.site_code = s.site_code
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE c.slug = $1
          AND t.status NOT IN ('Closed','Resolved')
          AND (CURRENT_DATE - t.created_time::DATE) > 60
          AND ($2::TEXT = '' OR t.site_code = $2)
        GROUP BY 1, 2
        ORDER BY cnt DESC
        LIMIT 5`,
      [slug, siteCode],
    );
    for (const r of stalledRows) {
      recommendations.push({
        ruleId: 'stalled-tickets',
        severity: r.cnt >= 3 ? 'high' : 'medium',
        title: `${r.cnt} stalled ${categoryName} ticket${r.cnt === 1 ? '' : 's'} at ${r.site_name}`,
        detail: `Open for more than 60 days. Escalate or close stale work to clean the backlog.`,
        trigger: `open ticket age > 60 days`,
        link: { label: `View stalled tickets`, href: `/dashboard/helpdesk?siteCode=${encodeURIComponent(r.site_code)}&category=${encodeURIComponent(slug)}` },
      });
    }

    // Vendor bottleneck (% open in 'Waiting on Third Party' > 30%)
    const vbRows = await query<{ open_total: number; on_3p: number }>(
      `SELECT COUNT(*)::INT AS open_total,
              SUM(CASE WHEN status = 'Waiting on Third Party' THEN 1 ELSE 0 END)::INT AS on_3p
         FROM rm_helpdesk_tickets t
         LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE c.slug = $1
          AND t.status NOT IN ('Closed','Resolved')
          AND ($2::TEXT = '' OR t.site_code = $2)`,
      [slug, siteCode],
    );
    if (vbRows[0] && vbRows[0].open_total > 0) {
      const pct = +(vbRows[0].on_3p / vbRows[0].open_total * 100).toFixed(0);
      if (pct >= 30) {
        recommendations.push({
          ruleId: 'vendor-bottleneck',
          severity: pct >= 50 ? 'high' : 'medium',
          title: `${pct}% of open ${categoryName} tickets blocked on third parties`,
          detail: `${vbRows[0].on_3p} of ${vbRows[0].open_total} open tickets sitting in Waiting on Third Party. Escalate vendor SLAs.`,
          trigger: `Waiting on Third Party share of open tickets ≥ 30%`,
        });
      }
    }

    // Contractor MTTR drift (provider > 1.5× category median MTTR).
    // Skip 'Unspecified' since it's just missing data, not a real provider.
    const namedProviders = providers.filter(p => p.provider !== 'Unspecified');
    const mttrAll = namedProviders.filter(p => p.mttrHours !== null).map(p => p.mttrHours as number).sort((a, b) => a - b);
    const median = mttrAll.length > 0 ? mttrAll[Math.floor(mttrAll.length / 2)] : 0;
    if (median > 0) {
      for (const p of namedProviders) {
        if (p.mttrHours !== null && p.tickets >= 3 && p.mttrHours > median * 1.5) {
          recommendations.push({
            ruleId: 'contractor-mttr',
            severity: p.mttrHours > median * 2.5 ? 'high' : 'medium',
            title: `${p.provider} averages ${p.mttrHours}h vs category median ${median}h`,
            detail: `${p.tickets} tickets handled. Review SLA — they are taking ${(p.mttrHours / median).toFixed(1)}× the category median.`,
            trigger: `provider MTTR > 1.5× category median (≥ 3 tickets)`,
          });
        }
      }
    }

    // Silent capex (site has invoice ≥ $2000 in category but zero tickets in window)
    const SILENT_THRESHOLD = 2000;
    const silentRows = await query<{ site_code: string; site_name: string; cost: string }>(
      `WITH tk AS (
         SELECT DISTINCT t.site_code FROM rm_helpdesk_tickets t
           LEFT JOIN rm_description_categories r ON t.description_norm = r.description_norm
           LEFT JOIN rm_categories c ON r.category_id = c.id
          WHERE c.slug = $1
            AND t.created_time::DATE >= $2::DATE
            AND t.created_time::DATE <= $3::DATE
       )
       SELECT i.site_code, s.budget_name AS site_name, SUM(i.net_cost)::NUMERIC AS cost
         FROM rm_invoices i
         JOIN sites s ON i.site_code = s.site_code
         LEFT JOIN rm_description_categories r ON i.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE c.slug = $1
          AND i.cost_center='retail'
          AND i.service_date >= $2::DATE
          AND i.service_date <= $3::DATE
          AND i.site_code NOT IN (SELECT site_code FROM tk)
          AND ($4::TEXT = '' OR i.site_code = $4)
        GROUP BY 1, 2
        HAVING SUM(i.net_cost) >= $5
        ORDER BY 3 DESC
        LIMIT 5`,
      [slug, dateFrom, dateTo, siteCode, SILENT_THRESHOLD],
    );
    for (const r of silentRows) {
      recommendations.push({
        ruleId: 'silent-capex',
        severity: 'medium',
        title: `${r.site_name}: $${Math.round(parseFloat(r.cost)).toLocaleString()} spent on ${categoryName} with no ticket`,
        detail: `Likely process gap — work happened without a helpdesk ticket. Tighten ticket discipline or reclassify spend.`,
        trigger: `invoice ≥ $${SILENT_THRESHOLD.toLocaleString()} at a site with zero tickets in window`,
      });
    }

    // Seasonality / trend (last 3 months strictly rising in tickets)
    const last3 = trend.slice(-3);
    if (last3.length === 3 && last3[0].tickets < last3[1].tickets && last3[1].tickets < last3[2].tickets) {
      recommendations.push({
        ruleId: 'rising-trend',
        severity: 'medium',
        title: `${categoryName} tickets rising 3 months in a row`,
        detail: `${last3.map(m => `${m.month}: ${m.tickets}`).join(' → ')}. Investigate root cause before peak season.`,
        trigger: `monthly ticket count strictly increasing for last 3 months`,
      });
    }

    // Sort recommendations by severity then by ruleId
    const sevRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

    return NextResponse.json({
      data: {
        category: { slug, name: categoryName },
        window:   { dateFrom, dateTo, priorFrom, priorTo },
        kpi,
        trend,
        sites,
        descriptions,
        providers,
        statusMix,
        recommendations,
      },
    });
  } catch (err: any) {
    console.error('/api/rm/category-deep-dive error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
