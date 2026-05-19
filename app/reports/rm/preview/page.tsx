// app/reports/rm/preview/page.tsx
// Dev-only preview of the PDF report — same components as /print but
// without HMAC token requirement. Use it to iterate on layout in the
// browser before deploying. Returns 404 in production deployments.
// Renders 6 pages (1–6); page 6 = Tickets · All Sites (no notes).
import { notFound } from 'next/navigation';
import PageFrame      from '@/components/print/PageFrame';
import CostPerformancePage from '@/components/print/CostPerformancePage';
import HeatmapPage          from '@/components/print/HeatmapPage';
import EfficiencyPage       from '@/components/print/EfficiencyPage';
import TicketHeatmapPage    from '@/components/print/TicketHeatmapPage';
import ReadyBeacon          from '../print/ReadyBeacon';
import { buildReportPayload, type ReportPayload } from '@/lib/buildReportPayload';

export const dynamic = 'force-dynamic';

function isProdDeploy() {
  return process.env.VERCEL_ENV === 'production';
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function formatPeriod(from: string, to: string): string {
  const f = new Date(from + 'T00:00:00Z');
  const t = new Date(to   + 'T00:00:00Z');
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
  const left  = sameYear ? fmt(f, { day: 'numeric', month: 'short' })
                         : fmt(f, { day: 'numeric', month: 'short', year: 'numeric' });
  const right = fmt(t, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${left} – ${right}`;
}

interface Props {
  searchParams: {
    dateFrom?:  string;
    dateTo?:    string;
    territory?: string;
    siteCode?:  string;
  };
}

export default async function PreviewPage({ searchParams }: Props) {
  // Hide from production deployments. Local dev + preview deploys can browse.
  if (isProdDeploy()) notFound();

  const filters = {
    dateFrom:  searchParams.dateFrom  || `${new Date().getUTCFullYear()}-01-01`,
    dateTo:    searchParams.dateTo    || isoToday(),
    territory: searchParams.territory || undefined,
    siteCode:  searchParams.siteCode  || undefined,
  };

  let payload: ReportPayload;
  try {
    payload = await buildReportPayload(filters);
  } catch (err: any) {
    return (
      <>
        <div style={{ padding: 40, fontFamily: 'system-ui' }}>
          <h1>Preview failed to render</h1>
          <p style={{ color: '#475569', whiteSpace: 'pre-wrap' }}>{err?.message || 'Unknown error'}</p>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 24 }}>
            Filters: {JSON.stringify(filters)}
          </p>
        </div>
        <ReadyBeacon />
      </>
    );
  }

  const period     = formatPeriod(payload.meta.period.from, payload.meta.period.to);
  const totalPages = 6;
  const sitesCount = payload.siteHeatmap.sites.length;
  const splitAt    = Math.ceil(sitesCount / 2);

  return (
    <>
      <PageFrame
        pageIndex={1}
        pageTotal={totalPages}
        pageTitle="Cost & Operational Snapshot"
        pageMeta={payload.cost.topCategory ? `Top category: ${payload.cost.topCategory.name}` : undefined}
        period={period}
      >
        <CostPerformancePage
          cost={payload.cost}
          efficiency={payload.efficiency}
          territory={payload.territory}
        />
      </PageFrame>

      <PageFrame
        pageIndex={2}
        pageTotal={totalPages}
        pageTitle="Top Sites · Cost × Category (1)"
        pageMeta={`Sites 1–${splitAt} of ${sitesCount}`}
        period={period}
      >
        <HeatmapPage
          data={payload.siteHeatmap}
          sliceFrom={0}
          sliceTo={splitAt}
          showFooter={false}
        />
      </PageFrame>

      <PageFrame
        pageIndex={3}
        pageTotal={totalPages}
        pageTitle="Top Sites · Cost × Category (2)"
        pageMeta={`Sites ${splitAt + 1}–${sitesCount} · totals across all ${sitesCount}`}
        period={period}
      >
        <HeatmapPage
          data={payload.siteHeatmap}
          sliceFrom={splitAt}
          sliceTo={sitesCount}
          showFooter={true}
          totalsLabel={`TOP ${sitesCount} TOTAL`}
        />
      </PageFrame>

      <PageFrame
        pageIndex={4}
        pageTotal={totalPages}
        pageTitle="Operational Efficiency · Helpdesk"
        pageMeta={`${payload.efficiency.openTickets.total} open · ${payload.efficiency.slaHitRate.breaches} SLA breaches`}
        period={period}
      >
        <EfficiencyPage data={payload.efficiency} />
      </PageFrame>

      <PageFrame
        pageIndex={5}
        pageTotal={totalPages}
        pageTitle="Tickets · Cost × Category"
        pageMeta={`${payload.siteHeatmapTickets.sites.length} sites by ticket count · ${payload.siteHeatmapTickets.rolledUp.siteCount} more rolled up`}
        period={period}
      >
        <TicketHeatmapPage data={payload.siteHeatmapTickets} />
      </PageFrame>

      <PageFrame
        pageIndex={6}
        pageTotal={totalPages}
        pageTitle="Tickets · All Sites"
        pageMeta={`${payload.siteHeatmapTicketsAll.sites.length} sites with tickets in window`}
        period={period}
      >
        <TicketHeatmapPage data={payload.siteHeatmapTicketsAll} hideNotes={true} />
      </PageFrame>

      <ReadyBeacon />
    </>
  );
}
