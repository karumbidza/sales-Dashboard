// app/api/executive/monthly/route.ts
// Single endpoint returning all 5 sections of the monthly executive report.
// Multiple sequential SQL queries (one per logical block); assembled into
// one JSON payload so the report sees a consistent point-in-time snapshot.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface MonthWindow {
  monthLabel: string;
  start: string;
  end: string;
  priorStart: string;
  priorEnd: string;
  trail90Start: string;
  trail12Start: string;
}

function parseMonth(raw: string | null): MonthWindow {
  let s = raw || '';
  if (!/^\d{4}-\d{2}$/.test(s)) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m0 = now.getUTCMonth();
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
