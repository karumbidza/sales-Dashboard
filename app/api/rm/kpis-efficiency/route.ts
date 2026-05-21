// app/api/rm/kpis-efficiency/route.ts
// 4 Efficiency KPIs: Open Tickets, MTTR, SLA Hit Rate, Repeat Issues.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const year  = new Date().getUTCFullYear();
    const dateFrom = sp.get('dateFrom') || `${year}-01-01`;
    const dateTo   = sp.get('dateTo')   || today;
    const territory = sp.get('territory') || '';
    const siteCode  = sp.get('siteCode')  || '';
    const category  = sp.get('category')  || '';

    const periodEnd = new Date(dateTo + 'T00:00:00Z');
    const periodEndY = periodEnd.getUTCFullYear();
    const periodEndM = periodEnd.getUTCMonth();
    const periodEndD = periodEnd.getUTCDate();

    const monthStart = `${periodEndY}-${String(periodEndM + 1).padStart(2, '0')}-01`;
    const priorMonthY = periodEndM === 0 ? periodEndY - 1 : periodEndY;
    const priorMonthM = periodEndM === 0 ? 12 : periodEndM;
    const priorMonthStart = `${priorMonthY}-${String(priorMonthM).padStart(2, '0')}-01`;

    // Period one month earlier (point-in-time backlog comparison).
    // For backlog metrics we compare "open as of dateTo" vs "open as of dateTo - 1 month".
    // Clamp month-end rollover: setUTCMonth doesn't cap to the target month's length,
    // so e.g. March 31 minus one month would roll to March 3 instead of Feb 28.
    const priorPeriodEnd = (() => {
      const d = new Date(periodEnd);
      const originalDay = d.getUTCDate();
      d.setUTCMonth(d.getUTCMonth() - 1);
      if (d.getUTCDate() !== originalDay) {
        // Overflow rolled us into the following month; back up to last day of target month.
        d.setUTCDate(0);
      }
      return d.toISOString().slice(0, 10);
    })();

    // last_90 window — for repeat-issue detection
    const ninetyAgo = new Date(periodEnd.getTime() - 90 * 86400000).toISOString().slice(0, 10);

    // 1. Open tickets (current state — ignores date filters since "open right now")
    const [openRow] = await query<{ total: string; urgent: string }>(
      `SELECT COUNT(*)::INT AS total,
              COUNT(*) FILTER (WHERE priority = 'Urgent')::INT AS urgent
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status NOT IN ('Closed', 'Resolved')
          AND ($1::TEXT = '' OR tk.site_code = $1)
          AND ($2::TEXT = '' OR t.tm_code = $2)
          AND ($3::TEXT = '' OR c.slug = $3)`,
      [siteCode, territory, category],
    );

    // 1b. Tickets opened in current period + avg response (resolution_minutes proxy)
    const [openedRow] = await query<{ opened: string; avg_min: string | null }>(
      `SELECT COUNT(*)::INT AS opened,
              AVG(resolution_minutes)::NUMERIC AS avg_min
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <= $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)`,
      [dateFrom, dateTo, siteCode, territory, category],
    );
    const ticketsOpenedCount = parseInt(openedRow.opened, 10);
    const avgResponseHours = openedRow.avg_min ? +(parseFloat(openedRow.avg_min) / 60).toFixed(1) : null;

    // 1c. Tickets opened in prior month (same calendar window length, shifted -1 month)
    const [openedPriorRow] = await query<{ avg_min: string | null }>(
      `SELECT AVG(resolution_minutes)::NUMERIC AS avg_min
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <  $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)`,
      [priorMonthStart, monthStart, siteCode, territory, category],
    );
    const avgResponseHoursPrior = openedPriorRow.avg_min ? +(parseFloat(openedPriorRow.avg_min) / 60).toFixed(1) : null;
    const avgResponseVsLM = (avgResponseHours !== null && avgResponseHoursPrior !== null)
      ? +(avgResponseHours - avgResponseHoursPrior).toFixed(1)
      : null;

    // 1d. Top 3 ticket-contributing sites in current period
    const ticketContribRows = await query<{ site_name: string; count: number }>(
      `SELECT s.budget_name AS site_name, COUNT(*)::INT AS count
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <= $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)
        GROUP BY s.budget_name
        ORDER BY count DESC
        LIMIT 3`,
      [dateFrom, dateTo, siteCode, territory, category],
    );

    // 1e. No-action open (status Open/Pending) — open AS OF dateTo
    const [noActionRow] = await query<{ total: string }>(
      `SELECT COUNT(*)::INT AS total
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status IN ('Open', 'Pending')
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)`,
      [dateTo, siteCode, territory, category],
    );
    const noActionOpenCount = parseInt(noActionRow.total, 10);

    // 1f. Same query, but anchored to one month prior — used for vsLM
    const [noActionPriorRow] = await query<{ total: string }>(
      `SELECT COUNT(*)::INT AS total
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status IN ('Open', 'Pending')
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)`,
      [priorPeriodEnd, siteCode, territory, category],
    );
    const noActionOpenCountPrior = parseInt(noActionPriorRow.total, 10);
    const noActionVsLM = noActionOpenCount - noActionOpenCountPrior;

    // 1g. Waiting on Third Party — open AS OF dateTo
    const [waitingRow] = await query<{ total: string }>(
      `SELECT COUNT(*)::INT AS total
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status = 'Waiting on Third Party'
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)`,
      [dateTo, siteCode, territory, category],
    );
    const waitingCount = parseInt(waitingRow.total, 10);

    const [waitingPriorRow] = await query<{ total: string }>(
      `SELECT COUNT(*)::INT AS total
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status = 'Waiting on Third Party'
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)`,
      [priorPeriodEnd, siteCode, territory, category],
    );
    const waitingVsLM = waitingCount - parseInt(waitingPriorRow.total, 10);

    // 1h. Top 3 most-unactioned sites with stale (>30d) count
    const unActionedRows = await query<{ site_name: string; open_count: number; stale_count: number }>(
      `SELECT s.budget_name AS site_name,
              COUNT(*)::INT AS open_count,
              COUNT(*) FILTER (WHERE tk.created_time < $1::timestamptz - INTERVAL '30 days')::INT AS stale_count
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.status IN ('Open', 'Pending')
          AND tk.created_time <= $1::timestamptz
          AND (tk.resolved_time IS NULL OR tk.resolved_time > $1::timestamptz)
          AND ($2::TEXT = '' OR tk.site_code = $2)
          AND ($3::TEXT = '' OR t.tm_code = $3)
          AND ($4::TEXT = '' OR c.slug = $4)
        GROUP BY s.budget_name
        ORDER BY open_count DESC, stale_count DESC
        LIMIT 3`,
      [dateTo, siteCode, territory, category],
    );

    // 2. MTTR (current period) — based on resolved_time in window
    const [mttrCurrRow] = await query<{ avg_min: string | null }>(
      `SELECT AVG(resolution_minutes)::NUMERIC AS avg_min
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.resolved_time IS NOT NULL
          AND tk.resolved_time::DATE >= $1::DATE
          AND tk.resolved_time::DATE <= $2::DATE
          AND tk.resolution_minutes IS NOT NULL
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)`,
      [dateFrom, dateTo, siteCode, territory, category],
    );

    // MTTR prior month (full prior month, not same-days for simplicity)
    const [mttrPriorRow] = await query<{ avg_min: string | null }>(
      `SELECT AVG(resolution_minutes)::NUMERIC AS avg_min
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.resolved_time IS NOT NULL
          AND tk.resolved_time::DATE >= $1::DATE
          AND tk.resolved_time::DATE <  $2::DATE
          AND tk.resolution_minutes IS NOT NULL
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)`,
      [priorMonthStart, monthStart, siteCode, territory, category],
    );

    const mttrCurrMin   = mttrCurrRow.avg_min  ? parseFloat(mttrCurrRow.avg_min)  : null;
    const mttrPriorMin  = mttrPriorRow.avg_min ? parseFloat(mttrPriorRow.avg_min) : null;
    const mttrCurrDays  = mttrCurrMin  !== null ? +(mttrCurrMin  / 60 / 24).toFixed(1) : null;
    const mttrPriorDays = mttrPriorMin !== null ? +(mttrPriorMin / 60 / 24).toFixed(1) : null;

    // 3. SLA Hit Rate (in period)
    const [slaRow] = await query<{ hits: string; total: string; breaches: string }>(
      `SELECT COUNT(*) FILTER (WHERE resolution_status='Within SLA')::INT AS hits,
              COUNT(*) FILTER (WHERE resolution_status IS NOT NULL)::INT AS total,
              COUNT(*) FILTER (WHERE resolution_status='SLA Violated')::INT AS breaches
         FROM rm_helpdesk_tickets_active tk
         JOIN sites s ON tk.site_code = s.site_code
         LEFT JOIN territories t ON s.territory_id = t.id
         LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
         LEFT JOIN rm_categories c ON r.category_id = c.id
        WHERE tk.created_time::DATE >= $1::DATE
          AND tk.created_time::DATE <= $2::DATE
          AND ($3::TEXT = '' OR tk.site_code = $3)
          AND ($4::TEXT = '' OR t.tm_code = $4)
          AND ($5::TEXT = '' OR c.slug = $5)`,
      [dateFrom, dateTo, siteCode, territory, category],
    );

    const slaHits = parseInt(slaRow.hits, 10);
    const slaTotal = parseInt(slaRow.total, 10);
    const slaHitPct = slaTotal > 0 ? +(slaHits / slaTotal * 100).toFixed(1) : null;
    const slaBreaches = parseInt(slaRow.breaches, 10);

    // 4. Repeat issues — (site, description_norm) pairs with >=3 tickets in last 90 days
    const [repeatRow] = await query<{ site_count: string }>(
      `SELECT COUNT(DISTINCT site_code)::INT AS site_count
         FROM (
           SELECT tk.site_code, tk.description_norm, COUNT(*)::INT AS n
             FROM rm_helpdesk_tickets_active tk
             JOIN sites s ON tk.site_code = s.site_code
             LEFT JOIN territories t ON s.territory_id = t.id
             LEFT JOIN rm_description_categories r ON tk.description_norm = r.description_norm
             LEFT JOIN rm_categories c ON r.category_id = c.id
            WHERE tk.created_time::DATE >= $1::DATE
              AND tk.created_time::DATE <= $2::DATE
              AND ($3::TEXT = '' OR tk.site_code = $3)
              AND ($4::TEXT = '' OR t.tm_code = $4)
              AND ($5::TEXT = '' OR c.slug = $5)
            GROUP BY tk.site_code, tk.description_norm
           HAVING COUNT(*) >= 3
         ) repeated`,
      [ninetyAgo, dateTo, siteCode, territory, category],
    );

    return NextResponse.json({
      data: {
        openTickets: {
          total: parseInt(openRow.total, 10),
          urgent: parseInt(openRow.urgent, 10),
        },
        mttr: {
          days: mttrCurrDays,
          priorMonthDays: mttrPriorDays,
        },
        slaHit: {
          hitPct: slaHitPct,
          breachCount: slaBreaches,
        },
        repeats: {
          siteCount: parseInt(repeatRow.site_count, 10),
        },
        // — Additive fields for page-1 report —
        ticketsOpened: {
          value: ticketsOpenedCount,
          avgResponseHours,
          vsLM: avgResponseVsLM,
          contributors: ticketContribRows.map((r, i) => ({
            rank: (i + 1) as 1 | 2 | 3,
            siteName: r.site_name,
            count: r.count,
          })),
        },
        noActionOpen: {
          value: noActionOpenCount,
          vsLM:  noActionVsLM,
          oldestSites: unActionedRows.map((r, i) => ({
            rank: (i + 1) as 1 | 2 | 3,
            siteName: r.site_name,
            openCount: r.open_count,
            staleCount: r.stale_count,
          })),
        },
        waitingThirdParty: {
          value: waitingCount,
          vsLM:  waitingVsLM,
        },
      },
    });
  } catch (err: any) {
    console.error('/api/rm/kpis-efficiency error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
