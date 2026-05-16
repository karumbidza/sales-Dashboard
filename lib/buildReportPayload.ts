// lib/buildReportPayload.ts
// Server-side payload assembler for the R&M PDF v2 report.
// Fetches existing /api/rm/* endpoints in parallel plus a few callout
// queries, returns the full JSON consumed by the print route.
import { query } from '@/lib/db';

export interface ReportFilters {
  dateFrom:   string;
  dateTo:     string;
  territory?: string;
  siteCode?:  string;
}

export interface ReportPayload {
  meta: {
    period:    { from: string; to: string };
    generatedAt: string;
    territory?: string;
    siteCode?:  string;
    currency:  'USD';
  };
  cost: {
    ytd:           { value: number; vsLY: number | null;        vsBudget: number | null };
    mtd:           { value: number; vsLM: number | null;        vsBudget: number | null };
    costPerLitre:  { value: number | null; fleetMedian: number | null };
    topCategory:   { name: string; value: number; pctOfTotal: number } | null;
    pareto:        Array<{ category: string; value: number; cumulativePct: number }>;
    trend: {
      current:   Array<{ month: string; value: number }>;
      priorYear: Array<{ month: string; value: number }>;
      budget:    Array<{ month: string; value: number }>;
    };
    topMovers: {
      rising:  Array<{ siteCode: string; siteName: string; currentCost: number; priorCost: number; delta: number }>;
      falling: Array<{ siteCode: string; siteName: string; currentCost: number; priorCost: number; delta: number }>;
    };
  };
  siteHeatmap: {
    categories: string[];
    sites: Array<{
      code:   string;
      name:   string;
      values: Array<number | null>;
      total:  number;
      note:   string | null;
    }>;
    rolledUp: {
      siteCount: number;
      values:    Array<number>;
      total:     number;
    };
    columnTotals: Array<number>;
    grandTotal:   number;
    noteCoverage: number;
  };
  siteHeatmapTickets: {
    categories: string[];
    sites: Array<{
      code:   string;
      name:   string;
      values: Array<number | null>;
      total:  number;
      note:   string | null;
    }>;
    rolledUp: {
      siteCount: number;
      values:    Array<number>;
      total:     number;
    };
    columnTotals: Array<number>;
    grandTotal:   number;
    noteCoverage: number;
  };
  efficiency: {
    openTickets:  { total: number; urgent: number };
    mttrDays:     { value: number | null; vsLM: number | null };
    slaHitRate:   { value: number | null; breaches: number };
    repeatIssues: number;
    aging:        Array<{ bucket: '0-30' | '31-60' | '61-90' | '90+'; count: number }>;
    recurring:    Array<{ subject: string; category: string | null; count: number; sites: number }>;
    callouts: {
      worstSla:           { siteCode: string; siteName: string; openOfTotal: string } | null;
      slowestResolution:  { siteCode: string; siteName: string; avgHours: number }   | null;
      highestVolume:      { siteCode: string; siteName: string; tickets: number }     | null;
    };
  };
}

function baseUrl(): string {
  // VERCEL_PROJECT_PRODUCTION_URL is the public production alias
  // (e.g. sales-dashboard-zeta-amber.vercel.app). VERCEL_URL is the
  // deployment-specific URL which on Pro plans inherits preview
  // protection — internal fetches to it return 401. Prefer the alias.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

function qs(filters: ReportFilters, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams({
    dateFrom:  filters.dateFrom,
    dateTo:    filters.dateTo,
    territory: filters.territory || '',
    siteCode:  filters.siteCode  || '',
    ...extra,
  });
  return sp.toString();
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`fetch ${path} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json as T;
}

export async function buildReportPayload(filters: ReportFilters): Promise<ReportPayload> {
  const queryStr = qs(filters);

  // ── Fetch HTTP endpoints + DB notes in parallel ──────────────────
  // Notes are pulled directly from Postgres (not via /api/rm/notes)
  // because the API does exact-period match, but reports often span
  // a different range than the period a note was written for. The
  // PDF picks up any note whose period overlaps the report range,
  // taking the most recent per site.
  const [
    kpisCost,
    pareto,
    trend,
    topMovers,
    heatmap,
    heatmapTickets,
    notesRows,
    kpisEff,
    aging,
    recurring,
  ] = await Promise.all([
    getJSON<any>(`/api/rm/kpis-cost?${queryStr}`),
    getJSON<any>(`/api/rm/cost-pareto?${queryStr}&dimension=category`),
    getJSON<any>(`/api/rm/cost-trend?${queryStr}`),
    getJSON<any>(`/api/rm/top-movers?${queryStr}`),
    getJSON<any>(`/api/rm/cost-heatmap?${queryStr}`),
    getJSON<any>(`/api/rm/cost-heatmap?${queryStr}&dimension=tickets`),
    query<{ site_code: string; note_text: string }>(
      `SELECT DISTINCT ON (site_code) site_code, note_text
         FROM rm_site_notes
        WHERE period_from <= $2::DATE AND period_to >= $1::DATE
        ORDER BY site_code, period_to DESC, updated_at DESC`,
      [filters.dateFrom, filters.dateTo],
    ),
    getJSON<any>(`/api/rm/kpis-efficiency?${queryStr}`),
    getJSON<any>(`/api/rm/ticket-aging?${queryStr}`),
    getJSON<any>(`/api/rm/recurring-issues?${queryStr}&limit=4`),
  ]);
  // Reshape notesRows to match the previous `notes.data` shape.
  const notes = { data: notesRows.map(r => ({ siteCode: r.site_code, note: r.note_text })) };

  // ── Heatmap: top 20 sites with notes, rest rolled up ─────────────
  const hm = heatmap.data;
  // sites: Array<{ siteCode, siteName, total, volume }>
  const allSites = hm.sites as Array<{ siteCode: string; siteName: string; total: number; volume: number }>;
  // categories: Array<{ slug, name, total }>
  const categories = hm.categories as Array<{ slug: string; name: string; total: number }>;
  const notesBySite: Record<string, string> = {};
  for (const n of notes.data || []) notesBySite[n.siteCode] = n.note;

  const top20 = allSites.slice(0, 20);
  const rest  = allSites.slice(20);

  const categoryNames = categories.map(c => c.name);
  const sitesShaped = top20.map(s => {
    const values = categories.map(c => {
      const cell = hm.matrix[s.siteCode]?.[c.slug];
      return cell ? cell.cost : null;
    });
    return {
      code:  s.siteCode,
      name:  s.siteName,
      values,
      total: s.total,
      note:  notesBySite[s.siteCode] || null,
    };
  });

  const rolledUpValues = categories.map(c =>
    rest.reduce((sum, s) => sum + (hm.matrix[s.siteCode]?.[c.slug]?.cost ?? 0), 0)
  );
  const rolledUpTotal = rest.reduce((sum, s) => sum + s.total, 0);

  const columnTotals = categories.map((c, i) => {
    const top20Sum = sitesShaped.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
    return top20Sum + rolledUpValues[i];
  });
  const grandTotal = columnTotals.reduce((a, b) => a + b, 0);

  // ── Ticket-dimension heatmap reshape ────────────────────────────
  const hmT = heatmapTickets.data;
  const allSitesT = hmT.sites as Array<{ siteCode: string; siteName: string; total: number; volume: number }>;
  const top20T = allSitesT.slice(0, 20);
  const restT  = allSitesT.slice(20);

  const sitesShapedT = top20T.map(s => {
    const values: Array<number | null> = categories.map(c => {
      const cell = hmT.matrix[s.siteCode]?.[c.slug];
      const count = cell?.ticketCount ?? 0;
      return count > 0 ? count : null;
    });
    const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    return {
      code:   s.siteCode,
      name:   s.siteName,
      values,
      total,
      note:   notesBySite[s.siteCode] || null,
    };
  });

  const rolledUpValuesT = categories.map(c =>
    restT.reduce((sum, s) => sum + (hmT.matrix[s.siteCode]?.[c.slug]?.ticketCount ?? 0), 0)
  );
  const rolledUpTotalT = rolledUpValuesT.reduce((a, b) => a + b, 0);

  const columnTotalsT  = categories.map((c, i) => {
    const top20Sum = sitesShapedT.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
    return top20Sum + rolledUpValuesT[i];
  });
  const grandTotalT = columnTotalsT.reduce((a, b) => a + b, 0);

  // ── Efficiency callouts (3 inline queries) ───────────────────────
  // worstSla: site with the highest SLA breach count in the period.
  const worstSlaRow = await query<{ site_code: string; site_name: string; breaches: number; total: number }>(
    `SELECT tk.site_code,
            s.budget_name AS site_name,
            COUNT(*) FILTER (WHERE resolution_status='SLA Violated')::INT AS breaches,
            COUNT(*) FILTER (WHERE resolution_status IS NOT NULL)::INT    AS total
       FROM rm_helpdesk_tickets tk
       JOIN sites s ON tk.site_code = s.site_code
       LEFT JOIN territories t ON s.territory_id = t.id
      WHERE tk.created_time::DATE >= $1::DATE
        AND tk.created_time::DATE <= $2::DATE
        AND ($3::TEXT = '' OR tk.site_code = $3)
        AND ($4::TEXT = '' OR t.tm_code   = $4)
      GROUP BY tk.site_code, s.budget_name
      HAVING COUNT(*) FILTER (WHERE resolution_status='SLA Violated') > 0
      ORDER BY breaches DESC, total DESC
      LIMIT 1`,
    [filters.dateFrom, filters.dateTo, filters.siteCode || '', filters.territory || ''],
  );

  // slowestResolution: site with highest average resolution time (min 3 resolved tickets).
  const slowestRow = await query<{ site_code: string; site_name: string; avg_min: string }>(
    `SELECT tk.site_code,
            s.budget_name AS site_name,
            AVG(resolution_minutes)::NUMERIC AS avg_min
       FROM rm_helpdesk_tickets tk
       JOIN sites s ON tk.site_code = s.site_code
       LEFT JOIN territories t ON s.territory_id = t.id
      WHERE tk.resolved_time IS NOT NULL
        AND tk.resolved_time::DATE >= $1::DATE
        AND tk.resolved_time::DATE <= $2::DATE
        AND tk.resolution_minutes IS NOT NULL
        AND ($3::TEXT = '' OR tk.site_code = $3)
        AND ($4::TEXT = '' OR t.tm_code   = $4)
      GROUP BY tk.site_code, s.budget_name
      HAVING COUNT(*) >= 3
      ORDER BY avg_min DESC NULLS LAST
      LIMIT 1`,
    [filters.dateFrom, filters.dateTo, filters.siteCode || '', filters.territory || ''],
  );

  // highestVolume: site with the most tickets created in the period.
  const volumeRow = await query<{ site_code: string; site_name: string; tickets: number }>(
    `SELECT tk.site_code,
            s.budget_name AS site_name,
            COUNT(*)::INT AS tickets
       FROM rm_helpdesk_tickets tk
       JOIN sites s ON tk.site_code = s.site_code
       LEFT JOIN territories t ON s.territory_id = t.id
      WHERE tk.created_time::DATE >= $1::DATE
        AND tk.created_time::DATE <= $2::DATE
        AND ($3::TEXT = '' OR tk.site_code = $3)
        AND ($4::TEXT = '' OR t.tm_code   = $4)
      GROUP BY tk.site_code, s.budget_name
      ORDER BY tickets DESC
      LIMIT 1`,
    [filters.dateFrom, filters.dateTo, filters.siteCode || '', filters.territory || ''],
  );

  const callouts = {
    worstSla: worstSlaRow[0]
      ? {
          siteCode:   worstSlaRow[0].site_code,
          siteName:   worstSlaRow[0].site_name,
          openOfTotal: `${worstSlaRow[0].breaches} of ${worstSlaRow[0].total}`,
        }
      : null,
    slowestResolution: slowestRow[0]
      ? {
          siteCode: slowestRow[0].site_code,
          siteName: slowestRow[0].site_name,
          avgHours: +(parseFloat(slowestRow[0].avg_min) / 60).toFixed(1),
        }
      : null,
    highestVolume: volumeRow[0]
      ? {
          siteCode: volumeRow[0].site_code,
          siteName: volumeRow[0].site_name,
          tickets:  volumeRow[0].tickets,
        }
      : null,
  };

  // ── Assemble final payload ───────────────────────────────────────
  return {
    meta: {
      period:      { from: filters.dateFrom, to: filters.dateTo },
      generatedAt: new Date().toISOString(),
      territory:   filters.territory || undefined,
      siteCode:    filters.siteCode  || undefined,
      currency:    'USD',
    },
    cost: {
      ytd: {
        value:    kpisCost.data.ytd.current,
        vsLY:     kpisCost.data.ytd.deltaPctLY,
        vsBudget: kpisCost.data.ytd.deltaPctBudget,
      },
      mtd: {
        value:    kpisCost.data.mtd.current,
        vsLM:     kpisCost.data.mtd.deltaPctMoM,
        vsBudget: kpisCost.data.mtd.deltaPctBudget,
      },
      costPerLitre: {
        value:       kpisCost.data.costPerLitre.current,
        fleetMedian: kpisCost.data.costPerLitre.fleetMedian,
      },
      topCategory: kpisCost.data.topCategory
        ? {
            name:       kpisCost.data.topCategory.displayName,
            value:      kpisCost.data.topCategory.total,
            pctOfTotal: kpisCost.data.topCategory.pctOfTotal ?? 0,
          }
        : null,
      pareto: (pareto.data.items || []).map((p: any) => ({
        category:      p.label,
        value:         p.cost,
        cumulativePct: p.cumulativePct,
      })),
      trend: {
        current:   (trend.data.currentYear     || []).map((m: any) => ({ month: m.month, value: m.cost })),
        priorYear: (trend.data.priorYearSeries || []).map((m: any) => ({ month: m.month, value: m.cost })),
        budget:    (trend.data.budgetSeries    || []).map((m: any) => ({ month: m.month, value: m.cost })),
      },
      topMovers: {
        rising:  topMovers.data.rising  || [],
        falling: topMovers.data.falling || [],
      },
    },
    siteHeatmap: {
      categories:   categoryNames,
      sites:        sitesShaped,
      rolledUp: {
        siteCount: rest.length,
        values:    rolledUpValues,
        total:     rolledUpTotal,
      },
      columnTotals,
      grandTotal,
      noteCoverage: sitesShaped.filter(s => s.note).length,
    },
    siteHeatmapTickets: {
      categories:   categoryNames,
      sites:        sitesShapedT,
      rolledUp: {
        siteCount:  restT.length,
        values:     rolledUpValuesT,
        total:      rolledUpTotalT,
      },
      columnTotals: columnTotalsT,
      grandTotal:   grandTotalT,
      noteCoverage: sitesShapedT.filter(s => s.note).length,
    },
    efficiency: {
      openTickets: {
        total:  kpisEff.data.openTickets.total,
        urgent: kpisEff.data.openTickets.urgent,
      },
      mttrDays: {
        value: kpisEff.data.mttr.days,
        vsLM:  kpisEff.data.mttr.priorMonthDays !== null && kpisEff.data.mttr.days !== null
                 ? +(kpisEff.data.mttr.days - kpisEff.data.mttr.priorMonthDays).toFixed(1)
                 : null,
      },
      slaHitRate: {
        value:    kpisEff.data.slaHit.hitPct,
        breaches: kpisEff.data.slaHit.breachCount,
      },
      repeatIssues: kpisEff.data.repeats.siteCount,
      aging: (aging.data.buckets || []).map((b: any) => ({
        bucket: b.bucket as '0-30' | '31-60' | '61-90' | '90+',
        count:  b.count,
      })),
      recurring: (recurring.data || []).slice(0, 4).map((r: any) => ({
        subject:  r.sampleSubject || r.descriptionNorm || '—',
        category: r.categoryName || null,
        count:    r.count,
        sites:    r.siteCount,
      })),
      callouts,
    },
  };
}
